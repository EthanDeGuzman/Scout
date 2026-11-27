import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { DEMO_USER_EMAIL } from '../src/database/demo-user';
import { GetEmailResponseDto } from '../src/modules/emails/dto/get-email-response.dto';
import { ListEmailsResponseDto } from '../src/modules/emails/dto/list-emails-response.dto';
import { createTestApp } from './helpers/create-test-app';

interface TestEmail {
  key: string;
  subject: string;
  senderName: string;
  senderAddress: string;
  receivedAt: string;
  classifications?: {
    category: string;
    createdAt: string;
    requiresAction?: boolean;
    needsReview?: boolean;
    confidence?: number;
  }[];
}

// Newest first: interview, digest, question, job, reclassified.
const DEMO_EMAILS: TestEmail[] = [
  {
    key: 'interview',
    subject: 'Interview invitation',
    senderName: 'Priya Shah',
    senderAddress: 'priya@acme.example',
    receivedAt: '2026-01-05T10:00:00Z',
    classifications: [
      {
        category: 'INTERVIEW',
        createdAt: '2026-01-05T10:01:00Z',
        requiresAction: true,
        confidence: 0.9,
      },
    ],
  },
  {
    key: 'digest',
    subject: 'Weekly digest',
    senderName: 'JS Weekly',
    senderAddress: 'news@jsweekly.example',
    receivedAt: '2026-01-04T10:00:00Z',
    classifications: [
      { category: 'NEWSLETTER', createdAt: '2026-01-04T10:01:00Z' },
    ],
  },
  {
    // No classification: this email is still waiting to be processed.
    key: 'question',
    subject: 'Quick question',
    senderName: 'Sam',
    senderAddress: 'sam@example.com',
    receivedAt: '2026-01-03T10:00:00Z',
  },
  {
    // The literal "%" is used to prove the search escapes wildcards.
    key: 'job',
    subject: 'Job at 100% remote company',
    senderName: 'TalentBlast',
    senderAddress: 'jobs@talentblast.example',
    receivedAt: '2026-01-02T10:00:00Z',
    classifications: [
      {
        category: 'JOB_OPPORTUNITY',
        createdAt: '2026-01-02T10:01:00Z',
        needsReview: true,
      },
    ],
  },
  {
    // Classified twice. Only the newer classification (PERSONAL) should show.
    key: 'reclassified',
    subject: 'Reclassified email',
    senderName: 'Alex',
    senderAddress: 'alex@example.com',
    receivedAt: '2026-01-01T10:00:00Z',
    classifications: [
      { category: 'OTHER', createdAt: '2026-01-01T10:01:00Z' },
      { category: 'PERSONAL', createdAt: '2026-01-01T10:05:00Z' },
    ],
  },
];

// The public contract. If a column is added to the SQL SELECT, the tests
// below fail until it is added here on purpose.
const LIST_FIELDS = [
  'id',
  'subject',
  'senderName',
  'senderAddress',
  'receivedAt',
  'isRead',
  'processingStatus',
  'category',
  'requiresAction',
  'needsReview',
  'confidence',
];
const DETAIL_FIELDS = [
  ...LIST_FIELDS,
  'toAddresses',
  'bodyText',
  'reason',
  'extracted',
  'lastError',
];

