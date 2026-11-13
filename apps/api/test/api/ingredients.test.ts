import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekdayIn } from '../../src/common/time';
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

const sugar = {
  name: 'Sugar',
  source: 'Wholesale market',
  orderSchedule: { weekday: 2, time: '18:00' },
  packQuantity: 15,
  packUnit: 'kg',
  packPrice: 22_500,
};

describe('POST /ingredients (ING-1)', () => {
  it('adds an ingredient with source, schedule, pack and price, audited', async () => {
    const res = await api.as(w.a.admin, w.a.id).post('/ingredients').send(sugar).expect(201);
    expect(res.body).toMatchObject({
      name: 'Sugar',
      source: 'Wholesale market',
      orderSchedule: { weekday: 2, time: '18:00' },
      packQuantity: 15,
      packUnit: 'kg',
      packPrice: 22_500,
      unitPrice: 1500,
      responsibleEmployees: [],
      version: 1,
    });
    const audit = await auditFor(res.body.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual(['ingredient.create', 'ingredient.price_set']);
  });

  it('requires source and a valid unit, and whole won', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .post('/ingredients')
      .send({ name: 'Salt', packQuantity: 1, packUnit: 'lb', packPrice: 99.5 })
      .expect(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['packPrice', 'packUnit', 'source']);
  });

  it('is forbidden to employees and contractor admins', async () => {
    await api.as(w.a.employee, w.a.id).post('/ingredients').send(sugar).expect(403);
    await api.as(w.contractor.admin, w.contractor.id).post('/ingredients').send(sugar).expect(403);
  });
});

