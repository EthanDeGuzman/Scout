import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AiInvalidOutputException } from '../src/ai/ai-invalid-output.exception';
import {
  AI_PROVIDER,
  ClassificationResult,
} from '../src/ai/ai-provider.interface';
import { AiUnavailableException } from '../src/common/errors/ai-unavailable.exception';
import { DEMO_USER_EMAIL } from '../src/database/demo-user';
import { GetEmailResponseDto } from '../src/modules/emails/dto/get-email-response.dto';
import { EmailCategory } from '../src/modules/emails/email-category.enum';
import { createTestApp } from './helpers/create-test-app';

const NO_SUCH_EMAIL = '00000000-0000-4000-8000-000000000000';

const aiResult: ClassificationResult = {
  category: EmailCategory.JOB_OPPORTUNITY,
  confidence: 0.9,
  requiresAction: true,
  reason: 'recruiter outreach',
  extracted: {
    company: 'Acme',
    jobTitle: null,
    location: null,
    salary: null,
    recruiterName: null,
  },
  needsReview: false,
  modelName: 'fake-model',
  promptVersion: 'fake_v1',
  durationMs: 12,
};

interface ClassificationRow {
  source: string;
  category: string;
  confidence: string | null;
  requires_action: boolean;
  needs_review: boolean;
  extracted: Record<string, unknown> | null;
  model_name: string | null;
  prompt_version: string | null;
  duration_ms: number | null;
}

interface EmailRow {
  processing_status: string;
  processing_attempts: number;
  last_error: string | null;
}

