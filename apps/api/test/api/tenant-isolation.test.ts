/**
 * Tenant isolation through the HTTP API (spec section 13), generated from openapi.yaml.
 * Every GET without path parameters is called as each organization's admin; the suite fails if a
 * response carries any id that belongs to the other organization. New endpoints are covered as
 * soon as they are added to the contract.
 */
import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, createTestApp, type Session } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { loadOpenApi, requiresOrgHeader } from '../helpers/openapi';
import { buildWorld, type World } from '../helpers/world';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const { operations } = loadOpenApi();
const listOps = operations.filter((op) => op.method === 'GET' && !op.path.includes('{'));

/** Fills required query parameters from the contract: dates span the last two weeks. */
function urlFor(op: (typeof operations)[number]): string {
  const query: string[] = [];
  for (const p of op.parameters as {
    in?: string;
    name?: string;
    required?: boolean;
    schema?: { format?: string };
  }[]) {
    if (p.in !== 'query' || !p.required || !p.name) continue;
    if (p.schema?.format === 'date') {
      const d = new Date(Date.now() + (p.name === 'from' ? -14 : 1) * 86_400_000);
      query.push(`${p.name}=${d.toISOString().slice(0, 10)}`);
    }
  }
  return query.length ? `${op.path}?${query.join('&')}` : op.path;
}

let app: INestApplication;
let api: Api;
let w: World;
/** Every id owned by an organization: the org, its members' memberships, links, audit rows. */
const owned = new Map<string, Set<string>>();

/**
 * Every id an organization owns: the id column of every row in every tenant table that belongs
 * to it, plus its people. Read from the catalog, so new tables are covered without changes here.
 */
async function idsOwnedBy(orgId: string, userIds: string[], admin: Session): Promise<Set<string>> {
  return asOwner({ organizationId: orgId, userId: admin.userId }, async (tx) => {
    const tables = await tx.$queryRaw<{ table: string }[]>`
      SELECT c.table_name AS table FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
        AND EXISTS (SELECT 1 FROM information_schema.columns i
                    WHERE i.table_schema = 'public' AND i.table_name = c.table_name AND i.column_name = 'id')`;
    const ids = new Set<string>([orgId, ...userIds]);
    for (const { table } of tables) {
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text AS id FROM "${table}" WHERE organization_id = $1::uuid`,
        orgId,
      );
      for (const r of rows) ids.add(r.id);
    }
    return ids;
  });
}

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  owned.set(
    w.a.id,
    await idsOwnedBy(
      w.a.id,
      [w.a.admin.userId, w.a.employee.userId, w.a.applicant.userId],
      w.a.admin,
    ),
  );
  owned.set(
    w.b.id,
    await idsOwnedBy(
      w.b.id,
      [w.b.admin.userId, w.b.employee.userId, w.b.applicant.userId],
      w.b.admin,
    ),
  );
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('contract coverage', () => {
  it('every GET in the contract declares whether it is tenant-scoped', () => {
    const undeclared = operations
      .filter((op) => op.method === 'GET' && op.tenantScoped === undefined)
      .map((op) => op.operationId);
    expect(undeclared).toEqual([]);
  });

  it('has tenant-scoped list endpoints to check', () => {
    expect(listOps.filter((op) => op.tenantScoped).length).toBeGreaterThan(0);
  });
});

describe.each(listOps.map((op) => [op.operationId, op] as const))('GET %s', (_id, op) => {
  const pairs = () =>
    [
      { me: w.a, other: w.b },
      { me: w.b, other: w.a },
    ] as const;

  it('returns none of the other organization’s ids', async () => {
    for (const { me, other } of pairs()) {
      // Called as the admin; operations only employees use (the punch card) fall back to the employee.
      let res = await api.as(me.admin, requiresOrgHeader(op) ? me.id : undefined).get(urlFor(op));
      if (res.status === 403) res = await api.as(me.employee, me.id).get(urlFor(op));
      expect({ op: op.operationId, status: res.status }).toEqual({
        op: op.operationId,
        status: 200,
      });
      const seen = new Set(JSON.stringify(res.body).match(UUID) ?? []);
      const foreign = [...(owned.get(other.id) ?? [])].filter((id) => seen.has(id));
      if (op.path === '/organizations') {
        // The account pool is public by design (ACC-3): it may name other organizations, but only
        // their id, name and type.
        expect(foreign.every((id) => id === other.id)).toBe(true);
        continue;
      }
      expect({ op: op.operationId, foreign }).toEqual({ op: op.operationId, foreign: [] });
    }
  });

  it.runIf(op.tenantScoped)('answers 404 when asked for the other organization', async () => {
    for (const { me, other } of pairs()) {
      await api.as(me.admin, other.id).get(urlFor(op)).expect(404);
    }
  });

  it.runIf(op.tenantScoped)('does not leak to a contractor admin', async () => {
    await api.as(w.contractor.admin, w.a.id).get(urlFor(op)).expect(404);
  });
});
