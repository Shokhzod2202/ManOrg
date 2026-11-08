import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import { applyTestEnv, testEnv } from './helpers/env';

/** Creates the test database if needed and applies every migration to it. */
export default async function setup(): Promise<void> {
  applyTestEnv();
  const admin = new Client({ connectionString: testEnv.adminUrl });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      testEnv.database,
    ]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${testEnv.database}"`);
    }
  } finally {
    await admin.end();
  }
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_MIGRATION_URL: testEnv.ownerUrl },
    stdio: 'pipe',
  });
}
