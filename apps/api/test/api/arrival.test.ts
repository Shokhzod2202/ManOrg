import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShiftsService } from '../../src/shifts/shifts.service';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;
const admin = () => api.as(w.a.admin, w.a.id);
const seoul = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);
// A Wednesday and the Thursday after it.
const WED = '2026-11-18';
const THU = '2026-11-19';

async function check(now: Date) {
  const org = {
    organizationId: w.a.id,
    organizationType: 'provider' as const,
    membershipId: w.a.employee.membershipId,
    role: 'employee' as const,
    actor: 'employee' as const,
    employeeAccess: {} as never,
    botAccess: {} as never,
  };
  return app.get(ShiftsService).arrival({ userId: w.a.employee.userId }, org, now);
}

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  // Wednesday 06:00-14:00, Thursday a night shift from 00:15.
  await admin()
    .put('/shifts')
    .send({
      employeeId: w.a.employee.userId,
      days: [
        { weekday: 3, startTime: '06:00', endTime: '14:00' },
        { weekday: 4, startTime: '00:15', endTime: '08:00' },
      ],
    })
    .expect(200);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('bakery location (spec section 9)', () => {
  it('is read by members, changed by admins with If-Match, and audited', async () => {
    const read = await api.as(w.a.employee, w.a.id).get('/organization/location').expect(200);
    expect(read.body).toMatchObject({
      enabled: false,
      latitude: null,
      longitude: null,
      radiusM: 100,
      windowBeforeMin: 60,
      windowAfterMin: 30,
    });
    await api
      .as(w.a.employee, w.a.id)
      .put('/organization/location')
      .set('If-Match', String(read.body.version))
      .send({ enabled: true })
      .expect(403);
    const noPlace = await admin()
      .put('/organization/location')
      .set('If-Match', String(read.body.version))
      .send({ enabled: true })
      .expect(400);
    expect(noPlace.body.error.fields).toHaveProperty('enabled');
    const set = await admin()
      .put('/organization/location')
      .set('If-Match', String(read.body.version))
      .send({ latitude: 37.5665, longitude: 126.978, radiusM: 120, enabled: true })
      .expect(200);
    expect(set.body).toMatchObject({
      enabled: true,
      latitude: 37.5665,
      longitude: 126.978,
      radiusM: 120,
    });
    await admin()
      .put('/organization/location')
      .set('If-Match', String(read.body.version))
      .send({ radiusM: 150 })
      .expect(409);
    const audit = await auditFor(w.a.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.find((a) => a.action === 'organization.location')).toMatchObject({
      before: expect.objectContaining({ enabled: false }),
      after: expect.objectContaining({ enabled: true, radiusM: 120 }),
    });
  });
});

describe('arrival prompt "You came to work. Start shift" (spec section 9)', () => {
  it('prompts within the window around a planned start, and only then', async () => {
    expect(await check(seoul(WED, '05:10'))).toMatchObject({
      prompt: true,
      message: 'You came to work. Start shift',
    });
    expect(await check(seoul(WED, '06:30'))).toMatchObject({ prompt: true });
    expect(await check(seoul(WED, '04:30'))).toMatchObject({
      prompt: false,
      reason: 'no_shift_now',
    });
    expect(await check(seoul(WED, '06:45'))).toMatchObject({
      prompt: false,
      reason: 'no_shift_now',
    });
  });

  it('says it in the employee’s language (phase 3)', async () => {
    await api.as(w.a.employee).patch('/me').send({ locale: 'ko' }).expect(200);
    expect(await check(seoul(WED, '05:10'))).toMatchObject({
      message: '출근했어요. 근무를 시작하세요',
    });
    await api.as(w.a.employee).patch('/me').send({ locale: 'en' }).expect(200);
  });

  it('finds a night shift that starts after midnight', async () => {
    const res = await check(seoul(WED, '23:40'));
    expect(res).toMatchObject({ prompt: true });
    expect(res.plannedStart?.toISOString()).toBe(seoul(THU, '00:15').toISOString());
  });

  it('never punches, and stays quiet once a shift is running', async () => {
    const count = () =>
      asOwner({ organizationId: w.a.id, userId: w.a.admin.userId }, (tx) =>
        tx.punchEvent.count({ where: { employeeId: w.a.employee.userId } }),
      );
    const before = await count();
    const res = await api.as(w.a.employee, w.a.id).post('/punch/arrival').expect(200);
    expect(res.body).toHaveProperty('prompt');
    expect(await count()).toBe(before);
    await api
      .as(w.a.employee, w.a.id)
      .post('/punch')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ action: 'start' })
      .expect(200);
    const working = await api.as(w.a.employee, w.a.id).post('/punch/arrival').expect(200);
    expect(working.body).toMatchObject({ prompt: false, reason: 'already_on_shift' });
    await api
      .as(w.a.employee, w.a.id)
      .post('/punch')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ action: 'end' })
      .expect(200);
  });

  it('can be turned off by the employee, and by the organization', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .patch('/me')
      .send({ preferences: { arrivalPrompt: false } })
      .expect(200);
    expect(await check(seoul(WED, '05:30'))).toMatchObject({
      prompt: false,
      reason: 'off_for_employee',
    });
    const me = await api.as(w.a.employee).get('/me').expect(200);
    expect(me.body.preferences).toMatchObject({ arrivalPrompt: false });
    await api
      .as(w.a.employee, w.a.id)
      .patch('/me')
      .send({ preferences: { arrivalPrompt: true } })
      .expect(200);
    const loc = await admin().get('/organization/location').expect(200);
    await admin()
      .put('/organization/location')
      .set('If-Match', String(loc.body.version))
      .send({ enabled: false })
      .expect(200);
    expect(await check(seoul(WED, '05:30'))).toMatchObject({
      prompt: false,
      reason: 'off_for_organization',
    });
  });

  it('is for employees of a bakery only', async () => {
    await api.as(w.contractor.admin, w.contractor.id).post('/punch/arrival').expect(403);
    await api.as(w.contractor.admin, w.contractor.id).get('/organization/location').expect(403);
  });
});
