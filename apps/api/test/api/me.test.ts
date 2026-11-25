import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp, PNG, type Session } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';

let app: INestApplication;
let api: Api;
let me: Session;

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  me = await api.register('Settings User');
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('/me (ACC-8)', () => {
  it('returns the account and its memberships', async () => {
    const admin = await api.register('Boss');
    const orgId = await api.createOrganization(admin, 'Settings Bakery');
    const employee = await api.hireEmployee(orgId, admin, 'Worker');
    const res = await api.as(employee).get('/me').expect(200);
    expect(res.body).toMatchObject({
      id: employee.userId,
      memberships: [
        {
          role: 'employee',
          status: 'active',
          organization: { id: orgId, name: 'Settings Bakery', type: 'provider' },
        },
      ],
    });
  });

  it('changes the name and audits old and new values', async () => {
    const res = await api.as(me).patch('/me').send({ name: 'Renamed User' }).expect(200);
    expect(res.body.name).toBe('Renamed User');
    const audit = await auditFor(me.userId, { organizationId: null, userId: me.userId });
    const update = audit.find((a) => a.action === 'user.update');
    expect(update?.before).toMatchObject({ name: 'Settings User' });
    expect(update?.after).toMatchObject({ name: 'Renamed User' });
  });

  it('never changes a role', async () => {
    const res = await api.as(me).patch('/me').send({ role: 'admin' }).expect(400);
    expect(res.body.error.fields).toHaveProperty('role');
  });

  it('needs the current password to change email or password', async () => {
    await api.as(me).patch('/me').send({ email: 'new@test.local' }).expect(400);
    const wrong = await api
      .as(me)
      .patch('/me')
      .send({ email: 'new@test.local', currentPassword: 'Wrong-password' })
      .expect(400);
    expect(wrong.body.error.fields).toHaveProperty('currentPassword');
    await api
      .as(me)
      .patch('/me')
      .send({ email: 'new@test.local', currentPassword: 'Password123!' })
      .expect(200);
    await api.http
      .post('/api/v1/auth/login')
      .send({ email: 'new@test.local', password: 'Password123!' })
      .expect(200);
  });

  it('signs out other sessions when the password changes', async () => {
    await api
      .as(me)
      .patch('/me')
      .send({ password: 'Another-password-1', currentPassword: 'Password123!' })
      .expect(200);
    await api.http.post('/api/v1/auth/refresh').send({ refreshToken: me.refreshToken }).expect(401);
    const audit = await auditFor(me.userId, { organizationId: null, userId: me.userId });
    expect(audit.at(-1)?.after).toMatchObject({ passwordChanged: true });
  });
});

describe('account settings (decided 2026-11-25)', () => {
  it('sets and removes a profile picture, shown to the organization in the members list', async () => {
    const admin = await api.register('Avatar Boss');
    const orgId = await api.createOrganization(admin, 'Avatar Bakery');
    const worker = await api.hireEmployee(orgId, admin, 'Avatar Worker');
    await api
      .as(worker)
      .post('/me/avatar')
      .attach('file', Buffer.from('not a picture'), 'x.png')
      .expect(400);
    const set = await api.as(worker).post('/me/avatar').attach('file', PNG, 'me.png').expect(200);
    expect(set.body.avatarUrl).toContain('/api/v1/files/');
    const file = await api.http.get(
      new URL(set.body.avatarUrl).pathname + new URL(set.body.avatarUrl).search,
    );
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('image/png');
    const members = await api.as(admin, orgId).get('/members').expect(200);
    const row = members.body.items.find(
      (m: { user: { id: string } }) => m.user.id === worker.userId,
    );
    expect(row.user.avatarUrl).toContain('/api/v1/files/');
    const removed = await api.as(worker).delete('/me/avatar').expect(200);
    expect(removed.body.avatarUrl).toBeNull();
    const audit = await auditFor(worker.userId, { organizationId: null, userId: worker.userId });
    expect(audit.filter((a) => a.action === 'user.avatar')).toHaveLength(2);
  });

  it('an account made through Telegram adds its first email and password without a current one', async () => {
    const tg = await api.register('Telegram Person');
    await asOwner({ organizationId: null, userId: tg.userId }, (tx) =>
      tx.user.update({ where: { id: tg.userId }, data: { email: null, passwordHash: null } }),
    );
    const before = await api.as(tg).get('/me').expect(200);
    expect(before.body).toMatchObject({ email: null, hasPassword: false });
    // A password needs an email to sign in with.
    await api.as(tg).patch('/me').send({ password: 'Fresh-password-1' }).expect(400);
    await api.as(tg).patch('/me').send({ email: 'tg@test.local' }).expect(200);
    const after = await api.as(tg).patch('/me').send({ password: 'Fresh-password-1' }).expect(200);
    expect(after.body).toMatchObject({ email: 'tg@test.local', hasPassword: true });
    await api.http
      .post('/api/v1/auth/login')
      .send({ email: 'tg@test.local', password: 'Fresh-password-1' })
      .expect(200);
    // From now on a change needs the password.
    await api.as(tg).patch('/me').send({ email: 'tg2@test.local' }).expect(400);
  });

  it('signs out on every device', async () => {
    const person = await api.register('Many Devices');
    await api.as(person).post('/me/sign-out-everywhere').expect(204);
    await api.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: person.refreshToken })
      .expect(401);
    const audit = await auditFor(person.userId, { organizationId: null, userId: person.userId });
    expect(audit.map((a) => a.action)).toContain('user.sign_out_everywhere');
  });
});

describe('preferences (decided 2026-11-13)', () => {
  it('keeps the chosen orders view until it is changed', async () => {
    const fresh = await api.register('Viewer');
    expect((await api.as(fresh).get('/me').expect(200)).body.preferences).toEqual({
      ordersView: 'products',
      arrivalPrompt: true,
    });
    await api
      .as(fresh)
      .patch('/me')
      .send({ preferences: { ordersView: 'matrix' } })
      .expect(200);
    expect((await api.as(fresh).get('/me').expect(200)).body.preferences).toEqual({
      ordersView: 'matrix',
      arrivalPrompt: true,
    });
    await api
      .as(fresh)
      .patch('/me')
      .send({ preferences: { ordersView: 'grid' } })
      .expect(400);
  });
});
