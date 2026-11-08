import { type PrismaClient } from '../../src/generated/prisma/client';
import {
  createPrismaClient,
  type DbContext,
  type Tx,
  withDbContext,
} from '../../src/database/prisma-client';
import { testEnv } from './env';

let owner: PrismaClient | undefined;
let app: PrismaClient | undefined;

/** Table owner: subject to FORCE ROW LEVEL SECURITY, so fixtures set a context too. */
export function ownerDb(): PrismaClient {
  owner ??= createPrismaClient(testEnv.ownerUrl);
  return owner;
}

/** The runtime role the API uses. */
export function appDb(): PrismaClient {
  app ??= createPrismaClient(testEnv.appUrl);
  return app;
}

export function asOwner<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withDbContext(ownerDb(), ctx, fn);
}

export function asApp<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withDbContext(appDb(), ctx, fn);
}

/** Empties every table. TRUNCATE is not filtered by row-level security. */
export async function resetDatabase(): Promise<void> {
  const rows = await ownerDb().$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await ownerDb().$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function disconnectDatabases(): Promise<void> {
  await Promise.all([owner?.$disconnect(), app?.$disconnect()]);
  owner = undefined;
  app = undefined;
}