// These tests drive the real HTTP routes and the real database. Only the AI
// is replaced by a fake we control, so no Ollama is needed.
describe('Classification (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let demoUserId: string;
  let otherUserId: string;
  const classifyEmail = jest.fn();

  async function insertEmail(
    userId: string,
    key: string,
    status: string,
  ): Promise<string> {
    const [row]: { id: string }[] = await dataSource.query(
      `INSERT INTO emails
         (user_id, graph_message_id, subject, sender_name, sender_address,
          to_addresses, body_text, received_at, processing_status)
       VALUES ($1, $2, $3, 'Sender', 'sender@example.com', $4, $5, now(), $6)
       RETURNING id`,
      [
        userId,
        `e2e-classify-${key}`,
        `Subject ${key}`,
        DEMO_USER_EMAIL,
        `Body ${key}`,
        status,
      ],
    );
    return row.id;
  }

  /** Adds an older answer, as if the email had been classified earlier. */
  async function insertClassification(
    emailId: string,
    source: 'AI' | 'MANUAL',
    category: string,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO email_classifications
         (email_id, source, category, requires_action, needs_review, created_at)
       VALUES ($1, $2, $3, false, false, now() - interval '1 hour')`,
      [emailId, source, category],
    );
  }

  const rowsFor = (emailId: string): Promise<ClassificationRow[]> =>
    dataSource.query(
      `SELECT source, category, confidence::float8 AS confidence, requires_action,
              needs_review, extracted, model_name, prompt_version, duration_ms
         FROM email_classifications
        WHERE email_id = $1
        ORDER BY created_at, id`,
      [emailId],
    );

  const emailRow = async (emailId: string): Promise<EmailRow> => {
    const [row]: EmailRow[] = await dataSource.query(
      `SELECT processing_status, processing_attempts, last_error
         FROM emails WHERE id = $1`,
      [emailId],
    );
    return row;
  };

  const clearEmails = () =>
    dataSource.query(`DELETE FROM emails WHERE user_id = ANY($1)`, [
      [demoUserId, otherUserId],
    ]);

  beforeAll(async () => {
    app = await createTestApp({
      silent: true,
      override: (builder) =>
        builder.overrideProvider(AI_PROVIDER).useValue({ classifyEmail }),
    });
    dataSource = app.get(DataSource);

    // This file deletes rows, so refuse to run against anything but a test DB.
    const [{ name }]: { name: string }[] = await dataSource.query(
      `SELECT current_database() AS name`,
    );
    if (!name.endsWith('_test')) {
      throw new Error(`Refusing to run e2e tests against database "${name}"`);
    }

    const [demo]: { id: string }[] = await dataSource.query(
      `INSERT INTO users (email, display_name)
       VALUES ($1, 'Demo User')
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [DEMO_USER_EMAIL],
    );
    const [other]: { id: string }[] = await dataSource.query(
      `INSERT INTO users (email, display_name)
       VALUES ('other-classify@scout.test', 'Other User')
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
    );
    demoUserId = demo.id;
    otherUserId = other.id;
  });

  beforeEach(async () => {
    await clearEmails(); // each test builds the emails it needs
    classifyEmail.mockReset();
  });

  afterAll(async () => {
    await clearEmails();
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [otherUserId]);
    await app.close();
  });

  describe('POST /api/v1/emails/:id/classify', () => {
    it('classifies a pending email and stores the result', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');
      classifyEmail.mockResolvedValue(aiResult);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(200);

      const body = res.body as GetEmailResponseDto;
      expect(body).toMatchObject({
        id,
        processingStatus: 'CLASSIFIED',
        category: 'JOB_OPPORTUNITY',
        requiresAction: true,
        confidence: 0.9,
      });

      const rows = await rowsFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        source: 'AI',
        category: 'JOB_OPPORTUNITY',
        model_name: 'fake-model',
        prompt_version: 'fake_v1',
        duration_ms: 12,
        extracted: aiResult.extracted,
      });
    });

    it('passes the email text to the AI and nothing else', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');
      classifyEmail.mockResolvedValue(aiResult);

      await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(200);

      expect(classifyEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Subject a',
          senderAddress: 'sender@example.com',
          bodyText: 'Body a',
        }),
      );
    });

    it('re-classifies an already classified email as a new row', async () => {
      const id = await insertEmail(demoUserId, 'a', 'CLASSIFIED');
      await insertClassification(id, 'AI', 'OTHER');
      classifyEmail.mockResolvedValue({
        ...aiResult,
        category: EmailCategory.NEWSLETTER,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(200);

      expect((res.body as GetEmailResponseDto).category).toBe('NEWSLETTER');
      const rows = await rowsFor(id);
      expect(rows.map((r) => r.category)).toEqual(['OTHER', 'NEWSLETTER']);
    });

    it('keeps a manual correction when a re-run returns invalid output', async () => {
      const id = await insertEmail(demoUserId, 'a', 'CLASSIFIED');
      await insertClassification(id, 'MANUAL', 'PERSONAL');
      classifyEmail.mockRejectedValue(new AiInvalidOutputException());

      const res = await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(200);

      expect(res.body).toMatchObject({
        processingStatus: 'CLASSIFIED',
        category: 'PERSONAL',
      });
      expect(await emailRow(id)).toMatchObject({
        processing_status: 'CLASSIFIED',
        processing_attempts: 1,
      });

      // And the next batch leaves it alone.
      const batch = await request(app.getHttpServer())
        .post('/api/v1/emails/classify-pending')
        .expect(200);
      expect(batch.body).toEqual({ found: 0, classified: 0, failed: 0 });
      expect(await rowsFor(id)).toHaveLength(1);
    });

    it('keeps a classified email CLASSIFIED when the AI is unavailable during a re-run', async () => {
      const id = await insertEmail(demoUserId, 'a', 'CLASSIFIED');
      await insertClassification(id, 'MANUAL', 'PERSONAL');
      classifyEmail.mockRejectedValue(new AiUnavailableException());

      await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(503);

      expect(await emailRow(id)).toMatchObject({
        processing_status: 'CLASSIFIED',
        processing_attempts: 0,
      });
    });

    it('counts a timeout as a failed attempt so it cannot block the queue', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');
      classifyEmail.mockRejectedValue(
        new AiInvalidOutputException('AI request timed out'),
      );

      const res = await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(200);

      expect(res.body).toMatchObject({
        processingStatus: 'PENDING',
        lastError: 'AI request timed out',
      });
      expect((await emailRow(id)).processing_attempts).toBe(1);
    });

    it('keeps the history when it re-classifies', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');
      classifyEmail.mockResolvedValueOnce(aiResult).mockResolvedValueOnce({
        ...aiResult,
        category: EmailCategory.OTHER,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(200);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(200);

      expect((res.body as GetEmailResponseDto).category).toBe('OTHER');
      const rows = await rowsFor(id);
      expect(rows.map((r) => r.category)).toEqual(['JOB_OPPORTUNITY', 'OTHER']);
    });

    it('returns 404 for an email that does not exist', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/emails/${NO_SUCH_EMAIL}/classify`)
        .expect(404);

      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
      expect(classifyEmail).not.toHaveBeenCalled();
    });

    it("returns 404 for another user's email and leaves it alone", async () => {
      const id = await insertEmail(otherUserId, 'other', 'PENDING');

      await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(404);

      expect(classifyEmail).not.toHaveBeenCalled();
      expect((await emailRow(id)).processing_status).toBe('PENDING');
    });

    it('returns 400 for an id that is not a UUID', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/emails/not-a-uuid/classify')
        .expect(400);
    });

    it('returns 409 when the email is already being processed', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PROCESSING');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(409);

      expect(res.body).toMatchObject({ error: { code: 'CONFLICT' } });
      expect(classifyEmail).not.toHaveBeenCalled();
    });

    it('records a failed attempt when the AI output is invalid', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');
      classifyEmail.mockRejectedValue(new AiInvalidOutputException());

      const res = await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(200);

      expect(res.body).toMatchObject({
        processingStatus: 'PENDING',
        lastError: 'AI output failed validation',
      });
      expect(await emailRow(id)).toMatchObject({
        processing_status: 'PENDING',
        processing_attempts: 1,
      });
      expect(await rowsFor(id)).toHaveLength(0);
    });

    it('marks the email FAILED after three bad attempts', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');
      classifyEmail.mockRejectedValue(new AiInvalidOutputException());

      for (let attempt = 0; attempt < 3; attempt++) {
        await request(app.getHttpServer())
          .post(`/api/v1/emails/${id}/classify`)
          .expect(200);
      }

      expect(await emailRow(id)).toMatchObject({
        processing_status: 'FAILED',
        processing_attempts: 3,
      });
    });

    it('returns 503 and counts no attempt when the AI is unavailable', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');
      classifyEmail.mockRejectedValue(new AiUnavailableException());

      const res = await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(503);

      expect(res.body).toMatchObject({ error: { code: 'AI_UNAVAILABLE' } });
      expect(await emailRow(id)).toMatchObject({
        processing_status: 'PENDING',
        processing_attempts: 0,
      });
    });
  });

  describe('POST /api/v1/emails/classify-pending', () => {
    it('classifies only this user’s pending emails', async () => {
      const a = await insertEmail(demoUserId, 'a', 'PENDING');
      const b = await insertEmail(demoUserId, 'b', 'PENDING');
      const done = await insertEmail(demoUserId, 'done', 'CLASSIFIED');
      const others = await insertEmail(otherUserId, 'other', 'PENDING');
      classifyEmail.mockResolvedValue(aiResult);

      const res = await request(app.getHttpServer())
        .post('/api/v1/emails/classify-pending')
        .expect(200);

      expect(res.body).toEqual({ found: 2, classified: 2, failed: 0 });
      expect(classifyEmail).toHaveBeenCalledTimes(2);
      expect((await emailRow(a)).processing_status).toBe('CLASSIFIED');
      expect((await emailRow(b)).processing_status).toBe('CLASSIFIED');
      expect(await rowsFor(done)).toHaveLength(0); // untouched
      expect((await emailRow(others)).processing_status).toBe('PENDING');
    });

    it('does not classify the same email twice when two batches overlap', async () => {
      // Both batches see [slow, fast]. One takes "slow"; the other takes "fast"
      // and finishes it while the first is still busy. The first batch then
      // reaches "fast", which is already done and must not be classified again.
      await insertEmail(demoUserId, 'slow', 'PENDING');
      await insertEmail(demoUserId, 'fast', 'PENDING');
      classifyEmail.mockImplementation(async (email: { subject: string }) => {
        const delayMs = email.subject === 'Subject slow' ? 200 : 10;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return aiResult;
      });

      const [first, second] = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/emails/classify-pending'),
        request(app.getHttpServer()).post('/api/v1/emails/classify-pending'),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(classifyEmail).toHaveBeenCalledTimes(2); // not 3 or 4
    });

    it('returns zeros when nothing is pending', async () => {
      await insertEmail(demoUserId, 'done', 'CLASSIFIED');

      const res = await request(app.getHttpServer())
        .post('/api/v1/emails/classify-pending')
        .expect(200);

      expect(res.body).toEqual({ found: 0, classified: 0, failed: 0 });
      expect(classifyEmail).not.toHaveBeenCalled();
    });

    it('counts emails whose AI output was invalid as failed and carries on', async () => {
      await insertEmail(demoUserId, 'a', 'PENDING');
      await insertEmail(demoUserId, 'b', 'PENDING');
      classifyEmail
        .mockRejectedValueOnce(new AiInvalidOutputException())
        .mockResolvedValueOnce(aiResult);

      const res = await request(app.getHttpServer())
        .post('/api/v1/emails/classify-pending')
        .expect(200);

      expect(res.body).toEqual({ found: 2, classified: 1, failed: 1 });
    });

    it('returns 503 when the AI is unavailable and leaves the rest pending', async () => {
      const a = await insertEmail(demoUserId, 'a', 'PENDING');
      const b = await insertEmail(demoUserId, 'b', 'PENDING');
      classifyEmail.mockRejectedValue(new AiUnavailableException());

      await request(app.getHttpServer())
        .post('/api/v1/emails/classify-pending')
        .expect(503);

      expect(classifyEmail).toHaveBeenCalledTimes(1); // stopped at the first
      for (const id of [a, b]) {
        expect(await emailRow(id)).toMatchObject({
          processing_status: 'PENDING',
          processing_attempts: 0,
        });
      }
    });
  });

  describe('PUT /api/v1/emails/:id/category', () => {
    const put = (id: string, body: object) =>
      request(app.getHttpServer())
        .put(`/api/v1/emails/${id}/category`)
        .send(body);

    it('adds a MANUAL row and keeps the AI answer in the history', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');
      classifyEmail.mockResolvedValue(aiResult);
      await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(200);

      const res = await put(id, { category: 'PERSONAL' }).expect(200);

      expect(res.body).toMatchObject({ id, category: 'PERSONAL' });
      const rows = await rowsFor(id);
      expect(rows.map((r) => [r.source, r.category])).toEqual([
        ['AI', 'JOB_OPPORTUNITY'],
        ['MANUAL', 'PERSONAL'],
      ]);
    });

    it('leaves the model fields empty and copies requiresAction and extracted', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');
      classifyEmail.mockResolvedValue(aiResult);
      await request(app.getHttpServer())
        .post(`/api/v1/emails/${id}/classify`)
        .expect(200);

      await put(id, { category: 'PERSONAL' }).expect(200);

      const manual = (await rowsFor(id))[1];
      expect(manual).toMatchObject({
        confidence: null,
        model_name: null,
        prompt_version: null,
        duration_ms: null,
        needs_review: false,
        requires_action: true,
        extracted: aiResult.extracted,
      });
    });

    it('works on an email the AI has not classified, and marks it done', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');

      const res = await put(id, { category: 'NEWSLETTER' }).expect(200);

      expect(res.body).toMatchObject({
        category: 'NEWSLETTER',
        processingStatus: 'CLASSIFIED',
      });
      const rows = await rowsFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        source: 'MANUAL',
        requires_action: false,
        extracted: null,
      });
    });

    it('returns 409 and adds no row while the email is being classified', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PROCESSING');

      const res = await put(id, { category: 'PERSONAL' }).expect(409);

      expect(res.body).toMatchObject({ error: { code: 'CONFLICT' } });
      expect(await rowsFor(id)).toHaveLength(0);
    });

    it('rejects an unknown category', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');

      await put(id, { category: 'SPAM' }).expect(400);

      expect(await rowsFor(id)).toHaveLength(0);
    });

    it('rejects a missing category and unexpected fields', async () => {
      const id = await insertEmail(demoUserId, 'a', 'PENDING');

      await put(id, {}).expect(400);
      await put(id, { category: 'OTHER', confidence: 1 }).expect(400);
    });

    it('returns 400 for an id that is not a UUID', async () => {
      await put('not-a-uuid', { category: 'OTHER' }).expect(400);
    });

    it('returns 404 for an email that does not exist', async () => {
      const res = await put(NO_SUCH_EMAIL, { category: 'OTHER' }).expect(404);

      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });

    it("returns 404 for another user's email and adds no row", async () => {
      const id = await insertEmail(otherUserId, 'other', 'PENDING');

      await put(id, { category: 'OTHER' }).expect(404);

      expect(await rowsFor(id)).toHaveLength(0);
    });
  });
});
