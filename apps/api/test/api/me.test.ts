import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp, type Session } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';

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
          organization: { id: orgId, name: 'Settings Bakery', type: 'bakery' },
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
