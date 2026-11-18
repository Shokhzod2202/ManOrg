import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '../../src/common/time';
import { Api, auditFor, createTestApp, PNG, type Session } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/** F-001 delivery-based financial tracking: the test scenarios of its section 8. */
let app: INestApplication;
let api: Api;
let w: World;
let deli: { id: string; admin: Session };
const today = () => localDate('Asia/Seoul');
const ago = (n: number) => addDays(today(), -n);
const admin = () => api.as(w.a.admin, w.a.id);
const cafe = () => api.as(w.contractor.admin, w.contractor.id);

/** Records a delivery for a past day (orders cannot be placed in the past, so it is inserted). */
async function deliver(contractorId: string, date: string, ordered: number, delivered: number) {
  await asOwner({ organizationId: w.a.id, userId: w.a.admin.userId }, async (tx) => {
    const admin = await tx.membership
      .findFirst({ where: { organizationId: contractorId, role: 'admin' } })
      .catch(() => null);
    await tx.order.create({
      data: {
        organizationId: w.a.id,
        contractorOrgId: contractorId,
        deliveryDate: new Date(`${date}T00:00:00Z`),
        placedById: admin?.userId ?? w.contractor.admin.userId,
        lines: {
          create: [{ productId: w.a.productId, productName: 'Alpha Bread', quantity: ordered }],
        },
      },
    });
  });
  const saved = await admin()
    .put(`/deliveries/${contractorId}/${date}`)
    .send({ lines: [{ productId: w.a.productId, deliveredQuantity: delivered }] })
    .expect(200);
  const done = await admin().post(`/deliveries/${saved.body.id}/complete`).expect(200);
  return done.body as {
    id: string;
    totalValue: number;
    lines: { unitPrice: number; lineValue: number }[];
  };
}

async function pay(amount: number, by = cafe()) {
  const res = await by
    .post('/payments')
    .field('providerId', w.a.id)
    .field('amount', String(amount))
    .attach('proof', PNG, 'receipt.png')
    .expect(201);
  return res.body as { id: string; status: string };
}

const outstanding = async (contractorId = w.contractor.id) =>
  (await admin().get(`/finance/summary?contractor_id=${contractorId}`).expect(200)).body
    .contractors[0].outstanding as number;

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
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('prices and delivery value (FIN-1 to FIN-5)', () => {
  it('ordered 30, delivered 20 at 1,000 won gives 20,000 won', async () => {
    const d = await deliver(w.contractor.id, ago(60), 30, 20);
    expect(d.totalValue).toBe(20_000);
    expect(d.lines[0]).toMatchObject({ unitPrice: 1000, lineValue: 20_000 });
  });

  it('a later price change never changes a past delivery', async () => {
    const before = (
      await admin()
        .get(`/finance/deliveries?contractor_id=${w.contractor.id}&from=${ago(61)}&to=${ago(59)}`)
        .expect(200)
    ).body.items[0];
    await admin().put(`/products/${w.a.productId}/price`).send({ unitPrice: 1200 }).expect(200);
    const after = (
      await admin()
        .get(`/finance/deliveries?contractor_id=${w.contractor.id}&from=${ago(61)}&to=${ago(59)}`)
        .expect(200)
    ).body.items[0];
    expect(after.totalValue).toBe(before.totalValue);
    const history = await admin().get(`/products/${w.a.productId}/prices`).expect(200);
    expect(history.body.items.map((p: { unitPrice: number }) => p.unitPrice)).toEqual([1200, 1000]);
    const audit = await auditFor(w.a.productId, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    expect(
      audit.find(
        (a) =>
          a.action === 'product.price' && (a.after as { unitPrice: number }).unitPrice === 1200,
      ),
    ).toBeTruthy();
    await admin().put(`/products/${w.a.productId}/price`).send({ unitPrice: 1000 }).expect(200);
  });

  it('a product without a price cannot be delivered', async () => {
    const image = await admin().post('/product-images').attach('file', PNG, 'x.png').expect(201);
    const product = await admin()
      .post('/products')
      .send({
        name: 'Unpriced Bun',
        imageKey: image.body.imageKey,
        minutesPer10: 5,
        ingredients: [{ ingredientId: w.a.ingredientId }],
      })
      .expect(201);
    const date = ago(58);
    const saved = await admin()
      .put(`/deliveries/${w.contractor.id}/${date}`)
      .send({ lines: [{ productId: product.body.id, deliveredQuantity: 5 }] })
      .expect(200);
    const res = await admin().post(`/deliveries/${saved.body.id}/complete`).expect(422);
    expect(res.body.error).toMatchObject({ code: 'PRICE_MISSING' });
    expect(res.body.error.message).toContain('Unpriced Bun');
  });

  it('prices are for admins; employees do not see money', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .put(`/products/${w.a.productId}/price`)
      .send({ unitPrice: 1 })
      .expect(403);
    await api.as(w.a.employee, w.a.id).get('/finance/summary').expect(403);
    const catalog = await cafe().get(`/catalog?provider_id=${w.a.id}`).expect(200);
    expect(catalog.body.items.find((i: { id: string }) => i.id === w.a.productId).unitPrice).toBe(
      1000,
    );
  });
});

