/**
 * Tenant isolation at the database layer (CLAUDE.md rule 1, spec sections 12 and 13).
 * These tests talk to PostgreSQL as the API's runtime role, with no application code in between,
 * so they fail if a policy is missing even when every service filters correctly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDb, asApp, disconnectDatabases, ownerDb, resetDatabase } from './helpers/db';
import { createTenantWithEveryTable, type TenantFixture } from './helpers/tenant-fixtures';

/** Global tables with no organization_id; everything else must be isolated. */
const GLOBAL_TABLES = [
  '_prisma_migrations',
  'device_tokens',
  'organizations',
  'refresh_tokens',
  'users',
];

interface TableInfo {
  table: string;
  hasContractorColumn: boolean;
}

let a: TenantFixture;
let b: TenantFixture;
let tenantTables: TableInfo[];

beforeAll(async () => {
  await resetDatabase();
  a = await createTenantWithEveryTable('Alpha');
  b = await createTenantWithEveryTable('Beta');
  const rows = await ownerDb().$queryRaw<{ table: string; contractor: boolean }[]>`
    SELECT c.table_name AS table,
           EXISTS (SELECT 1 FROM information_schema.columns x
                   WHERE x.table_schema = 'public' AND x.table_name = c.table_name
                     AND x.column_name = 'contractor_org_id') AS contractor
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
    ORDER BY c.table_name`;
  tenantTables = rows.map((r) => ({ table: r.table, hasContractorColumn: r.contractor }));
});

afterAll(async () => {
  await disconnectDatabases();
});

async function count(sql: string, ctx: { organizationId: string | null; userId: string | null }) {
  const rows = await asApp(ctx, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(sql));
  return Number(rows[0]?.n ?? 0);
}

