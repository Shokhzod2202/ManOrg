import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;

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

async function memberOf(orgId: string, userId: string, session = w.a.admin) {
  const res = await api.as(session, orgId).get('/members').expect(200);
  return res.body.items.find((m: { user: { id: string } }) => m.user.id === userId);
}

describe('GET /members', () => {
  it('lists active members for a bakery admin', async () => {
    const res = await api.as(w.a.admin, w.a.id).get('/members').expect(200);
    expect(res.body.items.map((m: { user: { id: string } }) => m.user.id).sort()).toEqual(
      [w.a.admin.userId, w.a.employee.userId].sort(),
    );
    expect(res.body.items[0]).toEqual({
      id: expect.any(String),
      role: 'admin',
      status: 'active',
      version: 1,
      user: { id: w.a.admin.userId, name: w.a.admin.name, email: w.a.admin.email },
      createdAt: expect.any(String),
    });
  });

  it('lists a contractor organization’s own admins for its admin', async () => {
    const res = await api.as(w.contractor.admin, w.contractor.id).get('/members').expect(200);
    expect(res.body.items.map((m: { user: { id: string } }) => m.user.id)).toEqual([
      w.contractor.admin.userId,
    ]);
  });

  it('is forbidden to employees (403)', async () => {
    await api.as(w.a.employee, w.a.id).get('/members').expect(403);
  });

  it('answers 404 for an organization the caller is not in', async () => {
    await api.as(w.a.admin, w.b.id).get('/members').expect(404);
    await api.as(w.contractor.admin, w.a.id).get('/members').expect(404);
  });
});

describe('POST /members (ACC-7)', () => {
  it('adds an existing account as another admin, audited', async () => {
    const second = await api.register('Second Admin');
    const res = await api
      .as(w.a.admin, w.a.id)
      .post('/members')
      .send({ email: second.email, role: 'admin' })
      .expect(201);
    expect(res.body).toMatchObject({
      role: 'admin',
      status: 'active',
      user: { id: second.userId },
    });
    await api.as(second, w.a.id).get('/applications').expect(200);
    const audit = await auditFor(res.body.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual(['membership.create']);
  });

  it('lets a contractor admin add admins but not employees', async () => {
    const helper = await api.register('Cafe Helper');
    const res = await api
      .as(w.contractor.admin, w.contractor.id)
      .post('/members')
      .send({ email: helper.email, role: 'employee' })
      .expect(422);
    expect(res.body.error.code).toBe('CONTRACTOR_ADMINS_ONLY');
    await api
      .as(w.contractor.admin, w.contractor.id)
      .post('/members')
      .send({ email: helper.email, role: 'admin' })
      .expect(201);
  });

  it('refuses someone who already belongs to an organization', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .post('/members')
      .send({ email: w.b.employee.email, role: 'employee' })
      .expect(409);
    expect(res.body.error.code).toBe('ALREADY_IN_ORGANIZATION');
  });

  it('refuses an email with no account', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .post('/members')
      .send({ email: 'ghost@test.local', role: 'admin' })
      .expect(422);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('is forbidden to employees (403)', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .post('/members')
      .send({ email: 'x@test.local', role: 'admin' })
      .expect(403);
  });
});

describe('PATCH /members/{id}', () => {
  it('needs If-Match', async () => {
    const m = await memberOf(w.a.id, w.a.employee.userId);
    const res = await api
      .as(w.a.admin, w.a.id)
      .patch(`/members/${m.id}`)
      .send({ role: 'admin' })
      .expect(428);
    expect(res.body.error.code).toBe('PRECONDITION_REQUIRED');
  });

  it('rejects a stale version with 409', async () => {
    const m = await memberOf(w.a.id, w.a.employee.userId);
    const res = await api
      .as(w.a.admin, w.a.id)
      .patch(`/members/${m.id}`)
      .set('If-Match', `"${m.version + 5}"`)
      .send({ role: 'admin' })
      .expect(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('changes a role, effective on the next request, and audits it', async () => {
    const m = await memberOf(w.a.id, w.a.employee.userId);
    await api.as(w.a.employee, w.a.id).get('/applications').expect(403);
    const res = await api
      .as(w.a.admin, w.a.id)
      .patch(`/members/${m.id}`)
      .set('If-Match', `"${m.version}"`)
      .send({ role: 'admin' })
      .expect(200);
    expect(res.body).toMatchObject({ role: 'admin', version: m.version + 1 });
    await api.as(w.a.employee, w.a.id).get('/applications').expect(200);

    const audit = await auditFor(m.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    const change = audit.find((a) => a.action === 'membership.role_change');
    expect(change).toMatchObject({
      actorType: 'user',
      actorId: w.a.admin.userId,
      before: expect.objectContaining({ role: 'employee' }),
      after: expect.objectContaining({ role: 'admin' }),
    });
  });

  it('keeps at least one admin', async () => {
    const m = await memberOf(w.b.id, w.b.admin.userId, w.b.admin);
    const res = await api
      .as(w.b.admin, w.b.id)
      .patch(`/members/${m.id}`)
      .set('If-Match', String(m.version))
      .send({ role: 'employee' })
      .expect(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
  });

  it('removes a member, who loses access at once', async () => {
    const m = await memberOf(w.b.id, w.b.employee.userId, w.b.admin);
    await api
      .as(w.b.admin, w.b.id)
      .patch(`/members/${m.id}`)
      .set('If-Match', String(m.version))
      .send({ status: 'removed' })
      .expect(200);
    await api.as(w.b.employee, w.b.id).get('/members').expect(404);
    const removed = await api.as(w.b.admin, w.b.id).get('/members?status=removed').expect(200);
    expect(removed.body.items.map((i: { id: string }) => i.id)).toContain(m.id);
  });

  it('answers 404 for a member of another organization', async () => {
    const other = await memberOf(w.b.id, w.b.admin.userId, w.b.admin);
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/members/${other.id}`)
      .set('If-Match', String(other.version))
      .send({ role: 'employee' })
      .expect(404);
  });

  it('is forbidden to employees (403)', async () => {
    const hire = await api.hireEmployee(w.a.id, w.a.admin, 'Junior');
    const m = await memberOf(w.a.id, w.a.admin.userId);
    await api
      .as(hire, w.a.id)
      .patch(`/members/${m.id}`)
      .set('If-Match', String(m.version))
      .send({ status: 'removed' })
      .expect(403);
  });
});
