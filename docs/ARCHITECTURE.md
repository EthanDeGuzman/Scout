# Scout Architecture

Scout is a personal email assistant. It syncs an Outlook inbox, classifies emails with a local LLM, tracks job applications, and drafts replies. This document describes how it is built and why.

> Status: the foundation, emails and classification are built. Sections on sync, auth, drafts, jobs and the frontend describe the planned design.

## 1. Overview

A modular monolith: one NestJS app, one PostgreSQL database, organised into feature modules.

```text
        React (Vite dev server :5173)
                     |
                     |  /api/* proxied
                     v
        NestJS API (:3001)  -------------->  Ollama (:11434)
        Swagger UI at /api/docs               local LLM
          |        |
          |        +------------------------>  Microsoft Graph
          |                                     (Outlook.com)
          v
     PostgreSQL (Docker :5432)
```

Everything runs on one machine. Sync and classification run inside the API process, so there is no queue or worker.

## 2. Stack

| Layer | Choice |
|---|---|
| API | NestJS 11, TypeScript |
| Database | PostgreSQL 17, hand-written SQL through TypeORM's `DataSource.query` (no entities, no query builder) |
| Validation | `class-validator` DTOs with a global `ValidationPipe` |
| API docs | `@nestjs/swagger` at `/api/docs` |
| Auth | Microsoft OAuth (auth code + PKCE) via `@azure/msal-node`; session cookie stored in PostgreSQL |
| AI | Ollama with a 7-14B instruct model, called with plain `fetch` |
| Frontend | React, Vite, React Router, plain CSS |
| Tests | Jest, `@nestjs/testing`, Supertest |

## 3. Module layout

Each feature lives in `backend/src/modules/<feature>/`:

| File | Responsibility |
|---|---|
| `*.module.ts` | Wires controller, providers, imports, exports |
| `*.controller.ts` | Routes. Takes request DTOs, calls the service, returns response DTOs |
| `*.service.ts` | Business logic. Knows nothing about HTTP |
| `*.repository.ts` | SQL only. Every method takes `userId` and filters by it |
| `dto/` | Validated request DTOs and documented response DTOs |

Built: `health`, `emails`, `classification`. Planned: `auth`, `drafts`, `jobs`, `profile`, `dashboard`, `sync`.

External systems (Microsoft Graph, Ollama) sit behind their own modules and interfaces so services can be tested with fakes.

## 4. Request lifecycle

Example: `PUT /api/v1/emails/:id/category`

1. **Middleware:** `express-session` loads the session from PostgreSQL.
2. **Guard:** the global `AuthGuard` puts the user ID on the request. `@Public()` routes skip it.
3. **Pipe:** `ValidationPipe` builds and validates the DTOs for the `:id` param (a UUID) and the body (a category from the enum).
4. **Controller:** calls the service.
5. **Service:** calls the repository. It throws 404 if the email is missing or belongs to another user, and 409 if the AI is classifying it.
6. **Repository:** runs parameterised SQL. The insert runs when the email belongs to the user and is not `PROCESSING`.
7. **Controller:** returns a response DTO.
8. **Exception filter:** any thrown error becomes the standard JSON error shape.

## 5. Data access

All SQL is hand-written and parameterised (`$1`, `$2`). TypeORM is used only for the connection, `query()`, transactions and migrations. It is configured with `entities: []` and `synchronize: false`.

```typescript
const rows: EmailRow[] = await this.dataSource.query(
  `SELECT id, subject FROM emails WHERE user_id = $1 AND id = $2`,
  [userId, id],
);
```

Transactions use `dataSource.transaction(async (manager) => ...)`. Repository methods that can run inside a transaction accept an optional `EntityManager`.

## 6. Database

Conventions:

- `snake_case` names, `uuid` primary keys (`gen_random_uuid()`), `timestamptz` timestamps.
- Fixed value lists are `text` with a `CHECK` constraint, not PostgreSQL enums.
- Foreign keys everywhere; `ON DELETE CASCADE` from `users` so deleting a user removes all their data.
- Repositories map `snake_case` rows to `camelCase` objects.

Schema changes are migrations written as raw SQL (`npm run migration:run`). Every migration has a working `down`, and an applied migration is never edited; fixes go in a new one.

