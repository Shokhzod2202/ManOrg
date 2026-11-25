import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '../../src/common/time';
import { Api, createTestApp, type Session } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/**
 * Decided 2026-11-30: admins see what orders are worth. An estimate (ordered quantity at today's
 * price) until the delivery is completed, then the real amount the delivery recorded.
 */
let app: INestApplication;
let api: Api;
let w: World;
let pilaf: string;
let joon: Session;
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
  // A product with no price yet (decided 2026-11-24: name and minutes are enough).
  pilaf = (await admin().post('/products').send({ name: 'Pilaf', minutesPer10: 5 }).expect(201))
    .body.id;
  joon = await api.hireEmployee(w.a.id, w.a.admin, 'Joon');
  await admin()
    .put(`/employees/${joon.userId}/products`)
    .send({ productIds: [pilaf, w.a.productId] })
    .expect(200);
  // Yesterday's order, not delivered yet (placed directly; the API refuses past dates).
  await asOwner({ organizationId: w.a.id, userId: w.a.admin.userId }, (tx) =>
    tx.order.create({
      data: {
        organizationId: w.a.id,
        contractorOrgId: w.contractor.id,
        deliveryDate: new Date(`${yesterday()}T00:00:00Z`),
        placedById: w.contractor.admin.userId,
        lines: {
          create: [
            { productId: w.a.productId, productName: 'Alpha Bread', quantity: 30 },
            { productId: pilaf, productName: 'Pilaf', quantity: 4 },
          ],
        },
      },
    }),
  );
  await cafe()
    .post('/orders')
    .send({
      providerId: w.a.id,
      deliveryDate: tomorrow(),
      lines: [{ productId: w.a.productId, quantity: 10 }],
    })
    .expect(201);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('order value before delivery (estimate)', () => {
  it('prices each line, each order and all orders due next, and each employee', async () => {
    const res = await admin().get('/orders/due-next').expect(200);
    const order = res.body.orders[0];
    expect(order.deliveryDate).toBe(yesterday());
    expect(order.amount).toBe(30_000);
    expect(order.lines).toEqual([
      expect.objectContaining({ productName: 'Alpha Bread', unitPrice: 1000, amount: 30_000 }),
      expect.objectContaining({ productName: 'Pilaf', unitPrice: null, amount: null }),
    ]);
    expect(res.body.amount).toBe(30_000);
    expect(res.body.unpriced).toBe(1);
    expect(res.body.totals).toEqual([
      expect.objectContaining({ productName: 'Alpha Bread', unitPrice: 1000, amount: 30_000 }),
      expect.objectContaining({ productName: 'Pilaf', unitPrice: null, amount: null }),
    ]);
    expect(res.body.byEmployee).toEqual(
      expect.arrayContaining([
        { employee: expect.objectContaining({ name: 'Joon' }), amount: 30_000 },
      ]),
    );
    const mine = await admin().get(`/employees/${joon.userId}/orders/due-next`).expect(200);
    expect(mine.body.amount).toBe(30_000);
  });

  it('follows today’s price until delivered', async () => {
    await admin().put(`/products/${pilaf}/price`).send({ unitPrice: 2500 }).expect(200);
    const res = await admin().get('/orders/due-next').expect(200);
    expect(res.body.amount).toBe(40_000);
    expect(res.body.unpriced).toBe(0);
    const day = await admin().get(`/orders?from=${yesterday()}&to=${yesterday()}`).expect(200);
    expect(day.body.items[0].value).toMatchObject({
      kind: 'estimate',
      amount: 40_000,
      unpriced: 0,
    });
  });

  it('is finance data: employees without finance access and contractors get no amounts', async () => {
    const mine = await api.as(joon, w.a.id).get(`/employees/${joon.userId}/orders/due-next`);
    expect(mine.status).toBe(200);
    expect(mine.body.amount).toBeNull();
    expect(mine.body.orders[0].lines[0]).toMatchObject({ unitPrice: null, amount: null });
    const home = await api.as(joon, w.a.id).get('/dashboard/home').expect(200);
    expect(home.body.myOrders.amount).toBeNull();
    const theirs = await cafe().get(`/orders?from=${yesterday()}&to=${tomorrow()}`).expect(200);
    expect(theirs.body.items.every((o: object) => !('value' in o))).toBe(true);
  });
});

describe('order value after delivery (actual)', () => {
  it('uses the delivered quantities and the prices copied when completed', async () => {
    const saved = await admin()
      .put(`/deliveries/${w.contractor.id}/${yesterday()}`)
      .send({
        lines: [
          { productId: w.a.productId, deliveredQuantity: 28 },
          { productId: pilaf, deliveredQuantity: 4 },
        ],
      })
      .expect(200);
    await admin().post(`/deliveries/${saved.body.id}/complete`).expect(200);
    const day = await admin().get(`/orders?from=${yesterday()}&to=${yesterday()}`).expect(200);
    expect(day.body.items[0].value).toEqual({
      kind: 'actual',
      amount: 38_000,
      unpriced: 0,
      lines: [
        expect.objectContaining({
          productName: 'Alpha Bread',
          quantity: 28,
          unitPrice: 1000,
          amount: 28_000,
        }),
        expect.objectContaining({
          productName: 'Pilaf',
          quantity: 4,
          unitPrice: 2500,
          amount: 10_000,
        }),
      ],
    });
    // A later price change never changes the recorded amount (F-001 FIN-5).
    await admin().put(`/products/${pilaf}/price`).send({ unitPrice: 3000 }).expect(200);
    const again = await admin().get(`/orders?from=${yesterday()}&to=${yesterday()}`).expect(200);
    expect(again.body.items[0].value.amount).toBe(38_000);
    // The delivered order leaves the board; tomorrow's is next, at today's price.
    const due = await admin().get('/orders/due-next').expect(200);
    expect(due.body.orders.map((o: { deliveryDate: string }) => o.deliveryDate)).toEqual([
      tomorrow(),
    ]);
    expect(due.body.amount).toBe(10_000);
  });
});
