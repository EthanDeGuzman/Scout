import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

if (existsSync('.env')) process.loadEnvFile();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    'Missing required environment variable: DATABASE_URL is required',
  );
}

export default new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  synchronize: false,
  logging: false,
  entities: [],
  migrations: [join(__dirname, 'migrations/**/*.{ts,js}')],
});