### Tables

| Table | Purpose |
|---|---|
| `users` | One row per user. Email, display name |
| `microsoft_accounts` | MSAL account id and the AES-256-GCM encrypted token cache. One per user |
| `session` | Login sessions for `connect-pg-simple` |
| `emails` | Synced messages. Unique on `(user_id, graph_message_id)`. Tracks `processing_status` (`PENDING`, `PROCESSING`, `CLASSIFIED`, `FAILED`) and attempts |
| `email_classifications` | One row per classification, AI or manual. Stores category, confidence, `needs_review`, extracted job details (`jsonb`), model name, prompt version, duration. Latest row wins |
| `reply_drafts` | Generated and edited replies, tone, status, Outlook draft id, model and prompt version |
| `job_applications` | Company, title, status, recruiter details, optional source email (`ON DELETE SET NULL`) |
| `application_events` | Status changes, interviews and notes per application |
| `career_profiles` | Skills, preferred titles and locations, preferred tone. One per user |
| `sync_state` | Per user and folder: delta link, last synced time, status |

Indexes: `emails (user_id, received_at DESC)`, `emails (user_id, processing_status)`, `email_classifications (email_id, created_at DESC)`.

Retention: data stays until the user deletes it. `DELETE /api/v1/me` cascades through everything, including the token cache. Sync only reads the last `SYNC_LOOKBACK_DAYS` days of the Inbox.

## 7. AI design

### Provider interface

```typescript
export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AIProvider {
  classifyEmail(input: EmailForAI): Promise<ClassificationResult>;
}
```

`generateReply` joins the interface when reply drafting is built. `AiModule` binds `AI_PROVIDER` to `OllamaProvider`. Tests override it with `FakeAIProvider`, so nothing needs Ollama running.

### Calling Ollama

`POST {OLLAMA_BASE_URL}/api/chat` with `stream: false`, `think: false` (thinking mode is slower and adds nothing here), a JSON Schema in `format` so replies have a fixed shape, `temperature: 0` and a fixed `seed` for repeatability, and `AbortSignal.timeout(OLLAMA_TIMEOUT_MS)`. The email body is cut to 8,000 characters. If Ollama is unreachable the API returns `503 AI_UNAVAILABLE`. A timeout is different: Ollama is up but too slow for that email, so it counts as a failed attempt (see section 8).

### Prompts

Prompts are versioned files in `backend/src/ai/prompts/` (`classify_v1.md`, `reply_v1.md`), copied into `dist` by `nest-cli.json` and loaded at startup. The version string is stored with every result. A prompt that has results recorded against it is never edited; copy it to `_v2` instead.

### Validation of model output

1. `JSON.parse` the reply.
2. Validate against `ClassificationResultDto`, which requires every field including `extracted`. Retry once on failure, then fail with `AiInvalidOutputException`.
3. Null any extracted value that does not appear in the email text.
4. Set `needs_review` when confidence is below `CLASSIFICATION_REVIEW_THRESHOLD`.

### Prompt injection

Email content is untrusted.

- Instructions go only in the system message. Email content goes only in the user message inside `<email>` tags, and the system prompt says to treat it as data. Any `</email` inside the email text is escaped, so an email cannot close the tag early.
- The model has no tools and cannot call the API, read tokens or send anything.
- Output must pass validation. Free text is never executed or used to build SQL.
- Outlook drafts are created only on a user click. Nothing is ever sent.
- The evaluation dataset includes injection attempts.

### Evaluation

`backend/eval/dataset.jsonl` holds hand-written labelled emails (no real data). `npm run eval` runs them through the provider and reports precision, recall and F1 per category, invalid-output rate, extraction accuracy, and response times. Results per model and prompt version go in `docs/AI_EVALUATION.md`. It calls real Ollama, so it runs locally, not in CI.

## 8. Sync and background work

Everything runs inside the Nest process.

