import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '../../src/common/time';
import { Api, auditFor, createTestApp, type Session } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/** Decided 2026-11-28: removing someone never blocks later edits, and their history stays. */
let app: INestApplication;
let api: Api;
let w: World;
const today = () => localDate('Asia/Seoul');
const admin = () => api.as(w.a.admin, w.a.id);
const member = async (userId: string, status = 'active') =>
  (await admin().get(`/members?status=${status}`).expect(200)).body.items.find(
    (m: { user: { id: string } }) => m.user.id === userId,
  ) as { id: string; version: number };
const remove = async (person: Session) => {
  const m = await member(person.userId);
  await admin()
    .patch(`/members/${m.id}`)
    .set('If-Match', String(m.version))
    .send({ status: 'removed' })
    .expect(200);
  return m.id;
};
const plan = (person: Session, weekdays: number[]) =>
  admin()
    .put('/shifts')
    .send({
      employeeId: person.userId,
      days: weekdays.map((weekday) => ({ weekday, startTime: '06:00', endTime: '14:00' })),
    })
    .expect(200);

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

describe('teams after someone is removed', () => {
  it('shows them as removed, lets the admin take them off or keep them, and never errors', async () => {
    const leaver = await api.hireEmployee(w.a.id, w.a.admin, 'Team Leaver');
    const team = await admin()
      .post('/teams')
      .send({ name: 'Oven pair', shared: true, memberIds: [w.a.employee.userId, leaver.userId] })
      .expect(201);
    await remove(leaver);
    const listed = (await admin().get('/teams').expect(200)).body.items.find(
      (x: { id: string }) => x.id === team.body.id,
    );
    expect(listed.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: leaver.userId, removed: true }),
        expect.objectContaining({ id: w.a.employee.userId, removed: false }),
      ]),
    );
    // Saving the team with the removed person still on it is fine ...
    await admin()
      .patch(`/teams/${team.body.id}`)
      .send({ name: 'Oven pair', memberIds: [w.a.employee.userId, leaver.userId] })
      .expect(200);
    // ... and taking them off is what the admin wanted to do (this failed before).
    const edited = await admin()
      .patch(`/teams/${team.body.id}`)
      .send({ memberIds: [w.a.employee.userId] })
      .expect(200);
    expect(edited.body.members.map((m: { id: string }) => m.id)).toEqual([w.a.employee.userId]);
    // Adding someone who has left is still refused.
    await admin()
      .patch(`/teams/${team.body.id}`)
      .send({ memberIds: [w.a.employee.userId, leaver.userId] })
      .expect(400);
  });

  it('gives a removed team member no share of output logged after the removal', async () => {
    const stays = await api.hireEmployee(w.a.id, w.a.admin, 'Team Stayer');
    const goes = await api.hireEmployee(w.a.id, w.a.admin, 'Team Goer');
    await admin()
      .put(`/employees/${stays.userId}/products`)
      .send({ productIds: [w.a.productId] })
      .expect(200);
    const team = await admin()
      .post('/teams')
      .send({ name: 'Credit pair', shared: true, memberIds: [stays.userId, goes.userId] })
      .expect(201);
    await remove(goes);
    await api
      .as(stays, w.a.id)
      .put(`/output/${today()}`)
      .send({ lines: [{ productId: w.a.productId, quantity: 10, teamId: team.body.id }] })
      .expect(200);
    const out = await admin()
      .get(`/output?from=${today()}&to=${today()}&employee_id=${stays.userId}`)
      .expect(200);
    expect(JSON.stringify(out.body)).not.toContain(goes.userId);
  });
});

describe('shifts after someone is removed', () => {
  it('keeps their days up to the removal, marked removed, and other plans still save', async () => {
    const leaver = await api.hireEmployee(w.a.id, w.a.admin, 'Shift Leaver');
    await plan(leaver, [1, 2, 3]);
    await api
      .as(leaver, w.a.id)
      .post('/punch')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ action: 'start' })
      .expect(200);
    await api
      .as(leaver, w.a.id)
      .post('/punch')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ action: 'end' })
      .expect(200);
    await remove(leaver);
    const from = addDays(today(), -2);
    const to = addDays(today(), 7);
    const dash = await admin().get(`/dashboard/shifts?from=${from}&to=${to}`).expect(200);
    const row = dash.body.employees.find(
      (e: { employee: { id: string } }) => e.employee.id === leaver.userId,
    );
    expect(row.removedOn).toBe(today());
    expect(row.days.every((d: { date: string }) => d.date <= today())).toBe(true);
    expect(row.days.some((d: { sessions: unknown[] }) => d.sessions.length > 0)).toBe(true);
    // Not in the weekly plan list any more; other plans save as before.
    const plans = await admin().get('/shifts').expect(200);
    expect(plans.body.items.map((i: { employee: { id: string } }) => i.employee.id)).not.toContain(
      leaver.userId,
    );
    await plan(w.a.employee, [0, 1]);
    // Their punch history is still there for the admin.
    await admin().get(`/punch?from=${from}&to=${today()}&employee_id=${leaver.userId}`).expect(200);
    // Decided 2026-11-30: in a later range where they never punched, they are not listed.
    const later = await admin()
      .get(`/dashboard/shifts?from=${addDays(today(), 1)}&to=${addDays(today(), 7)}`)
      .expect(200);
    expect(
      later.body.employees.map((e: { employee: { id: string } }) => e.employee.id),
    ).not.toContain(leaver.userId);
  });

  it('drops a removed person who never punched from the shift dashboard', async () => {
    const idle = await api.hireEmployee(w.a.id, w.a.admin, 'Never Punched');
    await plan(idle, [0, 1, 2, 3, 4, 5, 6]);
    await remove(idle);
    const dash = await admin()
      .get(`/dashboard/shifts?from=${addDays(today(), -6)}&to=${today()}`)
      .expect(200);
    expect(
      dash.body.employees.map((e: { employee: { id: string } }) => e.employee.id),
    ).not.toContain(idle.userId);
  });
});

