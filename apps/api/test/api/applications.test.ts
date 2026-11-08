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

describe('GET /applications', () => {
  it('lists pending employees and contractors for the bakery admin', async () => {
    const res = await api.as(w.b.admin, w.b.id).get('/applications').expect(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({
        id: w.b.applicant.applicationId,
        kind: 'employee',
        status: 'pending',
        applicant: {
          id: w.b.applicant.userId,
          name: w.b.applicant.name,
          email: w.b.applicant.email,
        },
        contractor: null,
      }),
      expect.objectContaining({
        id: w.pendingContractor.applicationId,
        kind: 'contractor',
        applicant: expect.objectContaining({ id: w.pendingContractor.admin.userId }),
        contractor: { id: w.pendingContractor.id, name: 'Night Diner', type: 'contractor' },
      }),
    ]);
  });

  it('is forbidden to employees (403)', async () => {
    await api.as(w.a.employee, w.a.id).get('/applications').expect(403);
  });

  it('is forbidden to contractor admins (403)', async () => {
    await api.as(w.contractor.admin, w.contractor.id).get('/applications').expect(403);
  });

  it('answers 404 for another organization', async () => {
    await api.as(w.a.admin, w.b.id).get('/applications').expect(404);
  });

  it('answers 404 to a pending applicant', async () => {
    await api.as(w.a.applicant, w.a.id).get('/applications').expect(404);
  });

  it('needs the organization header', async () => {
    const res = await api.as(w.a.admin).get('/applications').expect(400);
    expect(res.body.error.code).toBe('ORGANIZATION_REQUIRED');
  });
});

describe('POST /applications/{id}/approve and /reject', () => {
  it('approves an employee, who then gets employee access', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .post(`/applications/${w.a.applicant.applicationId}/approve`)
      .expect(200);
    expect(res.body).toMatchObject({ kind: 'employee', status: 'active' });
    const me = await api.as(w.a.applicant).get('/me').expect(200);
    expect(me.body.memberships[0]).toMatchObject({ role: 'employee', status: 'active' });
    // Employees still cannot manage members.
    await api.as(w.a.applicant, w.a.id).get('/members').expect(403);

    const audit = await auditFor(w.a.applicant.applicationId, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    const approve = audit.find((a) => a.action === 'membership.approve');
    expect(approve).toMatchObject({
      actorId: w.a.admin.userId,
      before: expect.objectContaining({ status: 'pending' }),
      after: expect.objectContaining({ status: 'active' }),
    });
  });

  it('refuses to decide twice', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .post(`/applications/${w.a.applicant.applicationId}/reject`)
      .expect(409);
    expect(res.body.error.code).toBe('NOT_PENDING');
  });

  it('approves a contractor, with an audit entry', async () => {
    const res = await api
      .as(w.b.admin, w.b.id)
      .post(`/applications/${w.pendingContractor.applicationId}/approve`)
      .expect(200);
    expect(res.body).toMatchObject({ kind: 'contractor', status: 'approved' });
    const audit = await auditFor(w.pendingContractor.applicationId, {
      organizationId: w.b.id,
      userId: w.b.admin.userId,
    });
    expect(audit.map((a) => a.action)).toContain('contractor_link.approve');
  });

  it('rejects an employee application', async () => {
    const person = await api.register('Declined');
    const applied = await api.as(person).post(`/organizations/${w.b.id}/applications`).expect(201);
    const res = await api
      .as(w.b.admin, w.b.id)
      .post(`/applications/${applied.body.id}/reject`)
      .expect(200);
    expect(res.body.status).toBe('rejected');
    await api.as(person, w.b.id).get('/members').expect(404);
  });

  it('answers 404 for another organization’s application', async () => {
    const person = await api.register('Elsewhere');
    const applied = await api.as(person).post(`/organizations/${w.b.id}/applications`).expect(201);
    await api.as(w.a.admin, w.a.id).post(`/applications/${applied.body.id}/approve`).expect(404);
    // Still pending for its own organization.
    const list = await api.as(w.b.admin, w.b.id).get('/applications').expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(applied.body.id);
  });

  it('is forbidden to employees (403)', async () => {
    const person = await api.register('Self Approver');
    const applied = await api.as(person).post(`/organizations/${w.a.id}/applications`).expect(201);
    await api.as(w.a.employee, w.a.id).post(`/applications/${applied.body.id}/approve`).expect(403);
  });

  it('rejects a malformed id', async () => {
    await api.as(w.a.admin, w.a.id).post('/applications/not-a-uuid/approve').expect(400);
  });
});
