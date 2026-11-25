import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp, type Session } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';

/** Decided 2026-11-26: the owner, admins who work shifts, and demotion that really demotes. */
let app: INestApplication;
let api: Api;
let owner: Session;
let orgId: string;
let second: Session;
let worker: Session;

const memberOf = async (userId: string, as: Session = owner) =>
  (await api.as(as, orgId).get('/members').expect(200)).body.items.find(
    (m: { user: { id: string } }) => m.user.id === userId,
  ) as { id: string; version: number; owner: boolean; worksShifts: boolean; role: string };
const patchMember = (as: Session, m: { id: string; version: number }, body: object) =>
  api.as(as, orgId).patch(`/members/${m.id}`).set('If-Match', String(m.version)).send(body);

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  owner = await api.register('Founder');
  orgId = await api.createOrganization(owner, 'Owner Bakery');
  second = await api.hireEmployee(orgId, owner, 'Second Admin');
  worker = await api.hireEmployee(orgId, owner, 'Plain Worker');
  await patchMember(owner, await memberOf(second.userId), { role: 'admin' }).expect(200);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('owners', () => {
  it('is the person who created the organization', async () => {
    const me = await api.as(owner).get('/me').expect(200);
    expect(me.body.memberships[0]).toMatchObject({ role: 'admin', owner: true });
    expect(await memberOf(second.userId)).toMatchObject({ role: 'admin', owner: false });
  });

  it('alone makes, demotes or removes admins; other admins manage employees', async () => {
    // Another admin cannot touch the owner, make admins or remove an admin.
    const res = await patchMember(second, await memberOf(owner.userId), { role: 'employee' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OWNER_PROTECTED');
    await patchMember(second, await memberOf(worker.userId), { role: 'admin' }).expect(403);
    await api
      .as(second, orgId)
      .post('/members')
      .send({ email: worker.email, role: 'admin' })
      .expect(403);
    // ... but can still manage employees, e.g. take an employee off the team and back is fine.
    const helper = await api.register('Helper');
    await api
      .as(second, orgId)
      .post('/members')
      .send({ email: helper.email, role: 'employee' })
      .expect(201);
  });

  it('a demoted admin loses admin access on their next request', async () => {
    const third = await api.hireEmployee(orgId, owner, 'Third Admin');
    await patchMember(owner, await memberOf(third.userId), { role: 'admin' }).expect(200);
    await api.as(third, orgId).get('/members').expect(200);
    await patchMember(owner, await memberOf(third.userId), { role: 'employee' }).expect(200);
    await api.as(third, orgId).get('/members').expect(403);
    const me = await api.as(third).get('/me').expect(200);
    expect(
      me.body.memberships.find((m: { organization: { id: string } }) => m.organization.id === orgId)
        .role,
    ).toBe('employee');
  });

  it('can be shared: an owner makes another member an owner too and stays one', async () => {
    // A non-owner cannot.
    await api
      .as(second, orgId)
      .post(`/members/${(await memberOf(worker.userId)).id}/owner`)
      .expect(403);
    const res = await api
      .as(owner, orgId)
      .post(`/members/${(await memberOf(second.userId)).id}/owner`)
      .expect(200);
    expect(res.body).toMatchObject({ owner: true, role: 'admin' });
    expect(await memberOf(owner.userId)).toMatchObject({ owner: true });
    // The new owner has the owner powers too: here, making an employee an admin.
    const helper = await api.hireEmployee(orgId, owner, 'Shared Helper');
    await patchMember(second, await memberOf(helper.userId), { role: 'admin' }).expect(200);
    // An employee made an owner also becomes an admin.
    const made = await api
      .as(second, orgId)
      .post(`/members/${(await memberOf(worker.userId)).id}/owner`)
      .expect(200);
    expect(made.body).toMatchObject({ owner: true, role: 'admin' });
    const audit = await auditFor((await memberOf(second.userId)).id, {
      organizationId: orgId,
      userId: second.userId,
    });
    expect(audit.map((a) => a.action)).toContain('membership.owner_add');
  });

  it('owners never take ownership from each other; each can stop being one, one stays', async () => {
    // Another owner cannot demote, remove or un-own an owner (only the owner who made them one
    // may undo it, for 3 days: decided 2026-11-30, see undo.test.ts).
    const res = await patchMember(second, await memberOf(worker.userId), { role: 'employee' });
    expect(res.body.error.code).toBe('OWNER_PROTECTED');
    await api
      .as(owner, orgId)
      .delete(`/members/${(await memberOf(worker.userId)).id}/owner`)
      .expect(403);
    // Each steps down for themselves while another owner remains.
    await api
      .as(worker, orgId)
      .delete(`/members/${(await memberOf(worker.userId)).id}/owner`)
      .expect(200);
    await api
      .as(second, orgId)
      .delete(`/members/${(await memberOf(second.userId)).id}/owner`)
      .expect(200);
    expect(await memberOf(second.userId)).toMatchObject({ owner: false, role: 'admin' });
    const last = await api
      .as(owner, orgId)
      .delete(`/members/${(await memberOf(owner.userId)).id}/owner`)
      .expect(409);
    expect(last.body.error.code).toBe('LAST_OWNER');
    // Back to the start for the remaining tests: worker an employee again.
    await patchMember(owner, await memberOf(worker.userId), { role: 'employee' }).expect(200);
  });

  it('alone changes the bot permissions', async () => {
    const bot = await api.as(owner, orgId).get('/organization/bot-access').expect(200);
    await api
      .as(second, orgId)
      .put('/organization/bot-access')
      .set('If-Match', String(bot.body.version))
      .send({ manageMembers: true })
      .expect(403);
    await api
      .as(owner, orgId)
      .put('/organization/bot-access')
      .set('If-Match', String(bot.body.version))
      .send({ manageMembers: true })
      .expect(200);
  });
});

describe('admins who work shifts', () => {
  it('are left out of shifts and have no punch card until switched on', async () => {
    const plans = await api.as(owner, orgId).get('/shifts').expect(200);
    const ids = plans.body.items.map((i: { employee: { id: string } }) => i.employee.id);
    expect(ids).toContain(worker.userId);
    expect(ids).not.toContain(owner.userId);
    expect(ids).not.toContain(second.userId);
    await api
      .as(second, orgId)
      .post('/punch')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ action: 'start' })
      .expect(403);
    // Their own hours page is simply empty.
    const mine = await api
      .as(second, orgId)
      .get('/dashboard/me?from=2026-11-01&to=2026-11-02')
      .expect(200);
    expect(mine.body.employees).toEqual([]);
  });

  it('any admin switches it on, for themselves or another admin; employees always work', async () => {
    const res = await patchMember(owner, await memberOf(second.userId), {
      worksShifts: true,
    }).expect(200);
    expect(res.body).toMatchObject({ worksShifts: true, role: 'admin' });
    const plans = await api.as(owner, orgId).get('/shifts').expect(200);
    expect(plans.body.items.map((i: { employee: { id: string } }) => i.employee.id)).toContain(
      second.userId,
    );
    await api
      .as(second, orgId)
      .post('/punch')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ action: 'start' })
      .expect(200);
    const card = await api.as(second, orgId).get('/punch/card').expect(200);
    expect(card.body.status).toBe('working');
    const self = await patchMember(second, await memberOf(second.userId), { worksShifts: false });
    expect(self.status).toBe(200);
    const employee = await patchMember(owner, await memberOf(worker.userId), {
      worksShifts: false,
    });
    expect(employee.status).toBe(422);
  });
});
