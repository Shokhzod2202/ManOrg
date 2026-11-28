import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, createTestApp, type Session } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/**
 * Decided 2026-11-29: contractor organizations run their own staff. People apply to work at a
 * contractor and its admin approves; the worker punches, does tasks and logs output; the admin
 * manages shifts, products and ingredients and changes roles. The worker never sees the
 * contractor's orders, deliveries or money.
 */
let app: INestApplication;
let api: Api;
let w: World;
let barista: Session & { membershipId: string };
const today = new Date().toISOString().slice(0, 10);
const range = `from=${today}&to=${new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)}`;
const cafe = () => api.as(w.contractor.admin, w.contractor.id);
const worker = () => api.as(barista, w.contractor.id);

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  barista = await api.hireEmployee(w.contractor.id, w.contractor.admin, 'Cafe Barista');
  // Orders for the cafe exist, so a leak would show.
  await cafe()
    .post('/orders')
    .send({
      providerId: w.a.id,
      deliveryDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      lines: [{ productId: w.a.productId, quantity: 5 }],
    })
    .expect(201);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('contractor staff', () => {
  it('approved workers punch in and out at server time and see their hours', async () => {
    const start = await worker().post('/punch').send({ action: 'start' }).expect(200);
    expect(start.body.status).toBe('working');
    const shifts = await cafe().get('/dashboard/today').expect(200);
    expect(shifts.body.onShift.map((r: { employee: { id: string } }) => r.employee.id)).toEqual([
      barista.userId,
    ]);
    await worker().post('/punch').send({ action: 'end' }).expect(200);
    const home = await worker().get('/dashboard/home').expect(200);
    expect(home.body.myOrders).toBeNull();
    await worker().get('/work-hours').expect(200);
  });

  it('get tasks from the cafe admin and complete them', async () => {
    const task = await cafe()
      .post('/tasks')
      .send({ title: 'Clean the espresso machine', assigneeId: barista.userId, dueDate: today })
      .expect(201);
    const mine = await worker().get('/tasks').expect(200);
    expect(mine.body.items.map((t: { id: string }) => t.id)).toContain(task.body.id);
  });

  it('never see the cafe’s orders, deliveries or money, even when switched on', async () => {
    const access = await cafe().get('/organization/employee-access').expect(200);
    await cafe()
      .put('/organization/employee-access')
      .set('If-Match', String(access.body.version))
      .send({ ordersHistory: true, deliveries: true, finance: true })
      .expect(200);
    await worker().get(`/orders?${range}`).expect(403);
    await worker().get(`/deliveries?${range}`).expect(403);
    await worker().get('/finance/summary').expect(403);
  });

  it('can be made an admin by the cafe owner, and back', async () => {
    const members = await cafe().get('/members').expect(200);
    const m = members.body.items.find(
      (x: { user: { id: string } }) => x.user.id === barista.userId,
    );
    const up = await cafe()
      .patch(`/members/${m.id}`)
      .set('If-Match', String(m.version))
      .send({ role: 'admin' })
      .expect(200);
    // As an admin they now see the cafe's orders.
    await worker().get(`/orders?${range}`).expect(200);
    await cafe()
      .patch(`/members/${m.id}`)
      .set('If-Match', String(up.body.version))
      .send({ role: 'employee' })
      .expect(200);
    await worker().get(`/orders?${range}`).expect(403);
  });

  it('stay inside their own organization', async () => {
    await worker().get('/products').expect(403);
    await api.as(barista, w.a.id).get('/tasks').expect(404);
    const bakeryShifts = await api.as(w.a.admin, w.a.id).get('/members').expect(200);
    expect(bakeryShifts.body.items.map((x: { user: { id: string } }) => x.user.id)).not.toContain(
      barista.userId,
    );
  });
});