describe('PATCH /ingredients/{id} (ING-2)', () => {
  it('changes what one pack contains, with If-Match, audited', async () => {
    const created = await api
      .as(w.a.admin, w.a.id)
      .post('/ingredients')
      .send({ ...sugar, name: 'Butter', packQuantity: 1, packUnit: 'kg', packPrice: 9000 })
      .expect(201);
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/ingredients/${created.body.id}`)
      .send({ packQuantity: 2 })
      .expect(428);
    const res = await api
      .as(w.a.admin, w.a.id)
      .patch(`/ingredients/${created.body.id}`)
      .set('If-Match', '1')
      .send({ packQuantity: 2.5, packUnit: 'kg', orderSchedule: null })
      .expect(200);
    expect(res.body).toMatchObject({
      packQuantity: 2.5,
      orderSchedule: null,
      version: 2,
      unitPrice: 3600,
    });
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/ingredients/${created.body.id}`)
      .set('If-Match', '1')
      .send({ name: 'Stale' })
      .expect(409);
    const audit = await auditFor(created.body.id, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    const update = audit.find((a) => a.action === 'ingredient.update');
    expect(update?.before).toMatchObject({ packQuantity: '1' });
    expect(update?.after).toMatchObject({ packQuantity: '2.5' });
  });

  it('never edits the price, which has its own history', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .patch(`/ingredients/${w.a.ingredientId}`)
      .set('If-Match', '1')
      .send({ packPrice: 1 })
      .expect(400);
    expect(res.body.error.fields).toHaveProperty('packPrice');
  });

  it('answers 404 for another organization’s ingredient', async () => {
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/ingredients/${w.b.ingredientId}`)
      .set('If-Match', '1')
      .send({ name: 'Hacked' })
      .expect(404);
    await api.as(w.a.admin, w.a.id).get(`/ingredients/${w.b.ingredientId}`).expect(404);
  });
});

describe('ingredient prices (decided 2026-11-12)', () => {
  it('adds a new price for the future and keeps the old one in the history', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .put(`/ingredients/${w.a.ingredientId}/price`)
      .send({ packPrice: 32_000 })
      .expect(200);
    expect(res.body).toMatchObject({ packPrice: 32_000, unitPrice: 1600 });

    const history = await api
      .as(w.a.admin, w.a.id)
      .get(`/ingredients/${w.a.ingredientId}/prices`)
      .expect(200);
    expect(history.body.items.map((p: { packPrice: number }) => p.packPrice)).toEqual([
      32_000, 30_000,
    ]);

    const audit = await auditFor(w.a.ingredientId, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    const change = audit.filter((a) => a.action === 'ingredient.price_set').at(-1);
    expect(change).toMatchObject({
      before: { packPrice: 30_000 },
      after: expect.objectContaining({ packPrice: 32_000 }),
    });
  });

  it('is set by admins only', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .put(`/ingredients/${w.a.ingredientId}/price`)
      .send({ packPrice: 1 })
      .expect(403);
  });
});

describe('GET /ingredients for employees (ING-3, ING-4, open question 17)', () => {
  it('lists every ingredient with the employee’s own responsibilities first, without prices', async () => {
    await api
      .as(w.a.admin, w.a.id)
      .post('/ingredients')
      .send({ ...sugar, name: 'Almonds' })
      .expect(201);
    const res = await api.as(w.a.employee, w.a.id).get('/ingredients').expect(200);
    expect(res.body.items[0]).toMatchObject({
      id: w.a.ingredientId,
      isMyResponsibility: true,
      responsibleEmployees: [{ id: w.a.employee.userId, name: w.a.employee.name }],
    });
    expect(res.body.items.length).toBeGreaterThan(1);
    for (const item of res.body.items) {
      expect(item).not.toHaveProperty('packPrice');
      expect(item).not.toHaveProperty('unitPrice');
    }
    await api.as(w.a.employee, w.a.id).get(`/ingredients/${w.a.ingredientId}/prices`).expect(403);
  });

  it('shows prices once the admin opens Ingredient prices in Employee access', async () => {
    const access = await api.as(w.b.admin, w.b.id).get('/organization/employee-access').expect(200);
    await api
      .as(w.b.admin, w.b.id)
      .put('/organization/employee-access')
      .set('If-Match', String(access.body.version))
      .send({ ingredientPrices: true })
      .expect(200);
    const res = await api.as(w.b.employee, w.b.id).get('/ingredients').expect(200);
    expect(res.body.items[0]).toMatchObject({ packPrice: 30_000 });
    await api.as(w.b.employee, w.b.id).get(`/ingredients/${w.b.ingredientId}/prices`).expect(200);
  });

  it('flags ingredients whose ordering day is today in the organization time zone', async () => {
    const today = weekdayIn('Asia/Seoul');
    const due = await api
      .as(w.a.admin, w.a.id)
      .post('/ingredients')
      .send({ ...sugar, name: 'Yeast', orderSchedule: { weekday: today, time: '09:00' } })
      .expect(201);
    const notDue = await api
      .as(w.a.admin, w.a.id)
      .post('/ingredients')
      .send({ ...sugar, name: 'Cocoa', orderSchedule: { weekday: (today + 1) % 7, time: '09:00' } })
      .expect(201);
    expect([due.body.dueToday, notDue.body.dueToday]).toEqual([true, false]);
  });

  it('is not for contractor admins', async () => {
    await api.as(w.contractor.admin, w.contractor.id).get('/ingredients').expect(403);
  });
});

describe('PUT /ingredients/{id}/assignees (ING-4)', () => {
  it('replaces the responsible employees, audited', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .put(`/ingredients/${w.a.ingredientId}/assignees`)
      .send({ employeeIds: [w.a.employee.userId, w.a.admin.userId] })
      .expect(200);
    expect(res.body.responsibleEmployees.map((e: { id: string }) => e.id).sort()).toEqual(
      [w.a.employee.userId, w.a.admin.userId].sort(),
    );
    const audit = await auditFor(w.a.ingredientId, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    expect(audit.filter((a) => a.action === 'ingredient.assignees_set').at(-1)?.after).toEqual({
      employeeIds: [w.a.employee.userId, w.a.admin.userId].sort(),
    });
  });

  it('refuses people who are not active members of the organization', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .put(`/ingredients/${w.a.ingredientId}/assignees`)
      .send({ employeeIds: [w.b.employee.userId] })
      .expect(400);
    expect(res.body.error.fields).toHaveProperty('employeeIds');
  });

  it('is forbidden to employees', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .put(`/ingredients/${w.a.ingredientId}/assignees`)
      .send({ employeeIds: [] })
      .expect(403);
  });
});
