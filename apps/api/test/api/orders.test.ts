import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '../../src/common/time';
import { Api, auditFor, createProduct, createTestApp } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;
let pilaf: string;
let orderId: string;
const today = () => localDate('Asia/Seoul');
const tomorrow = () => addDays(today(), 1);

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  pilaf = await createProduct(api, w.a.admin, w.a.id, w.a.ingredientId, 'Pilaf');
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

const cafe = () => api.as(w.contractor.admin, w.contractor.id);

describe('catalog (ORD-1, ACC-6)', () => {
  it('lists the providers that approved the contractor and their available products', async () => {
    const providers = await cafe().get('/providers').expect(200);
    expect(providers.body.items).toEqual([{ id: w.a.id, name: 'Alpha Bakery', type: 'provider' }]);
    const catalog = await cafe().get(`/catalog?provider_id=${w.a.id}`).expect(200);
    expect(catalog.body.items.map((p: { name: string }) => p.name).sort()).toEqual([
      'Alpha Bread',
      'Pilaf',
    ]);
  });

  it('shows nothing to contractors a provider has not approved', async () => {
    await cafe().get(`/catalog?provider_id=${w.b.id}`).expect(404);
    await api
      .as(w.pendingContractor.admin, w.pendingContractor.id)
      .get(`/catalog?provider_id=${w.b.id}`)
      .expect(404);
    await api
      .as(w.pendingContractor.admin, w.pendingContractor.id)
      .post('/orders')
      .send({
        providerId: w.b.id,
        deliveryDate: tomorrow(),
        lines: [{ productId: w.b.productId, quantity: 1 }],
      })
      .expect(404);
  });

  it('suggests a delivery date by the 10:00 rule', async () => {
    const res = await cafe().get(`/orders/default-date?provider_id=${w.a.id}`).expect(200);
    expect([today(), tomorrow()]).toContain(res.body.date);
    expect(res.body.askIfToday).toBe(res.body.date === today());
  });
});

describe('placing orders (ORD-2, decided 2026-11-13)', () => {
  it('places an order for a chosen date and tells everyone at the provider', async () => {
    const res = await cafe()
      .post('/orders')
      .send({
        providerId: w.a.id,
        deliveryDate: tomorrow(),
        lines: [{ productId: w.a.productId, quantity: 30 }],
      })
      .expect(201);
    orderId = res.body.id;
    expect(res.body).toMatchObject({
      provider: { id: w.a.id },
      contractor: { id: w.contractor.id },
      deliveryDate: tomorrow(),
      status: 'placed',
      lines: [{ productId: w.a.productId, productName: 'Alpha Bread', quantity: 30 }],
    });
    const inbox = await api.as(w.a.employee).get('/notifications?unread=true').expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain('order.placed');
    const audit = await auditFor(orderId, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual(['order.place']);
  });

  it('allows one order per day; changes go through a change request', async () => {
    const res = await cafe()
      .post('/orders')
      .send({
        providerId: w.a.id,
        deliveryDate: tomorrow(),
        lines: [{ productId: pilaf, quantity: 1 }],
      })
      .expect(409);
    expect(res.body.error.code).toBe('ORDER_EXISTS');
  });

  it('refuses past dates and unavailable products', async () => {
    await cafe()
      .post('/orders')
      .send({
        providerId: w.a.id,
        deliveryDate: addDays(today(), -1),
        lines: [{ productId: pilaf, quantity: 1 }],
      })
      .expect(400);
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/products/${pilaf}`)
      .set('If-Match', '1')
      .send({ available: false })
      .expect(200);
    await cafe()
      .post('/orders')
      .send({
        providerId: w.a.id,
        deliveryDate: addDays(today(), 5),
        lines: [{ productId: pilaf, quantity: 1 }],
      })
      .expect(400);
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/products/${pilaf}`)
      .set('If-Match', '2')
      .send({ available: true })
      .expect(200);
  });

  it('allows ordering for today until today’s delivery is completed', async () => {
    await asOwner({ organizationId: w.a.id, userId: w.a.admin.userId }, (tx) =>
      tx.delivery.create({
        data: {
          organizationId: w.a.id,
          contractorOrgId: w.contractor.id,
          deliveryDate: new Date(`${today()}T00:00:00Z`),
          status: 'completed',
        },
      }),
    );
    const res = await cafe()
      .post('/orders')
      .send({
        providerId: w.a.id,
        deliveryDate: today(),
        lines: [{ productId: pilaf, quantity: 1 }],
      })
      .expect(409);
    expect(res.body.error.code).toBe('DELIVERY_DONE');
  });

  it('is for contractors only', async () => {
    await api
      .as(w.a.admin, w.a.id)
      .post('/orders')
      .send({
        providerId: w.a.id,
        deliveryDate: tomorrow(),
        lines: [{ productId: pilaf, quantity: 1 }],
      })
      .expect(403);
    await api
      .as(w.a.employee, w.a.id)
      .post('/orders')
      .send({
        providerId: w.a.id,
        deliveryDate: tomorrow(),
        lines: [{ productId: pilaf, quantity: 1 }],
      })
      .expect(403);
  });
});

