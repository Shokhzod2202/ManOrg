import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp, type Session } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';

/** Decided 2026-11-30: removing someone or making them an owner can be undone for 3 days. */
let app: INestApplication;
let api: Api;
let owner: Session;
let orgId: string;
let helper: Session;

type M = { id: string; version: number; owner: boolean; role: string; status: string };
const memberOf = async (userId: string, status = 'active') =>
  (await api.as(owner, orgId).get(`/members?status=${status}`).expect(200)).body.items.find(
    (m: { user: { id: string } }) => m.user.id === userId,
  ) as M & { ownerGrantedBy: string | null; ownerGrantedAt: string | null };
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
const backdate = (id: string, data: object) =>
  asOwner({ organizationId: orgId, userId: owner.userId }, (tx) =>
    tx.membership.update({ where: { id }, data }),
  );

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  owner = await api.register('Founder');
  orgId = await api.createOrganization(owner, 'Undo Bakery');
  helper = await api.hireEmployee(orgId, owner, 'Helper');
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('undo making an owner', () => {
  it('lets the owner who did it take it back; the person returns to their role', async () => {
    const m = await memberOf(helper.userId);
    await api.as(owner, orgId).post(`/members/${m.id}/owner`).expect(200);
    const made = await memberOf(helper.userId);
    expect(made).toMatchObject({ owner: true, role: 'admin', ownerGrantedBy: owner.userId });
    expect(made.ownerGrantedAt).toEqual(expect.any(String));
    const undone = await api.as(owner, orgId).delete(`/members/${m.id}/owner`).expect(200);
    expect(undone.body).toMatchObject({ owner: false, role: 'employee', ownerGrantedBy: null });
    const audit = await auditFor(m.id, { organizationId: orgId, userId: owner.userId });
    expect(audit.at(-1)?.action).toBe('membership.owner_undo');
  });

  it('is only for 3 days, and only for the owner who did it', async () => {
    const m = await memberOf(helper.userId);
    await api.as(owner, orgId).post(`/members/${m.id}/owner`).expect(200);
    // The new owner cannot take ownership from the one who made them owner.
    const mine = await memberOf(owner.userId);
    await api.as(helper, orgId).delete(`/members/${mine.id}/owner`).expect(403);
    await backdate(m.id, { ownerGrantedAt: ago(3.1) });
    const res = await api.as(owner, orgId).delete(`/members/${m.id}/owner`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UNDO_EXPIRED');
    // They can still step down themselves, and stay an admin.
    await api.as(helper, orgId).delete(`/members/${m.id}/owner`).expect(200);
    expect(await memberOf(helper.userId)).toMatchObject({ owner: false, role: 'admin' });
    await api
      .as(owner, orgId)
      .patch(`/members/${m.id}`)
      .set('If-Match', String((await memberOf(helper.userId)).version))
      .send({ role: 'employee' })
      .expect(200);
  });
});

describe('undo a removal', () => {
  it('makes the person a member again, audited', async () => {
    const m = await memberOf(helper.userId);
    await api
      .as(owner, orgId)
      .patch(`/members/${m.id}`)
      .set('If-Match', String(m.version))
      .send({ status: 'removed' })
      .expect(200);
    expect(await memberOf(helper.userId)).toBeUndefined();
    const back = await api.as(owner, orgId).post(`/members/${m.id}/restore`).expect(200);
    expect(back.body).toMatchObject({ status: 'active', removedAt: null, role: 'employee' });
    await api.as(helper, orgId).get('/dashboard/home').expect(200);
    const audit = await auditFor(m.id, { organizationId: orgId, userId: owner.userId });
    expect(audit.at(-1)?.action).toBe('membership.restore');
  });

  it('is only for 3 days, and never for an active member', async () => {
    const m = await memberOf(helper.userId);
    await api.as(owner, orgId).post(`/members/${m.id}/restore`).expect(404);
    await api
      .as(owner, orgId)
      .patch(`/members/${m.id}`)
      .set('If-Match', String(m.version))
      .send({ status: 'removed' })
      .expect(200);
    await backdate(m.id, { removedAt: ago(3.1) });
    const res = await api.as(owner, orgId).post(`/members/${m.id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UNDO_EXPIRED');
    // Employees cannot undo removals.
    const other = await api.hireEmployee(orgId, owner, 'Other');
    await api.as(other, orgId).post(`/members/${m.id}/restore`).expect(403);
  });
});
