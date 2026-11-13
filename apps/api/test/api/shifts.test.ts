import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, weekdayOfDate, zonedToUtc } from '../../src/common/time';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;
const TZ = 'Asia/Seoul';
const today = () => localDate(TZ);
/** A date a week ago, so its plan is fully in the past. */
const pastDate = () => addDays(today(), -7);
const seoul = (date: string, time: string) => zonedToUtc(date, time, TZ).toISOString();

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

describe('PUT /shifts (SHF-1)', () => {
  it('sets a weekly plan, with a night shift ending the next day, audited', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .put('/shifts')
      .send({
        employeeId: w.a.employee.userId,
        days: [
          { weekday: 1, startTime: '06:00', endTime: '14:00' },
          { weekday: 5, startTime: '22:00', endTime: '06:00' },
        ],
      })
      .expect(200);
    expect(res.body.days).toEqual([
      { weekday: 1, startTime: '06:00', endTime: '14:00', endsNextDay: false },
      { weekday: 5, startTime: '22:00', endTime: '06:00', endsNextDay: true },
    ]);
    const audit = await auditFor(w.a.employee.userId, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    expect(audit.at(-1)).toMatchObject({
      action: 'shift.plan_set',
      before: { days: [{ weekday: 1, startTime: '06:00', endTime: '14:00', endsNextDay: false }] },
    });
  });

  it('rejects equal start and end, repeated weekdays and non-members', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .put('/shifts')
      .send({
        employeeId: w.a.employee.userId,
        days: [
          { weekday: 1, startTime: '06:00', endTime: '06:00' },
          { weekday: 1, startTime: '07:00', endTime: '08:00' },
        ],
      })
      .expect(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['days', 'days.0.endTime']);
    await api
      .as(w.a.admin, w.a.id)
      .put('/shifts')
      .send({ employeeId: w.b.employee.userId, days: [] })
      .expect(400);
  });

  it('is set by admins only', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .put('/shifts')
      .send({ employeeId: w.a.employee.userId, days: [] })
      .expect(403);
  });
});

describe('GET /shifts (SHF-2)', () => {
  it('shows everyone’s plan to employees while All employees’ shifts is open, else only their own', async () => {
    const open = await api.as(w.b.employee, w.b.id).get('/shifts').expect(200);
    expect(open.body.items.length).toBeGreaterThan(1);
    const access = await api.as(w.b.admin, w.b.id).get('/organization/employee-access').expect(200);
    await api
      .as(w.b.admin, w.b.id)
      .put('/organization/employee-access')
      .set('If-Match', String(access.body.version))
      .send({ allShifts: false })
      .expect(200);
    const own = await api.as(w.b.employee, w.b.id).get('/shifts').expect(200);
    expect(own.body.items.map((i: { employee: { id: string } }) => i.employee.id)).toEqual([
      w.b.employee.userId,
    ]);
    await api.as(w.b.employee, w.b.id).get(`/shifts?employee_id=${w.b.admin.userId}`).expect(403);
  });

  it('is not for contractor admins', async () => {
    await api.as(w.contractor.admin, w.contractor.id).get('/shifts').expect(403);
  });
});