- **Sync** runs on demand (`POST /sync`) or on an interval when `SYNC_INTERVAL_MINUTES > 0`. Only one sync runs at a time, guarded by an in-memory flag and `sync_state.last_status = 'RUNNING'`.
- New emails are inserted as `PENDING`. When sync finishes it emits `emails.synced`.
- **Classification** runs through `POST /emails/classify-pending` and processes one email at a time, because Ollama handles one request at a time on a laptop. A listener for `emails.synced` (`@OnEvent`) arrives with sync.
- Emails are claimed in one SQL step: `UPDATE emails SET processing_status = 'PROCESSING' WHERE id = $1 AND user_id = $2 AND processing_status = 'PENDING' RETURNING ...`. No row back means someone else took it. `POST /emails/:id/classify` can also claim a `CLASSIFIED` or `FAILED` email to re-run it.
- A bad reply or a timeout counts as one attempt and sends the email back to `PENDING`. After 3 attempts it stays `FAILED` until someone re-runs it. An unreachable Ollama counts nothing: the email is released and the batch stops with a 503.
- An email that already has a classification returns to `CLASSIFIED` after a failed re-run, never `PENDING`. Otherwise the next batch would replace its earlier answer, including a manual correction.
- `PUT /emails/:id/category` returns 409 while the email is `PROCESSING`, so an AI result cannot land after a correction and replace it.
- On startup, emails stuck in `PROCESSING` are reset to `PENDING`.
- `app.enableShutdownHooks()` lets Nest stop intervals and close the database connection on `Ctrl+C`.

Sync and classification communicate through events, so the two modules do not call each other directly. A queue (BullMQ and Redis) and a separate worker are possible later if this becomes slow or multi-user.

## 9. Security

| Area | Approach |
|---|---|
| OAuth | Authorisation code flow with PKCE via MSAL. Random `state` kept in the session and checked on callback |
| Session | `httpOnly`, `sameSite: "lax"` cookie signed with `SESSION_SECRET`. Session regenerated after login |
| Tokens | MSAL cache encrypted with AES-256-GCM (`node:crypto`) using `TOKEN_ENCRYPTION_KEY`. Never logged, returned by the API or sent to the LLM |
| SQL | Parameterised queries only |
| Input | Global `ValidationPipe` with `whitelist` and `forbidNonWhitelisted` |
| Ownership | Every repository query filters by `user_id` |
| Email content | Stored as plain text, escaped by React, never logged |
| AI output | Treated as untrusted: validated, never executed |
| Permissions | No `Mail.Send`. `Mail.ReadWrite` only once draft saving is built |
| Secrets | Only in gitignored `.env` files (root for Docker, `backend/` for the API); only `.env.example` templates are committed. GitHub push protection on |
| Swagger | Local only. Would be disabled or protected if deployed |
| Data control | User can disconnect Microsoft and delete all data from Settings |

## 10. Repository layout

```text
scout/
|-- docker-compose.yml        PostgreSQL (scout, scout_test)
|-- .env.example              database credentials for Docker (copy to .env)
|-- docker/init-test-db.sql
|-- docs/
|   |-- ARCHITECTURE.md
|   |-- decisions/            short decision records
|-- backend/
|   |-- eval/                 labelled dataset and eval runner
|   |-- test/
|   |   |-- unit/             unit tests, mirroring src/ (e.g. test/unit/modules/emails/emails.service.spec.ts)
|   |   |-- *.e2e-spec.ts     end-to-end API tests (run one at a time: they share one database)
|   |   |-- setup-e2e.ts      Jest globalSetup: migrates the scout_test database before e2e runs
|   |-- src/
|       |-- config/           env validation
|       |-- database/         data source, migrations, seed
|       |-- common/           guards, decorators, filters, shared DTOs, crypto
|       |-- ai/               provider interface, Ollama provider, prompts
|       |-- integrations/microsoft-graph/
|       |-- modules/          feature modules
|-- frontend/
    |-- src/                  pages, components, api.ts
```

Tests live outside `src/`, in `backend/test/`:

- **Unit tests** go in `test/unit/` as `*.spec.ts`, mirroring the `src/` path of the file they test. `src/modules/emails/emails.service.ts` is tested by `test/unit/modules/emails/emails.service.spec.ts`.
- **End-to-end tests** go in `test/` as `*.e2e-spec.ts`.

Nest's generators create a spec next to each new file, so pass `--no-spec` (e.g. `npx nest g service modules/emails --no-spec`) and write the test in `test/unit/` yourself.
