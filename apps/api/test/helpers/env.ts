import os from 'node:os';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

/** Point a connection string at another database on the same server. */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

const TEST_DB = process.env.TEST_DATABASE_NAME ?? 'manorg_test';
const appUrl =
  process.env.DATABASE_URL ?? 'postgresql://manorg_app:manorg_app_dev@localhost:5432/manorg';
const ownerUrl =
  process.env.DATABASE_MIGRATION_URL ??
  'postgresql://manorg_owner:manorg_owner_dev@localhost:5432/manorg';

/** Tests always run against a separate database, never the development one. */
export const testEnv = {
  database: TEST_DB,
  appUrl: withDatabase(appUrl, TEST_DB),
  ownerUrl: withDatabase(ownerUrl, TEST_DB),
  adminUrl: withDatabase(ownerUrl, 'postgres'),
};

export function applyTestEnv(): void {
  process.env.DATABASE_URL = testEnv.appUrl;
  process.env.DATABASE_MIGRATION_URL = testEnv.ownerUrl;
  process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdef';
  process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789abcdef';
  process.env.AUTH_RATE_LIMIT_PER_MINUTE ??= '100000';
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_DIR = path.join(os.tmpdir(), 'manorg-test-storage');
  process.env.NODE_ENV = 'test';
}