describe('punch card (SHF-3)', () => {
  it('runs start, pause, resume and end in order at server time', async () => {
    const me = api.as(w.a.employee, w.a.id);
    const off = await me.get('/punch/card').expect(200);
    expect(off.body).toMatchObject({ status: 'off', allowedActions: ['start'], current: null });
    const started = await me.post('/punch').send({ action: 'start' }).expect(200);
    expect(started.body).toMatchObject({ status: 'working', allowedActions: ['pause', 'end'] });
    expect(Object.keys(started.body.current.events[0]).sort()).toEqual([
      'eventType',
      'id',
      'occurredAt',
    ]);
    const startedAt = new Date(started.body.current.startedAt).getTime();
    expect(Math.abs(startedAt - Date.now())).toBeLessThan(10_000);
    await me.post('/punch').send({ action: 'start' }).expect(409);
    const paused = await me.post('/punch').send({ action: 'pause' }).expect(200);
    expect(paused.body).toMatchObject({ status: 'paused', allowedActions: ['resume', 'end'] });
    await me.post('/punch').send({ action: 'resume' }).expect(200);
    const ended = await me.post('/punch').send({ action: 'end' }).expect(200);
    expect(ended.body).toMatchObject({ status: 'off', allowedActions: ['start'] });
  });

  it('ignores any client time and refuses unknown fields', async () => {
    const res = await api
      .as(w.a.employee, w.a.id)
      .post('/punch')
      .send({ action: 'start', occurredAt: '2020-01-01T00:00:00Z' })
      .expect(400);
    expect(res.body.error.fields).toHaveProperty('occurredAt');
  });

  it('records one punch for a repeated Idempotency-Key', async () => {
    const me = api.as(w.b.employee, w.b.id);
    await me
      .post('/punch')
      .set('Idempotency-Key', 'tap-123456')
      .send({ action: 'start' })
      .expect(200);
    await me
      .post('/punch')
      .set('Idempotency-Key', 'tap-123456')
      .send({ action: 'start' })
      .expect(200);
    const count = await asOwner({ organizationId: w.b.id, userId: w.b.admin.userId }, (tx) =>
      tx.punchEvent.count({
        where: { employeeId: w.b.employee.userId, idempotencyKey: 'tap-123456' },
      }),
    );
    expect(count).toBe(1);
    await me.post('/punch').send({ action: 'end' }).expect(200);
  });

  it('is for employees; admins and contractors do not punch', async () => {
    await api.as(w.a.admin, w.a.id).post('/punch').send({ action: 'start' }).expect(403);
    await api.as(w.contractor.admin, w.contractor.id).get('/punch/card').expect(403);
  });
});

describe('red flags and history (SHF-6)', () => {
  it('shows a 25-minute late start in red against the plan', async () => {
    const date = pastDate();
    await api
      .as(w.a.admin, w.a.id)
      .put('/shifts')
      .send({
        employeeId: w.a.employee.userId,
        days: [{ weekday: weekdayOfDate(date), startTime: '06:00', endTime: '14:00' }],
      })
      .expect(200);
    for (const [eventType, time] of [
      ['start', '06:25'],
      ['end', '14:00'],
    ] as const) {
      await api
        .as(w.a.admin, w.a.id)
        .post('/punch-events')
        .send({ employeeId: w.a.employee.userId, eventType, occurredAt: seoul(date, time) })
        .expect(201);
    }
    const res = await api
      .as(w.a.employee, w.a.id)
      .get(`/punch?from=${date}&to=${date}`)
      .expect(200);
    expect(res.body.days[0]).toMatchObject({
      date,
      planned: { startDate: date, endDate: date, startTime: '06:00', endTime: '14:00' },
      workedMinutes: 455,
      flags: [{ code: 'LATE_START', minutes: 25, message: 'Started 25 minutes late.' }],
    });
  });

  it('flags a planned day with no punch', async () => {
    const date = addDays(pastDate(), -7);
    const res = await api
      .as(w.a.employee, w.a.id)
      .get(`/punch?from=${date}&to=${date}`)
      .expect(200);
    expect(res.body.days[0].flags.map((f: { code: string }) => f.code)).toEqual(['MISSING_PUNCH']);
  });

  it('answers 403 when an employee asks for another employee’s history', async () => {
    const date = pastDate();
    await api
      .as(w.a.employee, w.a.id)
      .get(`/punch?from=${date}&to=${date}&employee_id=${w.a.admin.userId}`)
      .expect(403);
    await api
      .as(w.a.admin, w.a.id)
      .get(`/punch?from=${date}&to=${date}&employee_id=${w.a.employee.userId}`)
      .expect(200);
    await api
      .as(w.a.admin, w.a.id)
      .get(`/punch?from=${date}&to=${date}&employee_id=${w.b.employee.userId}`)
      .expect(404);
  });

  it('limits ranges to 62 days', async () => {
    await api
      .as(w.a.admin, w.a.id)
      .get(`/dashboard/shifts?from=2026-01-01&to=2026-06-01`)
      .expect(400);
  });
});

