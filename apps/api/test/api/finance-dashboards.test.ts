import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '../../src/common/time';
import { Api, createTestApp, PNG, type Session } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/** F-001 sections 2.2 and 2.3: what the contractor and the bakery admin see about money. */
let app: INestApplication;
let api: Api;
let w: World;
let deli: { id: string; admin: Session };
const today = () => localDate('Asia/Seoul');
const ago = (n: number) => addDays(today(), -n);
const admin = () => api.as(w.a.admin, w.a.id);
const cafe = () => api.as(w.contractor.admin, w.contractor.id);

async function deliver(contractorId: string, date: string, ordered: number, delivered: number) {
  await asOwner({ organizationId: w.a.id, userId: w.a.admin.userId }, (tx) =>
    tx.order.create({
      data: {
        organizationId: w.a.id,
        contractorOrgId: contractorId,
        deliveryDate: new Date(`${date}T00:00:00Z`),
        placedById: w.contractor.admin.userId,
        lines: {
          create: [{ productId: w.a.productId, productName: 'Alpha Bread', quantity: ordered }],
        },
      },
    }),
  );
  const saved = await admin()
    .put(`/deliveries/${contractorId}/${date}`)
    .send({ lines: [{ productId: w.a.productId, deliveredQuantity: delivered }] })
    .expect(200);
  return (await admin().post(`/deliveries/${saved.body.id}/complete`).expect(200)).body;
}
async function pay(by: ReturnType<typeof cafe>, amount: number) {
  return (
    await by
      .post('/payments')
      .field('providerId', w.a.id)
      .field('amount', String(amount))
      .attach('proof', PNG, 'receipt.png')
      .expect(201)
  ).body as { id: string };
}

