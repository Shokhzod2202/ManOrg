import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, zonedToUtc } from '../../src/common/time';
import { Api, auditFor, createTestApp, type Session } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/**
 * Decided 2026-11-26: hourly cost (owners only), each employee's latest output, and what an
 * employee's month of output brought in: price - ingredient cost - their labor.
 */
let app: INestApplication;
let api: Api;
let w: World;
let manager: Session;
const TZ = 'Asia/Seoul';
const lastMonth = () => addDays(`${localDate(TZ).slice(0, 7)}-01`, -1).slice(0, 7);
const d = (n: number) => `${lastMonth()}-${String(n).padStart(2, '0')}`;
const owner = () => api.as(w.a.admin, w.a.id);
const ctx = () => ({ organizationId: w.a.id, userId: w.a.admin.userId });

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  // A second admin who is not an owner.
  manager = await api.hireEmployee(w.a.id, w.a.admin, 'Manager');
  const m = (await owner().get('/members').expect(200)).body.items.find(
    (x: { user: { id: string } }) => x.user.id === manager.userId,
  );
  await owner()
    .patch(`/members/${m.id}`)
    .set('If-Match', String(m.version))
    .send({ role: 'admin' })
    .expect(200);
  // Alpha Bread sells for 1,000 won. One batch (2 kg of a 20 kg, 30,000 won sack) makes 10:
  // 3,000 won a batch, 300 a piece.
  const p = (await owner().get(`/products/${w.a.productId}`).expect(200)).body;
  await owner()
    .patch(`/products/${w.a.productId}`)
    .set('If-Match', String(p.version))
    .send({
      batchYield: 10,
      ingredients: [{ ingredientId: w.a.ingredientId, quantity: 2, unit: 'kg' }],
    })
    .expect(200);
  await asOwner(ctx(), async (tx) => {
    // 8 hours with 200 breads on day 5; 2 hours and nothing logged on day 6.
    await tx.punchEvent.createMany({
      data: [
        [d(5), '09:00', 'start'],
        [d(5), '17:00', 'end'],
        [d(6), '09:00', 'start'],
        [d(6), '11:00', 'end'],
      ].map(([date, time, eventType]) => ({
        organizationId: w.a.id,
        employeeId: w.a.employee.userId,
        eventType: eventType as 'start' | 'end',
        occurredAt: zonedToUtc(date!, time!, TZ),
        source: 'admin' as const,
      })),
    });
    await tx.outputEntry.create({
      data: {
        organizationId: w.a.id,
        employeeId: w.a.employee.userId,
        workDate: new Date(`${d(5)}T00:00:00Z`),
        productId: w.a.productId,
        quantity: 200,
      },
    });
  });
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('hourly cost (owners only)', () => {
  it('is set and seen by owners, audited', async () => {
    const res = await owner()
      .put(`/employees/${w.a.employee.userId}/hourly-rate`)
      .send({ hourlyRate: 12_000 })
      .expect(200);
    expect(res.body).toMatchObject({ employeeId: w.a.employee.userId, hourlyRate: 12_000 });
    const list = await owner().get('/hourly-rates').expect(200);
    expect(list.body.items).toEqual([expect.objectContaining({ hourlyRate: 12_000 })]);
    const m = (await owner().get('/members').expect(200)).body.items.find(
      (x: { user: { id: string } }) => x.user.id === w.a.employee.userId,
    );
    const audit = await auditFor(m.id, ctx());
    expect(audit.at(-1)).toMatchObject({ action: 'hourly_rate.set' });
  });

  it('is hidden from other admins, employees and other organizations', async () => {
    await api.as(manager, w.a.id).get('/hourly-rates').expect(403);
    await api
      .as(manager, w.a.id)
      .put(`/employees/${w.a.employee.userId}/hourly-rate`)
      .send({ hourlyRate: 1 })
      .expect(403);
    await api.as(w.a.employee, w.a.id).get('/hourly-rates').expect(403);
    await api
      .as(w.b.admin, w.b.id)
      .put(`/employees/${w.a.employee.userId}/hourly-rate`)
      .send({ hourlyRate: 1 })
      .expect(404);
    const hours = await api.as(manager, w.a.id).get(`/work-hours?month=${lastMonth()}`).expect(200);
    for (const p of hours.body.people) {
      expect(p.hourlyRate).toBeNull();
      expect(p.laborCost).toBeNull();
    }
    const mine = await owner().get(`/work-hours?month=${lastMonth()}`).expect(200);
    const row = mine.body.people.find(
      (p: { employee: { id: string } }) => p.employee.id === w.a.employee.userId,
    );
    // 10 hours at 12,000 won.
    expect(row).toMatchObject({ hourlyRate: 12_000, laborCost: 120_000, minutes: 600 });
  });
});