describe('Emails (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let demoUserId: string;
  let otherUserId: string;
  let otherUsersEmailId: string;
  let interviewEmailId: string;

  async function insertEmail(
    userId: string,
    email: TestEmail,
  ): Promise<string> {
    const [row]: { id: string }[] = await dataSource.query(
      `INSERT INTO emails
         (user_id, graph_message_id, subject, sender_name, sender_address,
          to_addresses, body_text, received_at, processing_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        userId,
        `e2e-${email.key}`,
        email.subject,
        email.senderName,
        email.senderAddress,
        DEMO_USER_EMAIL,
        `Body of ${email.subject}`,
        email.receivedAt,
        email.classifications ? 'CLASSIFIED' : 'PENDING',
      ],
    );

    for (const c of email.classifications ?? []) {
      await dataSource.query(
        `INSERT INTO email_classifications
           (email_id, source, category, confidence, requires_action,
            needs_review, reason, created_at)
         VALUES ($1, 'AI', $2, $3, $4, $5, 'e2e', $6)`,
        [
          row.id,
          c.category,
          c.confidence ?? null,
          c.requiresAction ?? false,
          c.needsReview ?? false,
          c.createdAt,
        ],
      );
    }
    return row.id;
  }

  beforeAll(async () => {
    app = await createTestApp({ silent: true });
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
       VALUES ('other@scout.test', 'Other User')
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
    );
    demoUserId = demo.id;
    otherUserId = other.id;

    // Start from a known state: the demo user has exactly the emails below.
    await dataSource.query(`DELETE FROM emails WHERE user_id = ANY($1)`, [
      [demoUserId, otherUserId],
    ]);

    for (const email of DEMO_EMAILS) {
      const id = await insertEmail(demoUserId, email);
      if (email.key === 'interview') interviewEmailId = id;
    }
    otherUsersEmailId = await insertEmail(otherUserId, {
      key: 'other',
      subject: "Other user's email",
      senderName: 'Someone',
      senderAddress: 'someone@example.com',
      receivedAt: '2026-01-06T10:00:00Z',
      classifications: [
        { category: 'INTERVIEW', createdAt: '2026-01-06T10:01:00Z' },
      ],
    });
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM emails WHERE user_id = ANY($1)`, [
      [demoUserId, otherUserId],
    ]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [otherUserId]);
    await app.close();
  });

  const list = async (query = ''): Promise<ListEmailsResponseDto> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/emails${query}`)
      .expect(200);
    return res.body as ListEmailsResponseDto;
  };

  describe('GET /api/v1/emails', () => {
    it('returns the pagination envelope with emails newest first', async () => {
      const body = await list();

      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.total).toBe(5);
      expect(body.data.map((e) => e.subject)).toEqual([
        'Interview invitation',
        'Weekly digest',
        'Quick question',
        'Job at 100% remote company',
        'Reclassified email',
      ]);
    });

    it("never includes another user's emails", async () => {
      const body = await list();

      expect(body.data.map((e) => e.id)).not.toContain(otherUsersEmailId);
    });

    it('includes the classification fields, with confidence as a number', async () => {
      const body = await list('?category=INTERVIEW');

      expect(body.data[0]).toMatchObject({
        category: 'INTERVIEW',
        requiresAction: true,
        needsReview: false,
        confidence: 0.9,
      });
    });

    it('returns exactly the documented list fields', async () => {
      const body = await list('?pageSize=1');

      expect(Object.keys(body.data[0]).sort()).toEqual([...LIST_FIELDS].sort());
    });

    it('returns null classification fields for an unclassified email', async () => {
      const body = await list('?q=quick');

      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        processingStatus: 'PENDING',
        category: null,
        requiresAction: null,
        needsReview: null,
        confidence: null,
      });
    });

    describe('pagination', () => {
      it('returns the requested page and keeps the full total', async () => {
        const body = await list('?page=2&pageSize=2');

        expect(body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
        expect(body.data.map((e) => e.subject)).toEqual([
          'Quick question',
          'Job at 100% remote company',
        ]);
      });

      it('returns a short last page', async () => {
        const body = await list('?page=3&pageSize=2');

        expect(body.data).toHaveLength(1);
        expect(body.total).toBe(5);
      });

      it('returns an empty page past the end', async () => {
        const body = await list('?page=10');

        expect(body.data).toEqual([]);
        expect(body.total).toBe(5);
      });
    });

    describe('filters', () => {
      it('filters by category', async () => {
        const body = await list('?category=NEWSLETTER');

        expect(body.total).toBe(1);
        expect(body.data[0].subject).toBe('Weekly digest');
      });

      it('uses only the latest classification when filtering', async () => {
        const personal = await list('?category=PERSONAL');
        const other = await list('?category=OTHER');

        expect(personal.data.map((e) => e.subject)).toEqual([
          'Reclassified email',
        ]);
        expect(other.total).toBe(0);
      });

      it('filters by requiresAction=true', async () => {
        const body = await list('?requiresAction=true');

        expect(body.data.map((e) => e.subject)).toEqual([
          'Interview invitation',
        ]);
      });

      it('treats requiresAction=false as false, not true', async () => {
        const body = await list('?requiresAction=false');

        expect(body.data.every((e) => e.requiresAction === false)).toBe(true);
        // Unclassified emails have no value, so they are not included.
        expect(body.total).toBe(3);
      });

      it('filters by needsReview', async () => {
        const body = await list('?needsReview=true');

        expect(body.data.map((e) => e.subject)).toEqual([
          'Job at 100% remote company',
        ]);
      });

      it('combines filters with AND', async () => {
        const match = await list('?category=JOB_OPPORTUNITY&needsReview=true');
        const noMatch = await list('?category=INTERVIEW&needsReview=true');

        expect(match.total).toBe(1);
        expect(noMatch.total).toBe(0);
      });
    });

    describe('search', () => {
      it('matches the subject, ignoring case', async () => {
        const body = await list('?q=INTERVIEW');

        expect(body.data.map((e) => e.subject)).toEqual([
          'Interview invitation',
        ]);
      });

      it('matches the sender name', async () => {
        const body = await list('?q=priya');

        expect(body.total).toBe(1);
      });

      it('matches the sender address', async () => {
        const body = await list('?q=jsweekly');

        expect(body.data.map((e) => e.subject)).toEqual(['Weekly digest']);
      });

      it('treats % as a literal character, not a wildcard', async () => {
        const body = await list('?q=%25');

        expect(body.data.map((e) => e.subject)).toEqual([
          'Job at 100% remote company',
        ]);
      });

      it('treats a SQL injection attempt as plain text', async () => {
        const body = await list("?q=';DROP TABLE emails;--");

        expect(body.total).toBe(0);
        expect((await list()).total).toBe(5);
      });

      it('combines search with filters and pagination', async () => {
        const body = await list('?q=e&category=INTERVIEW&pageSize=1');

        expect(body).toMatchObject({ total: 1, pageSize: 1 });
      });

      it('ignores a search made only of spaces', async () => {
        const body = await list('?q=%20%20');

        expect(body.total).toBe(5);
      });

      it('trims spaces around the search term', async () => {
        const body = await list('?q=%20priya%20');

        expect(body.total).toBe(1);
      });
    });

    describe('validation', () => {
      it.each([
        ['pageSize above 100', '?pageSize=101'],
        ['pageSize of 0', '?pageSize=0'],
        ['page of 0', '?page=0'],
        ['a non-numeric page', '?page=abc'],
        ['an unknown category', '?category=NOPE'],
        ['a non-boolean requiresAction', '?requiresAction=maybe'],
        ['a search over 200 characters', `?q=${'a'.repeat(201)}`],
        ['an unknown query parameter', '?foo=1'],
      ])('returns 400 for %s', async (_name, query) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/emails${query}`)
          .expect(400);

        expect(res.body).toMatchObject({
          error: { code: 'VALIDATION_ERROR', message: 'Validation failed' },
        });
      });
    });
  });

  describe('GET /api/v1/emails/:id', () => {
    it('returns the email with its latest classification', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/emails/${interviewEmailId}`)
        .expect(200);
      const body = res.body as GetEmailResponseDto;

      expect(body).toMatchObject({
        id: interviewEmailId,
        subject: 'Interview invitation',
        senderName: 'Priya Shah',
        senderAddress: 'priya@acme.example',
        toAddresses: DEMO_USER_EMAIL,
        bodyText: 'Body of Interview invitation',
        category: 'INTERVIEW',
        requiresAction: true,
        reason: 'e2e',
        confidence: 0.9,
      });
    });

    it('returns exactly the documented detail fields', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/emails/${interviewEmailId}`)
        .expect(200);

      expect(Object.keys(res.body as object).sort()).toEqual(
        [...DETAIL_FIELDS].sort(),
      );
    });

    it('returns 400 for an id that is not a UUID', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/emails/not-a-uuid')
        .expect(400);

      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    });

    it('returns 404 for an email that does not exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/emails/00000000-0000-4000-8000-000000000000')
        .expect(404);

      expect(res.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'Email not found', details: null },
      });
    });

    it("returns 404, not 403, for another user's email", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/emails/${otherUsersEmailId}`)
        .expect(404);

      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });
  });
});
