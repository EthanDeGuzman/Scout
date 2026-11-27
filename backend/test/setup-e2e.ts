import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

/**
 * Jest globalSetup for the e2e suite. Runs once before any test file and
 * applies pending migrations to the test database, so `npm run test:e2e`
 * works on a fresh scout_test locally and in CI.
 */
export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = 'test';

  // Same file ConfigModule reads in test mode. loadEnvFile never overrides
  // variables that are already set, so CI's DATABASE_URL wins.
  if (existsSync('.env.test')) process.loadEnvFile('.env.test');

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('e2e setup: DATABASE_URL is not set (check .env.test)');
  }

  // Never migrate anything but a test database.
  const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `e2e setup: refusing to migrate "${dbName}". The database name must end in "_test".`,
    );
  }

  // Own DataSource rather than src/database/data-source.ts, which loads .env
  // (the dev database) as a side effect on import.
  const dataSource = new DataSource({
    type: 'postgres',
    url,
    synchronize: false,
    logging: false,
    entities: [],
    migrations: [join(__dirname, '../src/database/migrations/**/*.{ts,js}')],
  });

  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}