describe('row-level security catalog', () => {
  it('every table is either global or carries organization_id', async () => {
    const all = await ownerDb().$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    const scoped = new Set(tenantTables.map((t) => t.table));
    const unscoped = all.map((t) => t.tablename).filter((t) => !scoped.has(t));
    expect(unscoped.sort()).toEqual(GLOBAL_TABLES);
  });

  it('every table with organization_id has RLS enabled, forced and at least one policy', async () => {
    const rows = await ownerDb().$queryRaw<
      { relname: string; enabled: boolean; forced: boolean; policies: bigint }[]
    >`
      SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    const byName = new Map(rows.map((r) => [r.relname, r]));
    const missing = tenantTables
      .map(({ table }) => byName.get(table))
      .filter((r) => !r || !r.enabled || !r.forced || Number(r.policies) === 0)
      .map((r) => r?.relname);
    expect(missing).toEqual([]);
    expect(byName.get('organizations')?.forced).toBe(true);
  });

  it('the runtime role cannot bypass row-level security', async () => {
    const rows = await appDb().$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe('reads are confined to the current organization', () => {
  it('fixtures put rows for both organizations in every tenant table', async () => {
    const empty: string[] = [];
    for (const { table } of tenantTables) {
      for (const t of [a, b]) {
        const n = await count(`SELECT count(*) AS n FROM "${table}"`, {
          organizationId: t.bakeryId,
          userId: t.adminId,
        });
        if (n === 0) empty.push(`${table} (${t.bakeryId})`);
      }
    }
    expect(empty).toEqual([]);
  });

  it('a bakery sees none of the other bakery’s rows in any table', async () => {
    const leaks: string[] = [];
    for (const { table, hasContractorColumn } of tenantTables) {
      const own = hasContractorColumn
        ? `organization_id = '${a.bakeryId}' OR contractor_org_id = '${a.bakeryId}'`
        : `organization_id = '${a.bakeryId}'`;
      const foreign = await count(`SELECT count(*) AS n FROM "${table}" WHERE NOT (${own})`, {
        organizationId: a.bakeryId,
        userId: a.adminId,
      });
      if (foreign > 0) leaks.push(table);
    }
    expect(leaks).toEqual([]);
  });

  it('a contractor sees its own orders and deliveries but not another contractor’s', async () => {
    const ctx = { organizationId: a.contractorId, userId: a.contractorAdminId };
    for (const table of [
      'orders',
      'order_lines',
      'deliveries',
      'delivery_lines',
      'contractor_links',
    ]) {
      expect(await count(`SELECT count(*) AS n FROM "${table}"`, ctx)).toBeGreaterThan(0);
      expect(
        await count(
          `SELECT count(*) AS n FROM "${table}" WHERE contractor_org_id <> '${a.contractorId}'`,
          ctx,
        ),
      ).toBe(0);
    }
    // The bakery's internal tables stay hidden from its contractor.
    for (const table of ['products', 'tasks', 'punch_events', 'memberships', 'audit_log']) {
      const n = await count(
        `SELECT count(*) AS n FROM "${table}" WHERE organization_id = '${a.bakeryId}'`,
        ctx,
      );
      expect({ table, n }).toEqual({ table, n: 0 });
    }
  });

  it('without a tenant context no tenant rows are visible', async () => {
    for (const { table } of tenantTables) {
      const n = await count(`SELECT count(*) AS n FROM "${table}"`, {
        organizationId: null,
        userId: null,
      });
      expect({ table, n }).toEqual({ table, n: 0 });
    }
  });

  it('a user sees only their own memberships outside an organization context', async () => {
    const n = await count(`SELECT count(*) AS n FROM memberships`, {
      organizationId: null,
      userId: b.employeeId,
    });
    expect(n).toBe(1);
  });

  it('notifications are visible to their recipient only', async () => {
    const asEmployee = await count(`SELECT count(*) AS n FROM notifications`, {
      organizationId: a.bakeryId,
      userId: a.employeeId,
    });
    const asRecipient = await count(`SELECT count(*) AS n FROM notifications`, {
      organizationId: a.bakeryId,
      userId: a.adminId,
    });
    expect([asEmployee, asRecipient]).toEqual([0, 1]);
  });
});

describe('writes are confined to the current organization', () => {
  const ctxA = () => ({ organizationId: a.bakeryId, userId: a.adminId });

  it('rejects inserting a row for another organization', async () => {
    await expect(
      asApp(ctxA(), (tx) =>
        tx.product.create({
          data: { organizationId: b.bakeryId, name: 'Leak', imageUrl: 'x', minutesPer10: 5 },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot update or delete another organization’s rows', async () => {
    const result = await asApp(ctxA(), async (tx) => ({
      updated: await tx.product.updateMany({
        where: { id: b.productId },
        data: { name: 'Hacked' },
      }),
      deleted: await tx.task.deleteMany({ where: { id: b.taskId } }),
    }));
    expect(result).toEqual({ updated: { count: 0 }, deleted: { count: 0 } });
    const product = await asApp({ organizationId: b.bakeryId, userId: b.adminId }, (tx) =>
      tx.product.findUniqueOrThrow({ where: { id: b.productId } }),
    );
    expect(product.name).toBe('Bread');
  });

  it('cannot move a row into another organization', async () => {
    await expect(
      asApp(ctxA(), (tx) =>
        tx.product.update({ where: { id: a.productId }, data: { organizationId: b.bakeryId } }),
      ),
    ).rejects.toThrow();
  });

  it('cannot link a child row to another organization’s parent', async () => {
    await expect(
      asApp(ctxA(), (tx) =>
        tx.employeeProduct.create({
          data: { organizationId: a.bakeryId, employeeId: a.employeeId, productId: b.productId },
        }),
      ),
    ).rejects.toThrow();
  });

  it('cannot change or delete organizations other than its own', async () => {
    const result = await asApp(ctxA(), (tx) =>
      tx.organization.updateMany({ where: { id: b.bakeryId }, data: { name: 'Hacked' } }),
    );
    expect(result.count).toBe(0);
    await expect(
      asApp(ctxA(), (tx) => tx.organization.deleteMany({ where: { id: a.bakeryId } })),
    ).rejects.toThrow(/permission denied/i);
  });

  it('keeps ingredient price history append-only, so a price edit cannot rewrite the past', async () => {
    await expect(
      asApp(ctxA(), (tx) => tx.ingredientPrice.updateMany({ data: { packPrice: 1 } })),
    ).rejects.toThrow(/permission denied/i);
    await expect(asApp(ctxA(), (tx) => tx.ingredientPrice.deleteMany({}))).rejects.toThrow(
      /permission denied/i,
    );
    const added = await asApp(ctxA(), (tx) =>
      tx.ingredientPrice.create({
        data: {
          organizationId: a.bakeryId,
          ingredientId: a.ingredientId,
          packPrice: 32_000,
          createdById: a.adminId,
        },
      }),
    );
    expect(added.packPrice).toBe(32_000);
  });

  it('keeps the audit log append-only', async () => {
    await expect(
      asApp(ctxA(), (tx) => tx.auditLog.updateMany({ data: { action: 'tampered' } })),
    ).rejects.toThrow(/permission denied/i);
    await expect(asApp(ctxA(), (tx) => tx.auditLog.deleteMany({}))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('lets a user apply to another organization only as a pending employee', async () => {
    const outsider = await ownerDb().user.create({
      data: { name: 'Outsider', email: 'outsider@test.local', passwordHash: 'x' },
    });
    const ctx = { organizationId: null, userId: outsider.id };
    await expect(
      asApp(ctx, (tx) =>
        tx.membership.create({
          data: {
            organizationId: b.bakeryId,
            userId: outsider.id,
            role: 'admin',
            status: 'active',
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
    const pending = await asApp(ctx, (tx) =>
      tx.membership.create({
        data: {
          organizationId: b.bakeryId,
          userId: outsider.id,
          role: 'employee',
          status: 'pending',
        },
      }),
    );
    expect(pending.status).toBe('pending');
  });
});
