import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthService } from '../src/modules/health/health.service';
import { createTestApp } from './helpers/create-test-app';

describe('Health (e2e)', () => {
  describe('with a reachable database', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /api/v1/health returns 200 with status ok', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200)
        .expect({ status: 'ok', database: 'up' });
    });

    it('an unknown route returns the standard error shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/nope')
        .expect(404);

      expect(res.body).toMatchObject({
        error: { code: 'NOT_FOUND', details: null },
      });
    });
  });

  describe('with an unreachable database', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createTestApp({
        silent: true, // the 503 below is deliberate; keep the output clean
        override: (builder) =>
          builder
            .overrideProvider(HealthService)
            .useValue({ checkDatabase: () => Promise.resolve(false) }),
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /api/v1/health returns 503 with SERVICE_UNAVAILABLE', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(503);

      expect(res.body).toEqual({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database is unreachable',
          details: null,
        },
      });
    });
  });
});