let approvedId = '';
let pendingId = '';

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  const deliAdmin = await api.register('Deli Admin');
  const deliId = await api.createOrganization(deliAdmin, 'Green Deli', 'contractor');
  const link = await api
    .as(deliAdmin, deliId)
    .post(`/organizations/${w.a.id}/applications`)
    .expect(201);
  await admin().post(`/applications/${link.body.id}/approve`).expect(200);
  deli = { id: deliId, admin: deliAdmin };
  // Corner Cafe: 20 + 10 delivered at 1,000 won; pays 15,000 (approved) and 5,000 (pending).
  await deliver(w.contractor.id, ago(20), 30, 20);
  await deliver(w.contractor.id, ago(5), 10, 10);
  approvedId = (await pay(cafe(), 15_000)).id;
  const owing = (
    await admin()
      .get(`/finance/deliveries?contractor_id=${w.contractor.id}&from=${ago(30)}&to=${today()}`)
      .expect(200)
  ).body.items.sort((a: { deliveryDate: string }, b: { deliveryDate: string }) =>
    a.deliveryDate.localeCompare(b.deliveryDate),
  );
  await admin()
    .post(`/payments/${approvedId}/approve`)
    .send({
      approvedAmount: 15_000,
      paymentDate: ago(1),
      allocations: [{ deliveryId: owing[0].id, amount: 15_000 }],
    })
    .expect(200);
  pendingId = (await pay(cafe(), 5_000)).id;
  // Green Deli: 7 delivered.
  await deliver(deli.id, ago(3), 7, 7);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('contractor finance dashboard (CFD-1 to CFD-7)', () => {
  it('CFD-1, CFD-2: delivered products with quantities, unit prices and each delivery value', async () => {
    const res = await cafe()
      .get(`/finance/deliveries?provider_id=${w.a.id}&from=${ago(30)}&to=${today()}`)
      .expect(200);
    const old = res.body.items.find((d: { deliveryDate: string }) => d.deliveryDate === ago(20));
    expect(old).toMatchObject({ totalValue: 20_000, paidValue: 15_000, remainingValue: 5_000 });
    expect(old.lines).toEqual([
      { productName: 'Alpha Bread', deliveredQuantity: 20, unitPrice: 1000, lineValue: 20_000 },
    ]);
  });

  it('CFD-3, CFD-4, CFD-5: period value, submitted and approved payments, outstanding', async () => {
    const all = await cafe().get(`/finance/summary?provider_id=${w.a.id}`).expect(200);
    expect(all.body.contractors).toEqual([
      expect.objectContaining({
        deliveredValue: 30_000,
        approvedPayments: 15_000,
        pendingPayments: 5_000,
        outstanding: 15_000,
      }),
    ]);
    const recent = await cafe()
      .get(`/finance/summary?provider_id=${w.a.id}&from=${ago(10)}&to=${today()}`)
      .expect(200);
    expect(recent.body.contractors[0].deliveredValue).toBe(10_000);
    const payments = await cafe().get(`/payments?provider_id=${w.a.id}`).expect(200);
    expect(
      payments.body.items.map((p: { id: string; status: string }) => [p.id, p.status]).sort(),
    ).toEqual(
      [
        [approvedId, 'approved'],
        [pendingId, 'pending'],
      ].sort(),
    );
  });

  it('CFD-6: payment and delivery history, newest first, own organization only', async () => {
    const res = await cafe()
      .get(`/finance/history?provider_id=${w.a.id}&from=${ago(30)}&to=${today()}`)
      .expect(200);
    expect(res.body.items.map((e: { kind: string }) => e.kind)).toEqual(
      expect.arrayContaining(['delivery', 'payment']),
    );
    const dates = res.body.items.map((e: { date: string }) => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(JSON.stringify(res.body)).not.toContain(deli.id);
  });

  it('CFD-7: the contractor reads its own settlement schedule but cannot change it', async () => {
    await admin()
      .put(`/contractors/${w.contractor.id}/settlement-schedule`)
      .send({
        periods: [
          { startDate: ago(30), endDate: ago(16), kind: 'mid_month' },
          { startDate: ago(15), endDate: addDays(today(), 10), kind: 'month_end' },
        ],
      })
      .expect(200);
    const mine = await cafe().get(`/settlement-schedules?provider_id=${w.a.id}`).expect(200);
    expect(mine.body.items).toHaveLength(2);
    await cafe()
      .put(`/contractors/${w.contractor.id}/settlement-schedule`)
      .send({ periods: [] })
      .expect(403);
  });
});

describe('bakery admin finance dashboard (AFD-1 to AFD-8)', () => {
  it('AFD-1, AFD-2, AFD-3, AFD-4: every contractor with delivered value, approved payments and receivables', async () => {
    const res = await admin().get('/finance/summary').expect(200);
    const by = Object.fromEntries(
      res.body.contractors.map((c: { contractor: { id: string } }) => [c.contractor.id, c]),
    );
    expect(by[w.contractor.id]).toMatchObject({
      deliveredValue: 30_000,
      approvedPayments: 15_000,
      outstanding: 15_000,
    });
    expect(by[deli.id]).toMatchObject({
      deliveredValue: 7_000,
      approvedPayments: 0,
      outstanding: 7_000,
    });
    expect(res.body.totals.outstanding).toBe(22_000);
  });

  it('AFD-5, AFD-6: history and lists filter by contractor and by date', async () => {
    const both = await admin()
      .get(`/finance/history?from=${ago(30)}&to=${today()}`)
      .expect(200);
    const ids = new Set(
      both.body.items.map((e: { contractor?: { id: string } }) => e.contractor?.id),
    );
    expect(ids).toEqual(new Set([w.contractor.id, deli.id]));
    const one = await admin()
      .get(`/finance/history?contractor_id=${deli.id}&from=${ago(30)}&to=${today()}`)
      .expect(200);
    expect(
      one.body.items.every((e: { contractor?: { id: string } }) => e.contractor?.id === deli.id),
    ).toBe(true);
    const range = await admin()
      .get(`/finance/deliveries?contractor_id=${w.contractor.id}&from=${ago(10)}&to=${today()}`)
      .expect(200);
    expect(range.body.items.map((d: { deliveryDate: string }) => d.deliveryDate)).toEqual([ago(5)]);
  });

  it('AFD-7: each contractor has its own schedule, which the admin can view and edit', async () => {
    await admin()
      .put(`/contractors/${deli.id}/settlement-schedule`)
      .send({ periods: [{ startDate: ago(10), endDate: addDays(today(), 20), kind: 'custom' }] })
      .expect(200);
    const d = await admin().get(`/settlement-schedules?contractor_id=${deli.id}`).expect(200);
    const c = await admin()
      .get(`/settlement-schedules?contractor_id=${w.contractor.id}`)
      .expect(200);
    expect(d.body.items).toHaveLength(1);
    expect(c.body.items).toHaveLength(2);
  });

  it('AFD-8: a review queue of payment confirmations, approved from it', async () => {
    const queue = await admin().get('/payments?status=pending').expect(200);
    expect(queue.body.items.map((p: { id: string }) => p.id)).toEqual([pendingId]);
    expect(queue.body.items[0].proofUrl).toBeTruthy();
    const owing = (
      await admin()
        .get(`/finance/deliveries?contractor_id=${w.contractor.id}&from=${ago(30)}&to=${today()}`)
        .expect(200)
    ).body.items.filter((d: { remainingValue: number }) => d.remainingValue > 0);
    await admin()
      .post(`/payments/${pendingId}/approve`)
      .send({
        approvedAmount: 5_000,
        paymentDate: today(),
        allocations: [{ deliveryId: owing[0].id, amount: 5_000 }],
      })
      .expect(200);
    expect((await admin().get('/payments?status=pending').expect(200)).body.items).toEqual([]);
  });
});
