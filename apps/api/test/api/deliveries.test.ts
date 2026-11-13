import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '../../src/common/time';
import { Api, auditFor, createProduct, createTestApp, type Session } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;
let pilaf: string;
let joon: Session;
let yesterdayOrder: string;
let tomorrowOrder: string;
const today = () => localDate('Asia/Seoul');
const yesterday = () => addDays(today(), -1);
const tomorrow = () => addDays(today(), 1);
const cafe = () => api.as(w.contractor.admin, w.contractor.id);
const admin = () => api.as(w.a.admin, w.a.id);

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  pilaf = await createProduct(api, w.a.admin, w.a.id, w.a.ingredientId, 'Pilaf');
  joon = await api.hireEmployee(w.a.id, w.a.admin, 'Joon');
  await admin()
    .put(`/employees/${joon.userId}/products`)
    .send({ productIds: [pilaf] })
    .expect(200);
  const placed = await cafe()
    .post('/orders')
    .send({
      providerId: w.a.id,
      deliveryDate: tomorrow(),
      lines: [
        { productId: w.a.productId, quantity: 30 },
        { productId: pilaf, quantity: 10 },
      ],
    })
    .expect(201);
  tomorrowOrder = placed.body.id;
  // An order for yesterday that has not been delivered yet (placed directly; the API refuses past dates).
  yesterdayOrder = await asOwner(
    { organizationId: w.a.id, userId: w.a.admin.userId },
    async (tx) => {
      const o = await tx.order.create({
        data: {
          organizationId: w.a.id,
          contractorOrgId: w.contractor.id,
          deliveryDate: new Date(`${yesterday()}T00:00:00Z`),
          placedById: w.contractor.admin.userId,
          lines: {
            create: [{ productId: w.a.productId, productName: 'Alpha Bread', quantity: 30 }],
          },
        },
      });
      return o.id;
    },
  );
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('approximate delivery time (DTM-1 to DTM-6)', () => {
  it('lists approved contractors and sets a standing time, audited and announced', async () => {
    const before = await admin().get('/contractors').expect(200);
    expect(before.body.items).toEqual([
      { contractor: { id: w.contractor.id, name: 'Corner Cafe' }, approxTime: null },
    ]);
    const res = await admin()
      .put(`/contractors/${w.contractor.id}/approx-time`)
      .send({ start: '14:00', end: '15:00' })
      .expect(200);
    expect(res.body.approxTime).toEqual({ start: '14:00', end: '15:00' });
    const audit = await auditFor(w.contractor.linkId, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    expect(audit.at(-1)).toMatchObject({
      action: 'contractor_link.approx_time_set',
      before: { approxTime: null },
    });
    for (const person of [w.a.employee, w.contractor.admin]) {
      const inbox = await api.as(person).get('/notifications?unread=true').expect(200);
      expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain(
        'delivery.approx_time_changed',
      );
    }
  });

  it('requires an end after the start and is set by provider admins only', async () => {
    await admin()
      .put(`/contractors/${w.contractor.id}/approx-time`)
      .send({ start: '15:00', end: '14:00' })
      .expect(400);
    await api
      .as(w.a.employee, w.a.id)
      .put(`/contractors/${w.contractor.id}/approx-time`)
      .send({ start: '10:00', end: '11:00' })
      .expect(403);
    await api
      .as(w.b.admin, w.b.id)
      .put(`/contractors/${w.contractor.id}/approx-time`)
      .send({ start: '10:00', end: '11:00' })
      .expect(404);
  });
});

describe("Today's Orders and My Orders (TOD-1 to TOD-7)", () => {
  it('shows the order due next, not the order dated tomorrow, so it holds past midnight', async () => {
    const res = await api.as(w.a.employee, w.a.id).get('/orders/due-next').expect(200);
    expect(res.body.orders).toEqual([
      expect.objectContaining({
        orderId: yesterdayOrder,
        contractor: { id: w.contractor.id, name: 'Corner Cafe' },
        deliveryDate: yesterday(),
        approxTime: { start: '14:00', end: '15:00' },
        deliveryStatus: 'not_started',
      }),
    ]);
    expect(res.body.totals).toEqual([
      { productId: w.a.productId, productName: 'Alpha Bread', quantity: 30 },
    ]);
  });

  it('gives each employee only their assigned products, at the full quantity', async () => {
    await admin()
      .put(`/orders/${yesterdayOrder}/lines`)
      .set('If-Match', '1')
      .send({
        lines: [
          { productId: w.a.productId, quantity: 30 },
          { productId: pilaf, quantity: 12 },
        ],
      })
      .expect(200);
    const mine = await api
      .as(joon, w.a.id)
      .get(`/employees/${joon.userId}/orders/due-next`)
      .expect(200);
    expect(mine.body.orders[0].lines).toEqual([
      { productId: pilaf, productName: 'Pilaf', quantity: 12 },
    ]);
    await api.as(joon, w.a.id).get(`/employees/${w.a.employee.userId}/orders/due-next`).expect(403);
    const adminView = await admin().get(`/employees/${joon.userId}/orders/due-next`).expect(200);
    expect(adminView.body.totals).toEqual([
      { productId: pilaf, productName: 'Pilaf', quantity: 12 },
    ]);
  });

  it('can be closed to employees in Employee access, and is never for contractors', async () => {
    const access = await api.as(w.b.admin, w.b.id).get('/organization/employee-access').expect(200);
    await api
      .as(w.b.admin, w.b.id)
      .put('/organization/employee-access')
      .set('If-Match', String(access.body.version))
      .send({ ordersDueNext: false })
      .expect(200);
    await api.as(w.b.employee, w.b.id).get('/orders/due-next').expect(403);
    await cafe().get('/orders/due-next').expect(403);
  });
});

describe('delivery management (DEL-1 to DEL-5)', () => {
  let deliveryId: string;

  it("starts from that day's order", async () => {
    const res = await admin().get(`/deliveries/${w.contractor.id}/${yesterday()}`).expect(200);
    expect(res.body).toMatchObject({
      id: null,
      status: 'not_started',
      window: { startTime: '14:00', endTime: '15:00' },
    });
    expect(
      res.body.lines.map(
        (l: { productName: string; orderedQuantity: number; deliveredQuantity: number }) => [
          l.productName,
          l.orderedQuantity,
          l.deliveredQuantity,
        ],
      ),
    ).toEqual([
      ['Alpha Bread', 30, 30],
      ['Pilaf', 12, 12],
    ]);
  });

  it('keeps ordered and delivered numbers apart and marks unordered products', async () => {
    const other = await createProduct(api, w.a.admin, w.a.id, w.a.ingredientId, 'Somsa');
    const res = await admin()
      .put(`/deliveries/${w.contractor.id}/${yesterday()}`)
      .send({
        lines: [
          { productId: w.a.productId, deliveredQuantity: 20 },
          { productId: pilaf, deliveredQuantity: 0 },
          { productId: other, deliveredQuantity: 5 },
        ],
      })
      .expect(200);
    deliveryId = res.body.id;
    expect(res.body.status).toBe('draft');
    expect(
      res.body.lines.map(
        (l: {
          productName: string;
          orderedQuantity: number;
          deliveredQuantity: number;
          difference: number;
          isUnordered: boolean;
        }) => [l.productName, l.orderedQuantity, l.deliveredQuantity, l.difference, l.isUnordered],
      ),
    ).toEqual([
      ['Alpha Bread', 30, 20, -10, false],
      ['Pilaf', 12, 0, -12, false],
      ['Somsa', 0, 5, 5, true],
    ]);
    const audit = await auditFor(deliveryId, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual(['delivery.save']);
  });

  it('takes the order off Today’s Orders once completed; the next due order takes its place', async () => {
    await admin().post(`/deliveries/${deliveryId}/complete`).expect(200);
    const res = await api.as(w.a.employee, w.a.id).get('/orders/due-next').expect(200);
    expect(res.body.orders.map((o: { orderId: string }) => o.orderId)).toEqual([tomorrowOrder]);
    await admin()
      .put(`/deliveries/${w.contractor.id}/${yesterday()}`)
      .send({ lines: [] })
      .expect(409);
    const inbox = await api.as(w.contractor.admin).get('/notifications?unread=true').expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain('delivery.completed');
  });

  it('lets the contractor confirm a completed delivery (DEL-5)', async () => {
    await api.as(w.a.admin, w.a.id).post(`/deliveries/${deliveryId}/confirm`).expect(403);
    const res = await cafe().post(`/deliveries/${deliveryId}/confirm`).expect(200);
    expect(res.body.status).toBe('confirmed');
    await cafe().post(`/deliveries/${deliveryId}/confirm`).expect(409);
  });

  it('shows the contractor its own deliveries only', async () => {
    const list = await cafe()
      .get(`/deliveries?from=${addDays(today(), -3)}&to=${tomorrow()}`)
      .expect(200);
    expect(list.body.items.map((d: { id: string }) => d.id)).toEqual([deliveryId]);
    await api.as(w.b.admin, w.b.id).get(`/deliveries/${deliveryId}`).expect(404);
  });

  it('opens deliveries to employees only when the admin switches them on', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .get(`/deliveries?from=${yesterday()}&to=${today()}`)
      .expect(403);
  });
});

describe('delivery change after confirming (DEL-6)', () => {
  it('keeps the delivery unchanged until the provider admin approves', async () => {
    const list = await cafe().get(`/deliveries?from=${yesterday()}&to=${yesterday()}`).expect(200);
    const id = list.body.items[0].id;
    const asked = await cafe()
      .post(`/deliveries/${id}/change-requests`)
      .send({
        lines: [{ productId: w.a.productId, deliveredQuantity: 18 }],
        reason: 'Two loaves were missing.',
      })
      .expect(201);
    expect(asked.body).toMatchObject({
      status: 'change_requested',
      pendingChange: { reason: 'Two loaves were missing.' },
    });
    expect(
      asked.body.lines.find((l: { productId: string }) => l.productId === w.a.productId)
        .deliveredQuantity,
    ).toBe(20);
    await api
      .as(w.a.employee, w.a.id)
      .post(`/deliveries/${id}/change-requests/${asked.body.pendingChange.id}/decision`)
      .send({ decision: 'approve' })
      .expect(403);
    const decided = await admin()
      .post(`/deliveries/${id}/change-requests/${asked.body.pendingChange.id}/decision`)
      .send({ decision: 'approve' })
      .expect(200);
    expect(decided.body).toMatchObject({ status: 'confirmed', pendingChange: null });
    expect(
      decided.body.lines.find((l: { productId: string }) => l.productId === w.a.productId),
    ).toMatchObject({ orderedQuantity: 30, deliveredQuantity: 18, difference: -12 });
    await admin()
      .post(`/deliveries/${id}/change-requests/${asked.body.pendingChange.id}/decision`)
      .send({ decision: 'reject' })
      .expect(409);
    const audit = await auditFor(id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual([
      'delivery.save',
      'delivery.complete',
      'delivery.confirm',
      'delivery.change_request',
      'delivery.change_approve',
    ]);
  });
});

describe('a new standing time applies to today’s open delivery (DTM-2)', () => {
  it('moves the window of a draft delivery and leaves completed ones alone', async () => {
    await admin()
      .put(`/deliveries/${w.contractor.id}/${tomorrow()}`)
      .send({ lines: [] })
      .expect(200);
    await admin()
      .put(`/contractors/${w.contractor.id}/approx-time`)
      .send({ start: '11:00', end: '12:00' })
      .expect(200);
    const draft = await admin().get(`/deliveries/${w.contractor.id}/${tomorrow()}`).expect(200);
    expect(draft.body.window).toMatchObject({ startTime: '11:00', endTime: '12:00' });
    const done = await admin().get(`/deliveries/${w.contractor.id}/${yesterday()}`).expect(200);
    expect(done.body.window).toMatchObject({ startTime: '14:00', endTime: '15:00' });
  });
});
