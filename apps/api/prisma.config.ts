import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The repo keeps one .env at its root; Prisma commands run from apps/api.
loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Migrations and the seed run as the table owner; the API connects with DATABASE_URL.
    url: process.env.DATABASE_MIGRATION_URL ?? '',
  },
});
