import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { env } from '../config/env';
import { type PrismaClient } from '../generated/prisma/client';
import { createPrismaClient, type DbContext, type Tx, withDbContext } from './prisma-client';

/**
 * The only way services reach the database. Every call runs in a transaction with the tenant
 * settings applied, so row-level security filters every query (CLAUDE.md rule 1).
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly client: PrismaClient = createPrismaClient(env().DATABASE_URL);

  run<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withDbContext(this.client, ctx, fn);
  }

  /** Readiness probe. Does not read organization data. */
  async ping(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
