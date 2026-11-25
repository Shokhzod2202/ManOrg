import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDate } from '../../src/common/time';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/** Decided 2026-11-29: the organization's name and title for a person. */
let app: INestApplication;
let api: Api;
let w: World;
const admin = () => api.as(w.a.admin, w.a.id);
const today = () => localDate('Asia/Seoul');

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  const m = (await admin().get('/members').expect(200)).body.items.find(
    (x: { user: { id: string } }) => x.user.id === w.a.employee.userId,
  );
  await admin()
    .patch(`/members/${m.id}`)
    .set('If-Match', String(m.version))
    .send({ displayName: 'Baker Bo', title: 'Head baker' })
    .expect(200);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('names and titles given by admins', () => {
  it('shows in the members list next to the account name, audited', async () => {
    const m = (await admin().get('/members').expect(200)).body.items.find(
      (x: { user: { id: string } }) => x.user.id === w.a.employee.userId,
    );
    expect(m).toMatchObject({
      displayName: 'Baker Bo',
      title: 'Head baker',
      user: { name: w.a.employee.name },
    });
    const audit = await auditFor(m.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toContain('membership.profile');
  });

  it('replaces the account name in shifts, teams, tasks and output, with the title where shown', async () => {
    const plans = await admin().get('/shifts').expect(200);
    expect(
      plans.body.items.find(
        (i: { employee: { id: string } }) => i.employee.id === w.a.employee.userId,
      ).employee,
    ).toMatchObject({ name: 'Baker Bo', title: 'Head baker' });
    const team = await admin()
      .post('/teams')
      .send({ name: 'Named pair', shared: true, memberIds: [w.a.employee.userId] })
      .expect(201);
    expect(team.body.members[0]).toMatchObject({ name: 'Baker Bo' });
    const task = await admin()
      .post('/tasks')
      .send({ title: 'Label jars', assigneeId: w.a.employee.userId, dueDate: today() })
      .expect(201);
    expect(task.body.assignee).toMatchObject({ name: 'Baker Bo' });
    const out = await admin().get(`/dashboard/shift-output?date=${today()}`).expect(200);
    expect(
      out.body.employees.find(
        (e: { employee: { id: string } }) => e.employee.id === w.a.employee.userId,
      ).employee,
    ).toMatchObject({ name: 'Baker Bo', title: 'Head baker' });
  });

  it('is only for that organization; the person sees it on their membership', async () => {
    const me = await api.as(w.a.employee).get('/me').expect(200);
    expect(me.body.name).toBe(w.a.employee.name);
    expect(me.body.memberships[0]).toMatchObject({ displayName: 'Baker Bo', title: 'Head baker' });
  });

  it('is cleared with an empty value, and employees cannot set it', async () => {
    const m = (await admin().get('/members').expect(200)).body.items.find(
      (x: { user: { id: string } }) => x.user.id === w.a.employee.userId,
    );
    await api
      .as(w.a.employee, w.a.id)
      .patch(`/members/${m.id}`)
      .set('If-Match', String(m.version))
      .send({ displayName: 'Me' })
      .expect(403);
    const cleared = await admin()
      .patch(`/members/${m.id}`)
      .set('If-Match', String(m.version))
      .send({ displayName: '', title: null })
      .expect(200);
    expect(cleared.body).toMatchObject({ displayName: null, title: null });
    const plans = await admin().get('/shifts').expect(200);
    expect(
      plans.body.items.find(
        (i: { employee: { id: string } }) => i.employee.id === w.a.employee.userId,
      ).employee.name,
    ).toBe(w.a.employee.name);
  });
});