describe('remove from everything, or hand over (decided 2026-11-28)', () => {
  it('hands shifts, teams, tasks, repeating tasks, ingredients and products to another employee', async () => {
    const leaver = await api.hireEmployee(w.a.id, w.a.admin, 'Hand Leaver');
    const heir = await api.hireEmployee(w.a.id, w.a.admin, 'Hand Heir');
    await plan(leaver, [1, 2]);
    await plan(heir, [1]);
    const team = await admin()
      .post('/teams')
      .send({ name: 'Hand team', shared: true, memberIds: [leaver.userId, w.a.employee.userId] })
      .expect(201);
    const task = await admin()
      .post('/tasks')
      .send({ title: 'Scrub trays', assigneeId: leaver.userId, dueDate: today() })
      .expect(201);
    const rule = await admin()
      .post('/recurring-tasks')
      .send({
        title: 'Count flour',
        assigneeId: leaver.userId,
        frequency: 'daily',
        startDate: addDays(today(), 1),
      })
      .expect(201);
    await admin()
      .put(`/ingredients/${w.a.ingredientId}/responsible`)
      .send({ employeeIds: [leaver.userId] })
      .expect(200);
    await admin()
      .put(`/employees/${leaver.userId}/products`)
      .send({ productIds: [w.a.productId] })
      .expect(200);
    const id = await remove(leaver);
    const res = await admin()
      .post(`/members/${id}/hand-over`)
      .send({ toUserId: heir.userId })
      .expect(200);
    expect(res.body).toMatchObject({
      shiftDays: 1,
      shiftDaysKept: 1,
      teams: 1,
      tasks: 1,
      repeatingTasks: 1,
      ingredients: 1,
      products: 1,
    });
    const heirPlan = (await admin().get(`/shifts?employee_id=${heir.userId}`).expect(200)).body
      .items[0];
    expect(heirPlan.days.map((d: { weekday: number }) => d.weekday)).toEqual([1, 2]);
    const teamNow = (await admin().get('/teams').expect(200)).body.items.find(
      (x: { id: string }) => x.id === team.body.id,
    );
    expect(teamNow.members.map((m: { id: string }) => m.id).sort()).toEqual(
      [heir.userId, w.a.employee.userId].sort(),
    );
    const taskNow = await admin().get(`/tasks/${task.body.id}`).expect(200);
    expect(taskNow.body.assignee).toMatchObject({ id: heir.userId });
    const ruleNow = (await admin().get('/recurring-tasks').expect(200)).body.items.find(
      (r: { id: string }) => r.id === rule.body.id,
    );
    expect(ruleNow).toMatchObject({ active: true, assignee: { id: heir.userId } });
    const products = await admin().get(`/employees/${heir.userId}/products`).expect(200);
    expect(products.body.items.map((p: { id: string }) => p.id)).toContain(w.a.productId);
    const audit = await auditFor(id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toContain('membership.hand_over');
  });

  it('or just clears it all: tasks go to the admins, a repeating task is paused', async () => {
    const leaver = await api.hireEmployee(w.a.id, w.a.admin, 'Clear Leaver');
    await plan(leaver, [4]);
    const team = await admin()
      .post('/teams')
      .send({ name: 'Clear team', shared: true, memberIds: [leaver.userId, w.a.employee.userId] })
      .expect(201);
    const task = await admin()
      .post('/tasks')
      .send({ title: 'Oil hinges', assigneeId: leaver.userId, dueDate: today() })
      .expect(201);
    const rule = await admin()
      .post('/recurring-tasks')
      .send({
        title: 'Sweep',
        assigneeId: leaver.userId,
        frequency: 'daily',
        startDate: addDays(today(), 1),
      })
      .expect(201);
    const id = await remove(leaver);
    await admin().post(`/members/${id}/hand-over`).send({ toUserId: null }).expect(200);
    const teamNow = (await admin().get('/teams').expect(200)).body.items.find(
      (x: { id: string }) => x.id === team.body.id,
    );
    expect(teamNow.members.map((m: { id: string }) => m.id)).toEqual([w.a.employee.userId]);
    expect((await admin().get(`/tasks/${task.body.id}`).expect(200)).body.assignee).toBeNull();
    const ruleNow = (await admin().get('/recurring-tasks').expect(200)).body.items.find(
      (r: { id: string }) => r.id === rule.body.id,
    );
    expect(ruleNow.active).toBe(false);
    // Handing over to someone outside the organization is refused; employees cannot do it.
    await admin()
      .post(`/members/${id}/hand-over`)
      .send({ toUserId: w.b.employee.userId })
      .expect(400);
    await api
      .as(w.a.employee, w.a.id)
      .post(`/members/${id}/hand-over`)
      .send({ toUserId: null })
      .expect(403);
  });
});
