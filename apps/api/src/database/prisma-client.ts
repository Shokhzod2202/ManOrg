import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

/**
 * Who the database should act for. Row-level security policies read these two settings, so they
 * must come from verified server state (the access token and the active membership), never from
 * request input alone (spec section 12).
 */
export interface DbContext {
  organizationId: string | null;
  userId: string | null;
}

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * Runs `fn` in one transaction with the tenant settings applied for that transaction only
 * (`set_config(..., true)`), so a pooled connection never carries them into another request.
 */
export async function withDbContext<T>(
  client: PrismaClient,
  ctx: DbContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.organization_id', ${ctx.organizationId ?? ''}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
    return fn(tx);
  });
}
