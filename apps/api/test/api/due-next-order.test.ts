import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '../../src/common/time';
import { Api, createTestApp, type Session } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;
let deli: { id: string; admin: Session };
const tomorrow = () => addDays(localDate('Asia/Seoul'), 1);
const admin = () => api.as(w.a.admin, w.a.id);

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  // A second approved contractor, so order and filters mean something.
  const deliAdmin = await api.register('Deli Admin');
  const deliId = await api.createOrganization(deliAdmin, 'Green Deli', 'contractor');
  const link = await api
    .as(deliAdmin, deliId)
    .post(`/organizations/${w.a.id}/applications`)
    .expect(201);
  await admin().post(`/applications/${link.body.id}/approve`).expect(200);
  deli = { id: deliId, admin: deliAdmin };
  for (const [who, org, qty] of [
    [w.contractor.admin, w.contractor.id, 30],
    [deliAdmin, deliId, 12],
  ] as const) {
    await api
      .as(who, org)
      .post('/orders')
      .send({
        providerId: w.a.id,
        deliveryDate: tomorrow(),
        lines: [{ productId: w.a.productId, quantity: qty }],
      })
      .expect(201);
  }
  await admin()
    .put(`/contractors/${w.contractor.id}/approx-time`)
    .send({ start: '14:00', end: '15:00' })
    .expect(200);
  await admin()
    .put(`/contractors/${deli.id}/approx-time`)
    .send({ start: '09:00', end: '10:00' })
    .expect(200);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

const names = (body: { orders: { contractor: { name: string } }[] }) =>
  body.orders.map((o) => o.contractor.name);

describe('orders due next, several contractors in one day', () => {
  it('sorts by approximate delivery time, earliest first, and re-sorts when it changes (DTM-5, TOD-2)', async () => {
    const first = await admin().get('/orders/due-next').expect(200);
    expect(names(first.body)).toEqual(['Green Deli', 'Corner Cafe']);
    await admin()
      .put(`/contractors/${deli.id}/approx-time`)
      .send({ start: '16:00', end: '17:00' })
      .expect(200);
    const again = await admin().get('/orders/due-next').expect(200);
    expect(names(again.body)).toEqual(['Corner Cafe', 'Green Deli']);
    await admin()
      .put(`/contractors/${deli.id}/approx-time`)
      .send({ start: '09:00', end: '10:00' })
      .expect(200);
  });

  it('totals match the sum of the orders due next (TOD-4)', async () => {
    const res = await admin().get('/orders/due-next').expect(200);
    expect(res.body.totals).toEqual([
      expect.objectContaining({ productId: w.a.productId, quantity: 42 }),
    ]);
  });

  it('filters by contractor; the default shows all (TOD-3)', async () => {
    const one = await admin().get(`/orders/due-next?contractor_id=${deli.id}`).expect(200);
    expect(names(one.body)).toEqual(['Green Deli']);
    expect(one.body.totals[0]).toMatchObject({ quantity: 12 });
    const all = await api.as(w.a.employee, w.a.id).get('/orders/due-next').expect(200);
    expect(names(all.body)).toHaveLength(2);
  });

  it('shows the time to employees, and to each contractor on its own delivery (DTM-4)', async () => {
    const res = await api.as(w.a.employee, w.a.id).get('/orders/due-next').expect(200);
    expect(res.body.orders[0].approxTime).toEqual({ start: '09:00', end: '10:00' });
    const own = await api
      .as(deli.admin, deli.id)
      .get(`/orders?from=${tomorrow()}&to=${tomorrow()}`)
      .expect(200);
    expect(own.body.items[0].approxTime).toEqual({ start: '09:00', end: '10:00' });
  });

  it('keeps the standing time every day until the admin changes it (DTM-3)', async () => {
    for (const days of [1, 2, 5]) {
      const date = addDays(localDate('Asia/Seoul'), days);
      const d = await admin().get(`/deliveries/${w.contractor.id}/${date}`).expect(200);
      expect(d.body.window).toMatchObject({ startTime: '14:00', endTime: '15:00' });
    }
  });
});
