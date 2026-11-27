# Scout

A personal AI email assistant for job hunting. Scout connects to an Outlook inbox, uses a **local LLM** to sort incoming email and pull out job details, tracks applications in one place, and drafts replies for you to review.

Everything runs on your own machine: no paid services, and your email never goes to a third-party AI API.

> **Status:** early development. The backend has its foundation, the emails API and AI classification. The classification evaluation, job tracker, reply drafting, Outlook sync and frontend are still to come (see [Roadmap](#roadmap)).

## Features

- **Outlook sync:** pulls recent Inbox messages through Microsoft Graph (read-only to start).
- **AI classification:** labels each email (job opportunity, interview, rejection, and so on) and extracts company, role, location and salary, with a confidence score and a "needs review" flag.
- **Job tracker:** turns emails into applications with a status and a timeline of interviews and notes.
- **Reply drafting:** generates a draft in a chosen tone using your career profile. Drafts are only saved to Outlook when you click; Scout never sends email.
- **Dashboard:** applications by status, upcoming interviews and recent activity.
- **Demo mode:** a seeded demo user with fake emails, so the app works without a Microsoft account.

## Tech stack

| Area | Technology |
|---|---|
| Backend | NestJS 11, TypeScript |
| Database | PostgreSQL 17 (Docker), hand-written SQL via TypeORM `query()`, raw-SQL migrations |
| AI | Ollama running a local 7-14B instruct model |
| Auth | Microsoft OAuth (auth code + PKCE) with MSAL; sessions stored in PostgreSQL |
| Frontend | React, Vite, React Router |
| API docs | Swagger UI |
| Testing | Jest, Supertest |

## Architecture

```text
React (Vite :5173) --/api--> NestJS API (:3001) --> PostgreSQL (:5432)
                                  |
                                  +--> Ollama (:11434)         local LLM
                                  +--> Microsoft Graph         Outlook
```

A modular monolith: feature modules (`emails`, `classification`, `drafts`, `jobs`, ...) each split into controller, service and repository. Notable decisions:

- **No ORM entities.** Every query is explicit, parameterised SQL.
- **AI behind an interface**, so tests run against a fake provider without Ollama.
- **Versioned prompts and an evaluation script** to compare models and prompts using measured accuracy.
- **Untrusted email content:** prompt-injection defences, validated model output, and no tools given to the model.

Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getting started

### Prerequisites

- Node.js 22 (`.nvmrc` is included; use `nvm use` or `fnm use`)
- Docker Desktop
- [Ollama](https://ollama.com) with a model pulled, for example `ollama pull qwen3.5:9b`. Set `OLLAMA_MODEL` in `backend/.env` to the same name.

### Run it

```bash
# 1. Start PostgreSQL (creates the scout and scout_test databases)
cp .env.example .env          # then set POSTGRES_PASSWORD in .env
docker compose up -d

# 2. Configure the backend
cd backend
cp .env.example .env
# set the password in DATABASE_URL (same as POSTGRES_PASSWORD above)
# set SESSION_SECRET and TOKEN_ENCRYPTION_KEY:  openssl rand -base64 32

# 3. Install, apply migrations and start the API
npm install
npm run migration:run
npm run start:dev
```

The API runs on http://localhost:3001 (change `PORT` in `backend/.env` if it is taken). Check it with:

```bash
curl http://localhost:3001/api/v1/health
# {"status":"ok","database":"up"}
```

Swagger UI is at http://localhost:3001/api/docs.

### Try the classification

With `AUTH_MODE=demo` you are logged in as the seeded demo user. From `backend/`:

```bash
npm run db:seed
curl -X POST http://localhost:3001/api/v1/emails/classify-pending
# {"found":4,"classified":4,"failed":0}
```

The 4 unclassified seed emails go to Ollama one at a time, and the response counts the outcomes. `POST /emails/:id/classify` re-runs one email and `PUT /emails/:id/category` corrects a category. Both are in Swagger UI.

### API conventions

- All routes are under `/api/v1`.
- Errors always use one shape, whatever went wrong. Stack traces are never returned:

  ```json
  { "error": { "code": "NOT_FOUND", "message": "Email not found", "details": null } }
  ```

  Codes: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMIT_EXCEEDED`, `INTERNAL_ERROR`, `UPSTREAM_ERROR`, `SERVICE_UNAVAILABLE`, `AI_UNAVAILABLE`.

The frontend, once built out in a later milestone:

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
```

### Useful commands

Run from `backend/`:

| Command | What it does |
|---|---|
| `npm run start:dev` | Start the API in watch mode |
| `npm test` | Unit tests (`test/unit/`) |
| `npm run test:e2e` | End-to-end API tests (needs Postgres running and `.env.test`, see below) |
| `npm run lint` | Lint and auto-fix (`lint:check` only reports) |
| `npm run migration:create -- src/database/migrations/<Name>` | Create a migration |
| `npm run migration:run` / `migration:revert` | Apply / undo migrations |
| `npm run db:seed` | Load the demo user and 20 fake emails; 4 are left unclassified |
| `npm run eval` | Score the AI against the labelled dataset (needs `eval/run-eval.ts`, Milestone 3) |

### Running the tests

Unit tests need nothing else. End-to-end tests use the `scout_test` database, which Docker creates for you:

```bash
cd backend
cp .env.example .env.test
# in .env.test: set NODE_ENV=test and point DATABASE_URL at the scout_test database
npm run test:e2e
```

The app reads `.env.test` instead of `.env` whenever `NODE_ENV=test`, which Jest sets itself, so tests never touch your development data.

Before each e2e run, `test/setup-e2e.ts` applies pending migrations to the test database, so you never migrate it by hand. It refuses to run against any database whose name does not end in `_test`. The e2e files run one at a time because they share that database.

### Environment variables

Two files, both gitignored once copied: the root [`.env.example`](.env.example) (database credentials for Docker) and [`backend/.env.example`](backend/.env.example) (the API). `AUTH_MODE=demo` needs no Microsoft setup; `AUTH_MODE=microsoft` requires an Entra app registration (`MS_CLIENT_ID`, `MS_CLIENT_SECRET`).

## Project structure

```text
scout/
|-- backend/        NestJS API (src/, test/, eval/)
|-- frontend/       React app
|-- docs/           architecture and decision records
|-- docker/         database init scripts
|-- docker-compose.yml
|-- .env.example    database credentials for Docker
```

## Privacy

Scout can connect to a real mailbox, so:

- Real email content is never committed. Seed data and the evaluation set are hand-written.
- `.env` is gitignored; only `.env.example` is committed.
- Only the Inbox is synced, and only the last 30 days by default.
- Email bodies and tokens are never logged. Tokens are stored encrypted (AES-256-GCM).
- Scout never requests `Mail.Send`.

## Roadmap

- [x] Backend foundation: config, database, migrations, error handling, health check, CI
- [x] Emails in the database (demo mode)
- [ ] AI classification and evaluation (classification done, evaluation to do)
- [ ] Job tracker and dashboard
- [ ] Career profile and reply drafting
- [ ] Outlook connection and sync
- [ ] Save drafts to Outlook
- [ ] Frontend
- [ ] Polish and documentation

## License

[MIT](LICENSE)
