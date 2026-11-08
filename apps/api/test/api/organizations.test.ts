import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
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

describe('POST /organizations (ACC-4)', () => {
  it('makes the creator the first admin and audits both rows', async () => {
    const founder = await api.register('Founder');
    const res = await api
      .as(founder)
      .post('/organizations')
      .send({ name: 'Dawn Bakery', type: 'bakery' })
      .expect(201);
    expect(res.body).toMatchObject({
      organization: { name: 'Dawn Bakery', type: 'bakery', timezone: 'Asia/Seoul', version: 1 },
      membership: { role: 'admin', status: 'active' },
    });
    const orgId = res.body.organization.id;
    const ctx = { organizationId: orgId, userId: founder.userId };
    expect((await auditFor(orgId, ctx)).map((a) => a.action)).toEqual(['organization.create']);
    expect((await auditFor(res.body.membership.id, ctx)).map((a) => a.action)).toEqual([
      'membership.create',
    ]);
    // The admin can act inside it right away.
    await api.as(founder, orgId).get('/members').expect(200);
  });

  it('allows one organization per user in v1 (open question 3)', async () => {
    const res = await api
      .as(w.a.admin)
      .post('/organizations')
      .send({ name: 'Second Bakery', type: 'bakery' })
      .expect(409);
    expect(res.body.error.code).toBe('ALREADY_IN_ORGANIZATION');
    await api
      .as(w.a.applicant)
      .post('/organizations')
      .send({ name: 'Pending person bakery', type: 'bakery' })
      .expect(409);
  });

  it('validates name, type and time zone', async () => {
    const someone = await api.register('Validator');
    const res = await api
      .as(someone)
      .post('/organizations')
      .send({ name: ' ', type: 'shop', timezone: 'Mars/Base' })
      .expect(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['name', 'timezone', 'type']);
  });
});

describe('GET /organizations (ACC-3 account pool)', () => {
  it('finds organizations by part of the name, case-insensitively', async () => {
    const searcher = await api.register('Searcher');
    const res = await api.as(searcher).get('/organizations?q=alpha').expect(200);
    expect(res.body.items).toEqual([{ id: w.a.id, name: 'Alpha Bakery', type: 'bakery' }]);
  });

  it('pages with limit and cursor', async () => {
    const searcher = await api.register('Pager');
    const first = await api.as(searcher).get('/organizations?limit=2').expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(first.body.items[1].id);
    const second = await api
      .as(searcher)
      .get(`/organizations?limit=2&cursor=${first.body.nextCursor}`)
      .expect(200);
    const seen = [...first.body.items, ...second.body.items].map((o: { id: string }) => o.id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('shows only id, name and type', async () => {
    const searcher = await api.register('Peeker');
    const res = await api.as(searcher).get('/organizations?q=Beta').expect(200);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['id', 'name', 'type']);
  });
});

describe('POST /organizations/{id}/applications as a person (ACC-5)', () => {
  it('creates a pending employee application with no access yet', async () => {
    const person = await api.register('Hopeful');
    const res = await api.as(person).post(`/organizations/${w.b.id}/applications`).expect(201);
    expect(res.body).toMatchObject({
      kind: 'employee',
      status: 'pending',
      organization: { id: w.b.id, name: 'Beta Bakery' },
    });
    await api.as(person, w.b.id).get('/members').expect(404);
    const audit = await auditFor(res.body.id, { organizationId: null, userId: person.userId });
    expect(audit.map((a) => a.action)).toEqual(['membership.apply']);
  });

  it('refuses a second open application', async () => {
    const res = await api
      .as(w.a.applicant)
      .post(`/organizations/${w.b.id}/applications`)
      .expect(409);
    expect(res.body.error.code).toBe('ALREADY_IN_ORGANIZATION');
  });

  it('refuses applications to contractor organizations, which have admins only', async () => {
    const person = await api.register('Wrong Door');
    const res = await api
      .as(person)
      .post(`/organizations/${w.contractor.id}/applications`)
      .expect(422);
    expect(res.body.error.code).toBe('CONTRACTOR_ADMINS_ONLY');
  });

  it('answers 404 for an organization that does not exist', async () => {
    const person = await api.register('Lost');
    await api
      .as(person)
      .post('/organizations/00000000-0000-4000-8000-000000000000/applications')
      .expect(404);
  });

  it('lets a rejected applicant re-apply only after 7 days', async () => {
    const person = await api.register('Second Chance');
    const first = await api.as(person).post(`/organizations/${w.a.id}/applications`).expect(201);
    await api.as(w.a.admin, w.a.id).post(`/applications/${first.body.id}/reject`).expect(200);
    const tooSoon = await api.as(person).post(`/organizations/${w.a.id}/applications`).expect(409);
    expect(tooSoon.body.error.code).toBe('REAPPLY_TOO_SOON');

    await asOwner({ organizationId: w.a.id, userId: w.a.admin.userId }, (tx) =>
      tx.membership.update({
        where: { id: first.body.id },
        data: { decidedAt: new Date(Date.now() - 8 * 86_400_000) },
      }),
    );
    await api.as(person).post(`/organizations/${w.a.id}/applications`).expect(201);
  });
});

describe('POST /organizations/{id}/applications as a contractor (ACC-6)', () => {
  it('creates a pending link for the contractor organization', async () => {
    const admin = await api.register('Kiosk Admin');
    const kiosk = await api.createOrganization(admin, 'Station Kiosk', 'contractor');
    const res = await api
      .as(admin, kiosk)
      .post(`/organizations/${w.b.id}/applications`)
      .expect(201);
    expect(res.body).toMatchObject({ kind: 'contractor', status: 'pending' });
    const again = await api
      .as(admin, kiosk)
      .post(`/organizations/${w.b.id}/applications`)
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_APPLIED');
  });

  it('refuses a contractor that is already approved', async () => {
    const res = await api
      .as(w.contractor.admin, w.contractor.id)
      .post(`/organizations/${w.a.id}/applications`)
      .expect(409);
    expect(res.body.error.code).toBe('ALREADY_LINKED');
  });

  it('refuses bakery members acting with their bakery as the applicant', async () => {
    await api.as(w.a.admin, w.a.id).post(`/organizations/${w.b.id}/applications`).expect(403);
    await api.as(w.a.employee, w.a.id).post(`/organizations/${w.b.id}/applications`).expect(403);
  });

  it('refuses an organization header the caller does not belong to', async () => {
    await api
      .as(w.pendingContractor.admin, w.contractor.id)
      .post(`/organizations/${w.a.id}/applications`)
      .expect(404);
  });
});
