import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

interface CreateTestAppOptions {
  /** Swap providers for fakes, e.g. builder.overrideProvider(X).useValue(y). */
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  /** Hide Nest's log output, for tests that trigger errors on purpose. */
  silent?: boolean;
}

/** Builds the app the same way main.ts does (AppModule + configureApp). */
export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<INestApplication<App>> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (options.override?.(builder) ?? builder).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  if (options.silent) app.useLogger(false);
  configureApp(app);
  await app.init();
  return app;
}