describe('reading orders (ORD-4)', () => {
  it('shows the provider every contractor’s orders, with totals per product', async () => {
    const list = await api
      .as(w.a.admin, w.a.id)
      .get(`/orders?from=${today()}&to=${addDays(today(), 7)}`)
      .expect(200);
    expect(list.body.items.map((o: { id: string }) => o.id)).toContain(orderId);
    const totals = await api
      .as(w.a.admin, w.a.id)
      .get(`/orders/totals?delivery_date=${tomorrow()}`)
      .expect(200);
    expect(totals.body.items).toEqual([
      { productId: w.a.productId, name: 'Alpha Bread', quantity: 30 },
    ]);
  });

  it('shows a contractor only its own orders', async () => {
    const list = await cafe()
      .get(`/orders?from=${today()}&to=${addDays(today(), 7)}`)
      .expect(200);
    expect(
      list.body.items.every(
        (o: { contractor: { id: string } }) => o.contractor.id === w.contractor.id,
      ),
    ).toBe(true);
    await api.as(w.b.admin, w.b.id).get(`/orders/${orderId}`).expect(404);
  });

  it('opens the monthly list to employees only when the admin switches it on', async () => {
    await api.as(w.a.employee, w.a.id).get(`/orders?from=${today()}&to=${tomorrow()}`).expect(403);
    const access = await api.as(w.a.admin, w.a.id).get('/organization/employee-access').expect(200);
    await api
      .as(w.a.admin, w.a.id)
      .put('/organization/employee-access')
      .set('If-Match', String(access.body.version))
      .send({ ordersHistory: true })
      .expect(200);
    await api.as(w.a.employee, w.a.id).get(`/orders?from=${today()}&to=${tomorrow()}`).expect(200);
  });
});