describe('admin punch edits (SHF-4)', () => {
  it('moves a punch with If-Match and audits old and new values', async () => {
    const date = pastDate();
    const history = await api
      .as(w.a.admin, w.a.id)
      .get(`/punch?from=${date}&to=${date}&employee_id=${w.a.employee.userId}`)
      .expect(200);
    const start = history.body.days[0].sessions[0].events[0];
    const res = await api
      .as(w.a.admin, w.a.id)
      .patch(`/punch/${start.id}`)
      .set('If-Match', '1')
      .send({ occurredAt: seoul(date, '06:05') })
      .expect(200);
    expect(res.body).toMatchObject({ source: 'admin', version: 2 });
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/punch/${start.id}`)
      .set('If-Match', '1')
      .send({ occurredAt: seoul(date, '06:00') })
      .expect(409);
    const audit = await auditFor(start.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.at(-1)).toMatchObject({ action: 'punch.edit', actorId: w.a.admin.userId });
    const after = await api
      .as(w.a.employee, w.a.id)
      .get(`/punch?from=${date}&to=${date}`)
      .expect(200);
    expect(after.body.days[0].flags).toEqual([]);
  });

  it('is for admins only', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .post('/punch-events')
      .send({
        employeeId: w.a.employee.userId,
        eventType: 'end',
        occurredAt: new Date().toISOString(),
      })
      .expect(403);
  });
});

describe('punch change requests (SHF-5)', () => {
  it('lets an employee ask and the admin approve, which updates the punches', async () => {
    const date = addDays(pastDate(), -1);
    await api
      .as(w.a.admin, w.a.id)
      .post('/punch-events')
      .send({
        employeeId: w.a.employee.userId,
        eventType: 'start',
        occurredAt: seoul(date, '07:00'),
      })
      .expect(201);
    const created = await api
      .as(w.a.employee, w.a.id)
      .post('/punch-change-requests')
      .send({
        shiftDate: date,
        requestedStart: seoul(date, '06:00'),
        requestedEnd: seoul(date, '14:00'),
        reason: 'Forgot to punch on time.',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'pending',
      original: { start: seoul(date, '07:00'), end: null },
      requested: { start: seoul(date, '06:00'), end: seoul(date, '14:00') },
    });
    const queue = await api.as(w.a.admin, w.a.id).get('/punch-change-requests').expect(200);
    expect(queue.body.items.map((r: { id: string }) => r.id)).toContain(created.body.id);
    await api
      .as(w.a.employee, w.a.id)
      .post(`/punch-change-requests/${created.body.id}/decision`)
      .send({ decision: 'approve' })
      .expect(403);
    const decided = await api
      .as(w.a.admin, w.a.id)
      .post(`/punch-change-requests/${created.body.id}/decision`)
      .send({ decision: 'approve' })
      .expect(200);
    expect(decided.body).toMatchObject({
      status: 'approved',
      original: { start: seoul(date, '06:00'), end: seoul(date, '14:00') },
    });
    await api
      .as(w.a.admin, w.a.id)
      .post(`/punch-change-requests/${created.body.id}/decision`)
      .send({ decision: 'reject' })
      .expect(409);
    const audit = await auditFor(created.body.id, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    expect(audit.map((a) => a.action)).toEqual([
      'punch_change_request.create',
      'punch_change_request.approve',
    ]);
  });

  it('shows employees only their own requests', async () => {
    const own = await api
      .as(w.a.employee, w.a.id)
      .get('/punch-change-requests?status=approved')
      .expect(200);
    expect(
      own.body.items.every(
        (r: { employee: { id: string } }) => r.employee.id === w.a.employee.userId,
      ),
    ).toBe(true);
  });
});

describe('dashboards (SHF-2, SHF-7, SHF-8)', () => {
  it('give the admin every member by day with a colour slot', async () => {
    const date = pastDate();
    const res = await api
      .as(w.a.admin, w.a.id)
      .get(`/dashboard/shifts?from=${addDays(date, -1)}&to=${date}`)
      .expect(200);
    const employee = res.body.employees.find(
      (e: { employee: { id: string } }) => e.employee.id === w.a.employee.userId,
    );
    expect(employee.color).toEqual(expect.any(Number));
    expect(employee.days).toHaveLength(2);
    expect(employee.days[1]).toMatchObject({ date, workedMinutes: 475 });
  });

  it('give an employee their own personal dashboard', async () => {
    const date = pastDate();
    const res = await api
      .as(w.a.employee, w.a.id)
      .get(`/dashboard/me?from=${date}&to=${date}`)
      .expect(200);
    expect(res.body.employees.map((e: { employee: { id: string } }) => e.employee.id)).toEqual([
      w.a.employee.userId,
    ]);
  });

  it('follow Employee access for the main dashboard', async () => {
    const date = pastDate();
    await api.as(w.b.employee, w.b.id).get(`/dashboard/shifts?from=${date}&to=${date}`).expect(403);
    await api.as(w.a.employee, w.a.id).get(`/dashboard/shifts?from=${date}&to=${date}`).expect(200);
  });
});