describe('payments (PAY-1 to PAY-8)', () => {
  let big: string;

  it('400,000 delivered and 250,000 approved leaves 150,000; a pending payment changes nothing', async () => {
    const start = await outstanding();
    big = (await deliver(w.contractor.id, ago(50), 400, 400)).id;
    expect(await outstanding()).toBe(start + 400_000);
    const p = await pay(250_000);
    expect(p.status).toBe('pending');
    expect(await outstanding()).toBe(start + 400_000);
    await admin()
      .post(`/payments/${p.id}/approve`)
      .send({
        approvedAmount: 250_000,
        paymentDate: ago(49),
        allocations: [{ deliveryId: big, amount: 250_000 }],
      })
      .expect(200);
    expect(await outstanding()).toBe(start + 150_000);
    const pending = await pay(150_000);
    const summary = (
      await admin().get(`/finance/summary?contractor_id=${w.contractor.id}`).expect(200)
    ).body.contractors[0];
    expect(summary).toMatchObject({ outstanding: start + 150_000, pendingPayments: 150_000 });
    // F2: the contractor may withdraw it before review.
    await cafe().post(`/payments/${pending.id}/cancel`).expect(200);
  });

  it('a rejection needs a reason and never changes a balance', async () => {
    const before = await outstanding();
    const p = await pay(10_000);
    await admin().post(`/payments/${p.id}/reject`).send({}).expect(400);
    await admin().post(`/payments/${p.id}/reject`).send({ reason: '' }).expect(400);
    const res = await admin()
      .post(`/payments/${p.id}/reject`)
      .send({ reason: 'Receipt is unreadable' })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Receipt is unreadable',
    });
    expect(await outstanding()).toBe(before);
    const mine = await cafe().get('/payments').expect(200);
    expect(mine.body.items.find((x: { id: string }) => x.id === p.id).rejectionReason).toBe(
      'Receipt is unreadable',
    );
  });

  it('one 300,000 payment across three deliveries; too much on one is refused', async () => {
    const ds = [];
    for (const n of [47, 46, 45]) ds.push((await deliver(w.contractor.id, ago(n), 100, 100)).id);
    const p = await pay(300_000);
    const tooMuch = await admin()
      .post(`/payments/${p.id}/approve`)
      .send({
        approvedAmount: 300_000,
        paymentDate: ago(44),
        allocations: [{ deliveryId: ds[0], amount: 300_000 }],
      })
      .expect(400);
    expect(tooMuch.body.error.fields.allocations[0]).toContain('100000 won left');
    await admin()
      .post(`/payments/${p.id}/approve`)
      .send({
        approvedAmount: 300_000,
        paymentDate: ago(44),
        allocations: [
          { deliveryId: ds[0], amount: 100_000 },
          { deliveryId: ds[1], amount: 100_000 },
        ],
      })
      .expect(400);
    await admin()
      .post(`/payments/${p.id}/approve`)
      .send({
        approvedAmount: 250_000,
        paymentDate: ago(44),
        allocations: [
          { deliveryId: ds[0], amount: 100_000 },
          { deliveryId: ds[1], amount: 100_000 },
          { deliveryId: ds[2], amount: 50_000 },
        ],
      })
      .expect(200);
    const list = await admin()
      .get(`/finance/deliveries?contractor_id=${w.contractor.id}&from=${ago(47)}&to=${ago(45)}`)
      .expect(200);
    expect(
      list.body.items.map((d: { paidValue: number; remainingValue: number }) => [
        d.paidValue,
        d.remainingValue,
      ]),
    ).toEqual([
      [50_000, 50_000],
      [100_000, 0],
      [100_000, 0],
    ]);
    const audit = await auditFor(p.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['payment.submit', 'payment.approve']),
    );
  });

  it("a contractor never sees another contractor's payments or proof", async () => {
    const p = await pay(5_000);
    const other = await api
      .as(deli.admin, deli.id)
      .get(`/payments?provider_id=${w.a.id}`)
      .expect(200);
    expect(other.body.items.map((x: { id: string }) => x.id)).not.toContain(p.id);
    await api.as(deli.admin, deli.id).post(`/payments/${p.id}/cancel`).expect(404);
    await api.as(deli.admin, deli.id).get(`/finance/summary?provider_id=${w.b.id}`).expect(404);
    const mine = await cafe().get('/payments').expect(200);
    expect(mine.body.items.find((x: { id: string }) => x.id === p.id).proofUrl).toEqual(
      expect.any(String),
    );
    await cafe().post(`/payments/${p.id}/cancel`).expect(200);
  });

  it('accepts images and PDFs as proof, nothing else', async () => {
    await cafe()
      .post('/payments')
      .field('providerId', w.a.id)
      .field('amount', '1000')
      .attach('proof', Buffer.from('hello, not a receipt'), 'x.txt')
      .expect(400);
    const pdf = await cafe()
      .post('/payments')
      .field('providerId', w.a.id)
      .field('amount', '1000')
      .attach('proof', Buffer.from('%PDF-1.7\n%%EOF'), 'receipt.pdf')
      .expect(201);
    expect(pdf.body.proofType).toBe('application/pdf');
    await cafe().post(`/payments/${pdf.body.id}/cancel`).expect(200);
    await cafe().post('/payments').field('providerId', w.a.id).field('amount', '1000').expect(400);
  });
});

