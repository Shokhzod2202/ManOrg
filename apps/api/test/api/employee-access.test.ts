import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

type Area = { key: string; enabled: boolean; defaultEnabled: boolean; label: string };
const enabled = (areas: Area[]) => Object.fromEntries(areas.map((a) => [a.key, a.enabled]));

describe('GET /organization/employee-access', () => {
  it('starts with shifts and orders due next open, everything else closed', async () => {
    const res = await api.as(w.a.admin, w.a.id).get('/organization/employee-access').expect(200);
    expect(res.body.version).toEqual(expect.any(Number));
    expect(enabled(res.body.areas)).toEqual({
      allShifts: true,
      ordersDueNext: true,
      ordersHistory: false,
      deliveries: false,
      outputAll: false,
      ingredientPrices: false,
      finance: false,
    });
    expect(res.body.areas[0]).toEqual({
      key: 'allShifts',
      label: expect.any(String),
      enabled: true,
      defaultEnabled: true,
    });
  });

  it('is for the organization admin only', async () => {
    await api.as(w.a.employee, w.a.id).get('/organization/employee-access').expect(403);
    await api
      .as(w.contractor.admin, w.contractor.id)
      .get('/organization/employee-access')
      .expect(403);
  });

  it('answers 404 for another organization', async () => {
    await api.as(w.a.admin, w.b.id).get('/organization/employee-access').expect(404);
  });
});

describe('PUT /organization/employee-access', () => {
  it('opens and closes areas, bumps the version and audits old and new values', async () => {
    const before = await api.as(w.a.admin, w.a.id).get('/organization/employee-access').expect(200);
    const res = await api
      .as(w.a.admin, w.a.id)
      .put('/organization/employee-access')
      .set('If-Match', String(before.body.version))
      .send({ ordersHistory: true, allShifts: false })
      .expect(200);
    expect(res.body.version).toBe(before.body.version + 1);
    expect(enabled(res.body.areas)).toMatchObject({
      ordersHistory: true,
      allShifts: false,
      ordersDueNext: true,
      finance: false,
    });

    const audit = await auditFor(w.a.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    const entry = audit.find((a) => a.action === 'organization.employee_access_update');
    expect(entry).toMatchObject({
      actorId: w.a.admin.userId,
      before: expect.objectContaining({ ordersHistory: false, allShifts: true }),
      after: expect.objectContaining({ ordersHistory: true, allShifts: false }),
    });
  });

  it('leaves other organizations untouched', async () => {
    const res = await api.as(w.b.admin, w.b.id).get('/organization/employee-access').expect(200);
    expect(enabled(res.body.areas)).toMatchObject({ ordersHistory: false, allShifts: true });
  });

  it('needs If-Match and rejects a stale version', async () => {
    await api
      .as(w.b.admin, w.b.id)
      .put('/organization/employee-access')
      .send({ finance: true })
      .expect(428);
    const res = await api
      .as(w.b.admin, w.b.id)
      .put('/organization/employee-access')
      .set('If-Match', '999')
      .send({ finance: true })
      .expect(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('rejects unknown areas and non-boolean values', async () => {
    const current = await api
      .as(w.b.admin, w.b.id)
      .get('/organization/employee-access')
      .expect(200);
    const res = await api
      .as(w.b.admin, w.b.id)
      .put('/organization/employee-access')
      .set('If-Match', String(current.body.version))
      .send({ editOrders: true, finance: 'yes' })
      .expect(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['editOrders', 'finance']);
  });

  it('is forbidden to employees and contractor admins, and 404 across organizations', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .put('/organization/employee-access')
      .set('If-Match', '1')
      .send({ finance: true })
      .expect(403);
    await api
      .as(w.contractor.admin, w.contractor.id)
      .put('/organization/employee-access')
      .set('If-Match', '1')
      .send({ finance: true })
      .expect(403);
    await api
      .as(w.a.admin, w.b.id)
      .put('/organization/employee-access')
      .set('If-Match', '1')
      .send({ finance: true })
      .expect(404);
  });
});
