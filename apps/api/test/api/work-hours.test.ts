import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, zonedToUtc } from '../../src/common/time';
import { Api, auditFor, createTestApp, type Session } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/**
 * Decided 2026-11-30: worked hours from punch cards only (never the shift plan), per day and per
 * month, and advances on salary ("avans") logged by admins.
 */
let app: INestApplication;
let api: Api;
let w: World;
let joon: Session;
let idle: Session;
const TZ = 'Asia/Seoul';
// A whole month in the past, so nothing depends on the time of day the test runs.
const lastMonth = () => addDays(`${localDate(TZ).slice(0, 7)}-01`, -1).slice(0, 7);
const d = (n: number) => `${lastMonth()}-${String(n).padStart(2, '0')}`;
const admin = () => api.as(w.a.admin, w.a.id);

async function punches(person: Session, list: [string, string, 'start' | 'pause' | 'end'][]) {
  await asOwner({ organizationId: w.a.id, userId: w.a.admin.userId }, (tx) =>
    tx.punchEvent.createMany({
      data: list.map(([date, time, eventType]) => ({
        organizationId: w.a.id,
        employeeId: person.userId,
        eventType,
        occurredAt: zonedToUtc(date, time, TZ),
        source: 'admin' as const,
      })),
    }),
  );
}

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  joon = await api.hireEmployee(w.a.id, w.a.admin, 'Joon');
  idle = await api.hireEmployee(w.a.id, w.a.admin, 'Idle');
  // A day shift with a 30-minute pause: 3h + 4h30 = 450 minutes.
  await punches(joon, [
    [d(3), '09:00', 'start'],
    [d(3), '12:00', 'pause'],
    [d(3), '12:30', 'start'],
    [d(3), '17:00', 'end'],
    // A night shift crossing midnight counts on the day it started: 480 minutes.
    [d(10), '22:00', 'start'],
    [d(11), '06:00', 'end'],
    // Started but never ended: not counted until it is.
    [d(20), '08:00', 'start'],
  ]);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('worked hours (punch cards only)', () => {
  it('sums finished shifts per day and per month, without paused time', async () => {
    const res = await admin().get(`/work-hours?month=${lastMonth()}`).expect(200);
    const row = res.body.people.find(
      (p: { employee: { id: string } }) => p.employee.id === joon.userId,
    );
    expect(row.days).toEqual([
      { date: d(3), minutes: 450, shifts: 1 },
      { date: d(10), minutes: 480, shifts: 1 },
    ]);
    expect(row).toMatchObject({ minutes: 930, daysWorked: 2, unfinished: 1 });
    expect(row.openSince).toEqual([zonedToUtc(d(20), '08:00', TZ).toISOString()]);
    // People who never punched are listed with zero; the shift plan never adds hours.
    const none = res.body.people.find(
      (p: { employee: { id: string } }) => p.employee.id === idle.userId,
    );
    expect(none).toMatchObject({ minutes: 0, daysWorked: 0, days: [] });
  });

  it('shows each person only their own month', async () => {
    const mine = await api.as(joon, w.a.id).get(`/work-hours?month=${lastMonth()}`).expect(200);
    expect(mine.body.people.map((p: { employee: { id: string } }) => p.employee.id)).toEqual([
      joon.userId,
    ]);
    await api
      .as(joon, w.a.id)
      .get(`/work-hours?month=${lastMonth()}&employee_id=${idle.userId}`)
      .expect(403);
    // Decided 2026-11-29: contractors have staff and hours too.
    await api.as(w.contractor.admin, w.contractor.id).get('/work-hours').expect(200);
    await admin().get('/work-hours?month=2026-13').expect(400);
  });
});

describe('a night shift on Output (decided 2026-11-26)', () => {
  it('counts on the day it started and is pointed out on the next day', async () => {
    const rowOf = async (date: string) =>
      (await admin().get(`/dashboard/shift-output?date=${date}`).expect(200)).body.employees.find(
        (e: { employee: { id: string } }) => e.employee.id === joon.userId,
      );
    expect(await rowOf(d(10))).toMatchObject({
      workedMinutes: 480,
      onShift: false,
      carriedOver: null,
    });
    expect(await rowOf(d(11))).toMatchObject({
      workedMinutes: 0,
      carriedOver: { startedOn: d(10), minutes: 480, ongoing: false },
    });
    // A shift never ended shows as still on shift on its day.
    expect(await rowOf(d(20))).toMatchObject({ onShift: true });
  });
});

describe('advances (avans)', () => {
  it('are logged by admins, audited, and shown in the month they were paid', async () => {
    const paid = await admin()
      .post('/salary-advances')
      .send({ employeeId: joon.userId, amount: 300_000, paidOn: d(15), note: 'asked on Friday' })
      .expect(201);
    expect(paid.body).toMatchObject({ amount: 300_000, paidOn: d(15), cancelledAt: null });
    const wrong = await admin()
      .post('/salary-advances')
      .send({ employeeId: joon.userId, amount: 50_000, paidOn: d(16) })
      .expect(201);
    await admin()
      .post(`/salary-advances/${wrong.body.id}/cancel`)
      .send({ reason: 'typo' })
      .expect(200);
    await admin().post(`/salary-advances/${wrong.body.id}/cancel`).send({}).expect(409);
    const res = await api.as(joon, w.a.id).get(`/work-hours?month=${lastMonth()}`).expect(200);
    expect(res.body.people[0].advances.total).toBe(300_000);
    expect(res.body.people[0].advances.items).toHaveLength(2);
    expect(res.body.totals).toEqual({ minutes: 930, advances: 300_000 });
    const audit = await auditFor(wrong.body.id, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    expect(audit.map((a) => a.action)).toEqual(['salary_advance.create', 'salary_advance.cancel']);
    // Another month does not show them.
    const now = await admin().get('/work-hours').expect(200);
    expect(now.body.totals.advances).toBe(0);
  });

  it('only admins log them, never in the future, and only for their own people', async () => {
    await api
      .as(joon, w.a.id)
      .post('/salary-advances')
      .send({ employeeId: joon.userId, amount: 1000 })
      .expect(403);
    await admin()
      .post('/salary-advances')
      .send({ employeeId: joon.userId, amount: 1000, paidOn: addDays(localDate(TZ), 1) })
      .expect(400);
    await admin()
      .post('/salary-advances')
      .send({ employeeId: w.b.admin.userId, amount: 1000 })
      .expect(404);
    await admin().post('/salary-advances').send({ employeeId: joon.userId, amount: 0 }).expect(400);
  });
});

describe('removed people', () => {
  it('are listed only for months they worked or were paid in', async () => {
    const m = (await admin().get('/members').expect(200)).body.items.find(
      (x: { user: { id: string } }) => x.user.id === idle.userId,
    );
    await admin()
      .patch(`/members/${m.id}`)
      .set('If-Match', String(m.version))
      .send({ status: 'removed' })
      .expect(200);
    const res = await admin().get('/work-hours').expect(200);
    expect(res.body.people.map((p: { employee: { id: string } }) => p.employee.id)).not.toContain(
      idle.userId,
    );
  });
});