describe('settlement (SET-1 to SET-6)', () => {
  const p1 = () => ({ startDate: ago(40), endDate: ago(29), kind: 'mid_month' });
  const p2 = () => ({ startDate: ago(28), endDate: ago(11), kind: 'month_end' });
  const p3 = () => ({ startDate: ago(10), endDate: addDays(today(), 20), kind: 'mid_month' });

  it('closing a period with 150,000 unpaid carries 150,000 into the next one', async () => {
    const res = await admin()
      .put(`/contractors/${deli.id}/settlement-schedule`)
      .send({ periods: [p1(), p2(), p3()] })
      .expect(200);
    expect(res.body.items).toHaveLength(3);
    await deliver(deli.id, ago(35), 150, 150);
    await admin().post(`/settlement-reports/${res.body.items[2].id}/close`).expect(409);
    await admin().post(`/settlement-reports/${res.body.items[1].id}/close`).expect(409);
    const closed = await admin()
      .post(`/settlement-reports/${res.body.items[0].id}/close`)
      .expect(200);
    expect(closed.body).toMatchObject({
      status: 'closed',
      openingBalance: 0,
      deliveredValue: 150_000,
      approvedPayments: 0,
      closingBalance: 150_000,
    });
    const schedule = await admin()
      .get(`/settlement-schedules?contractor_id=${deli.id}`)
      .expect(200);
    expect(schedule.body.items[1]).toMatchObject({ status: 'open', openingBalance: 150_000 });
  });

  it('a delivery corrected after closing becomes an adjustment; the closed report never changes', async () => {
    const schedule = (
      await admin().get(`/settlement-schedules?contractor_id=${deli.id}`).expect(200)
    ).body.items;
    const before = await admin().get(`/settlement-reports/${schedule[0].id}`).expect(200);
    // The contractor asks for a correction on the closed day; the bakery approves it.
    const d = (
      await admin()
        .get(`/deliveries/${deli.id}/${ago(35)}`)
        .expect(200)
    ).body;
    await api.as(deli.admin, deli.id).post(`/deliveries/${d.id}/confirm`).expect(200);
    const change = await api
      .as(deli.admin, deli.id)
      .post(`/deliveries/${d.id}/change-requests`)
      .send({
        lines: [{ productId: w.a.productId, deliveredQuantity: 140 }],
        reason: 'Ten were missing',
      })
      .expect(201);
    const requestId = change.body.pendingChange.id;
    await admin()
      .post(`/deliveries/${d.id}/change-requests/${requestId}/decision`)
      .send({ decision: 'approve' })
      .expect(200);
    const after = await admin().get(`/settlement-reports/${schedule[0].id}`).expect(200);
    expect(after.body).toEqual(before.body);
    const now = (await admin().get(`/settlement-schedules?contractor_id=${deli.id}`).expect(200))
      .body.items;
    const current = now.find((x: { startDate: string }) => x.startDate === ago(10));
    expect(current.adjustments).toBe(-10_000);
    expect(await outstanding(deli.id)).toBe(140_000);
  });

  it('changing dates applies only to periods not closed, and is audited', async () => {
    const schedule = (
      await admin().get(`/settlement-schedules?contractor_id=${deli.id}`).expect(200)
    ).body.items;
    const closedBefore = await admin().get(`/settlement-reports/${schedule[0].id}`).expect(200);
    const touch = await admin()
      .put(`/contractors/${deli.id}/settlement-schedule`)
      .send({ periods: [{ startDate: ago(35), endDate: ago(11), kind: 'custom' }, p3()] })
      .expect(409);
    expect(touch.body.error.code).toBe('PERIOD_CLOSED');
    const gap = await admin()
      .put(`/contractors/${deli.id}/settlement-schedule`)
      .send({
        periods: [p2(), { startDate: ago(9), endDate: addDays(today(), 20), kind: 'custom' }],
      })
      .expect(400);
    expect(gap.body.error.fields.periods[0]).toContain('follow each other');
    await admin()
      .put(`/contractors/${deli.id}/settlement-schedule`)
      .send({
        periods: [
          p2(),
          { startDate: ago(10), endDate: addDays(today(), 5), kind: 'mid_month' },
          { startDate: addDays(today(), 6), endDate: addDays(today(), 30), kind: 'month_end' },
        ],
      })
      .expect(200);
    const after = await admin().get(`/settlement-reports/${schedule[0].id}`).expect(200);
    expect(after.body).toEqual(closedBefore.body);
    const audit = await auditFor(deli.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.filter((a) => a.action === 'settlement.schedule').length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('each contractor sees only its own schedule; the admin sees both', async () => {
    await admin()
      .put(`/contractors/${w.contractor.id}/settlement-schedule`)
      .send({ periods: [{ startDate: ago(20), endDate: ago(5), kind: 'custom' }] })
      .expect(200);
    const mine = await api
      .as(deli.admin, deli.id)
      .get(`/settlement-schedules?provider_id=${w.a.id}`)
      .expect(200);
    expect(mine.body.items[0].startDate).toBe(ago(40));
    const theirs = await cafe().get(`/settlement-schedules?provider_id=${w.a.id}`).expect(200);
    expect(theirs.body.items[0].startDate).toBe(ago(20));
    await api
      .as(deli.admin, deli.id)
      .get(`/settlement-reports/${theirs.body.items[0].id}`)
      .expect(404);
    await cafe()
      .put(`/contractors/${w.contractor.id}/settlement-schedule`)
      .send({ periods: [] })
      .expect(403);
    const all = await admin().get('/finance/summary').expect(200);
    expect(
      all.body.contractors.map((c: { contractor: { name: string } }) => c.contractor.name),
    ).toEqual(['Corner Cafe', 'Green Deli']);
  });

  it('a payment dated in a closed period is refused; reversing an old payment adjusts the open period', async () => {
    const schedule = (
      await admin().get(`/settlement-schedules?contractor_id=${deli.id}`).expect(200)
    ).body.items;
    const d = (
      await admin()
        .get(`/finance/deliveries?contractor_id=${deli.id}&from=${ago(40)}&to=${today()}`)
        .expect(200)
    ).body.items[0];
    const p = await pay(40_000, api.as(deli.admin, deli.id));
    const late = await admin()
      .post(`/payments/${p.id}/approve`)
      .send({
        approvedAmount: 40_000,
        paymentDate: ago(35),
        allocations: [{ deliveryId: d.id, amount: 40_000 }],
      })
      .expect(409);
    expect(late.body.error.code).toBe('PERIOD_CLOSED');
    await admin()
      .post(`/payments/${p.id}/approve`)
      .send({
        approvedAmount: 40_000,
        paymentDate: ago(20),
        allocations: [{ deliveryId: d.id, amount: 40_000 }],
      })
      .expect(200);
    expect(await outstanding(deli.id)).toBe(100_000);
    await admin().post(`/settlement-reports/${schedule[1].id}/close`).expect(200);
    const reversed = await admin()
      .post(`/payments/${p.id}/reverse`)
      .send({ reason: 'Bounced' })
      .expect(200);
    expect(reversed.body.status).toBe('reversed');
    expect(await outstanding(deli.id)).toBe(140_000);
    const now = (await admin().get(`/settlement-schedules?contractor_id=${deli.id}`).expect(200))
      .body.items;
    // Period 2: opened at 150,000 (period 1's snapshot), 40,000 paid: closed at 110,000.
    expect(now[1]).toMatchObject({
      status: 'closed',
      openingBalance: 150_000,
      approvedPayments: 40_000,
      closingBalance: 110_000,
    });
    // The open period carries 110,000, plus -10,000 (correction) and +40,000 (reversal).
    expect(now[2]).toMatchObject({
      openingBalance: 110_000,
      adjustments: 30_000,
      closingBalance: 140_000,
    });
  });
});
