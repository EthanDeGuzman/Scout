import { INestApplication } from '@nestjs/common';

/**
 * Setup that must be applied to the app instance itself (providers such as
 * the filter and pipe live in AppModule). Shared by main.ts and the e2e
 * tests so the two can't drift apart.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
}