describe('efficiency', () => {
  it('shows the owner price - ingredient cost - labor, per product, per day and per hour', async () => {
    const res = await owner()
      .get(`/output/efficiency?employee_id=${w.a.employee.userId}&month=${lastMonth()}`)
      .expect(200);
    expect(res.body).toMatchObject({ labor: true, hourlyRate: 12_000, minutes: 600 });
    expect(res.body.missing).toEqual({
      prices: 0,
      costs: 0,
      hourlyRate: false,
      daysWithoutHours: 0,
    });
    expect(res.body.products).toEqual([
      expect.objectContaining({
        name: 'Alpha Bread',
        quantity: 200,
        unitPrice: 1000,
        costPerPiece: 300,
        revenue: 200_000,
        ingredientCost: 60_000,
        laborCost: 96_000,
        contribution: 44_000,
      }),
    ]);
    expect(res.body.days).toEqual([
      expect.objectContaining({
        date: d(5),
        minutes: 480,
        contribution: 44_000,
        perHour: 5_500,
        // Decided 2026-11-28: each day's products.
        products: [
          {
            productId: w.a.productId,
            name: 'Alpha Bread',
            quantity: 200,
            revenue: 200_000,
            ingredientCost: 60_000,
            laborCost: 96_000,
            contribution: 44_000,
          },
        ],
      }),
      expect.objectContaining({
        date: d(6),
        minutes: 120,
        laborCost: 24_000,
        contribution: -24_000,
      }),
    ]);
    // 200,000 - 60,000 - 120,000 = 20,000 over 10 hours.
    expect(res.body.totals).toMatchObject({
      revenue: 200_000,
      ingredientCost: 60_000,
      laborCost: 120_000,
      unassignedLabor: 24_000,
      contribution: 20_000,
      perHour: 2_000,
    });
  });

  it('is before labor for admins who are not owners, and not for employees', async () => {
    const res = await api
      .as(manager, w.a.id)
      .get(`/output/efficiency?employee_id=${w.a.employee.userId}&month=${lastMonth()}`)
      .expect(200);
    expect(res.body).toMatchObject({ labor: false, hourlyRate: null });
    expect(res.body.products[0]).toMatchObject({ laborCost: null, contribution: 140_000 });
    expect(res.body.totals).toMatchObject({ laborCost: null, contribution: 140_000 });
    await api
      .as(w.a.employee, w.a.id)
      .get(`/output/efficiency?employee_id=${w.a.employee.userId}`)
      .expect(403);
    await api
      .as(w.b.admin, w.b.id)
      .get(`/output/efficiency?employee_id=${w.a.employee.userId}`)
      .expect(404);
  });
});

describe('latest output', () => {
  it('opens on each employee’s last day with output and its hours', async () => {
    const res = await owner().get('/dashboard/output-latest').expect(200);
    const row = res.body.employees.find(
      (e: { employee: { id: string } }) => e.employee.id === w.a.employee.userId,
    );
    expect(row).toMatchObject({ date: d(5), workedMinutes: 480 });
    expect(row.output).toMatchObject({ creditedQuantity: 200 });
  });
});