describe('order change requests (ORD-3, decided 2026-11-13)', () => {
  let requestId: string;
  let items: { id: string; productId: string; kind: string; needsAdmin: boolean }[];

  it('turns a contractor edit into per-product items without changing the order', async () => {
    const res = await cafe()
      .post(`/orders/${orderId}/change-requests`)
      .send({
        lines: [
          { productId: w.a.productId, quantity: 20 },
          { productId: pilaf, quantity: 5 },
        ],
        note: 'Fewer bread, add pilaf',
      })
      .expect(201);
    requestId = res.body.id;
    items = res.body.items;
    expect(items.map((i) => [i.kind, i.needsAdmin]).sort()).toEqual([
      ['add', false],
      ['decrease', true],
    ]);
    const order = await cafe().get(`/orders/${orderId}`).expect(200);
    expect(order.body.lines).toEqual([
      { productId: w.a.productId, productName: 'Alpha Bread', quantity: 30 },
    ]);
    expect(order.body.openChangeRequestIds).toEqual([requestId]);
  });

  it('shows the request to everyone at the provider', async () => {
    const list = await api.as(w.a.employee, w.a.id).get('/order-change-requests').expect(200);
    expect(list.body.items.map((r: { id: string }) => r.id)).toContain(requestId);
  });

  it('lets an employee accept the added product, which changes the order', async () => {
    const add = items.find((i) => i.kind === 'add')!;
    await cafe().post(`/order-change-items/${add.id}/accept`).expect(403);
    const res = await api
      .as(w.a.employee, w.a.id)
      .post(`/order-change-items/${add.id}/accept`)
      .expect(200);
    expect(res.body.items.find((i: { id: string }) => i.id === add.id).status).toBe('accepted');
    const order = await cafe().get(`/orders/${orderId}`).expect(200);
    expect(
      order.body.lines
        .map((l: { productId: string; quantity: number }) => [l.productId, l.quantity])
        .sort(),
    ).toEqual(
      [
        [w.a.productId, 30],
        [pilaf, 5],
      ].sort(),
    );
  });

  it('lets only the admin accept a smaller quantity', async () => {
    const decrease = items.find((i) => i.kind === 'decrease')!;
    const res = await api
      .as(w.a.employee, w.a.id)
      .post(`/order-change-items/${decrease.id}/accept`)
      .expect(403);
    expect(res.body.error.message).toMatch(/admin/);
    const done = await api
      .as(w.a.admin, w.a.id)
      .post(`/order-change-items/${decrease.id}/accept`)
      .expect(200);
    expect(done.body.status).toBe('closed');
    await api.as(w.a.admin, w.a.id).post(`/order-change-items/${decrease.id}/reject`).expect(409);
    const order = await cafe().get(`/orders/${orderId}`).expect(200);
    expect(
      order.body.lines.find((l: { productId: string }) => l.productId === w.a.productId).quantity,
    ).toBe(20);
    const audit = await auditFor(orderId, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual([
      'order.place',
      'order.change_request',
      'order.change_accept',
      'order.change_accept',
    ]);
    const inbox = await api.as(w.contractor.admin).get('/notifications?unread=true').expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain(
      'order.change_accepted',
    );
  });

  it('cancels the order only when the admin accepts removing everything', async () => {
    const res = await cafe()
      .post(`/orders/${orderId}/change-requests`)
      .send({ lines: [] })
      .expect(201);
    for (const item of res.body.items) {
      expect(item.needsAdmin).toBe(true);
      await api.as(w.a.employee, w.a.id).post(`/order-change-items/${item.id}/accept`).expect(403);
      await api.as(w.a.admin, w.a.id).post(`/order-change-items/${item.id}/accept`).expect(200);
    }
    const order = await cafe().get(`/orders/${orderId}`).expect(200);
    expect(order.body).toMatchObject({ status: 'cancelled', lines: [] });
  });
});

describe('admin corrections', () => {
  it('let the provider admin set lines with If-Match; contractors must ask instead', async () => {
    const placed = await cafe()
      .post('/orders')
      .send({
        providerId: w.a.id,
        deliveryDate: addDays(today(), 3),
        lines: [{ productId: w.a.productId, quantity: 10 }],
      })
      .expect(201);
    await cafe()
      .put(`/orders/${placed.body.id}/lines`)
      .set('If-Match', '1')
      .send({ lines: [] })
      .expect(403);
    const res = await api
      .as(w.a.admin, w.a.id)
      .put(`/orders/${placed.body.id}/lines`)
      .set('If-Match', '1')
      .send({ lines: [{ productId: w.a.productId, quantity: 12 }] })
      .expect(200);
    expect(res.body).toMatchObject({ version: 2, lines: [{ quantity: 12 }] });
    await api
      .as(w.a.admin, w.a.id)
      .put(`/orders/${placed.body.id}/lines`)
      .set('If-Match', '1')
      .send({ lines: [] })
      .expect(409);
  });
});
