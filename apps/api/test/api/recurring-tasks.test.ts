import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, weekdayOfDate } from '../../src/common/time';
import { dueOn, RecurringTasksService } from '../../src/tasks/recurring-tasks.service';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;
const TZ = 'Asia/Seoul';
const d = (s: string) => new Date(`${s}T00:00:00Z`);

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

describe('repeating tasks (phase 3)', () => {
  it('works out the due days for daily, weekly and monthly rules', () => {
    const base = {
      weekdays: [],
      dayOfMonth: null,
      startDate: d('2026-11-01'),
      endDate: null,
      active: true,
    };
    expect(dueOn({ ...base, frequency: 'daily' }, '2026-11-18')).toBe(true);
    expect(dueOn({ ...base, frequency: 'daily' }, '2026-10-31')).toBe(false);
    expect(dueOn({ ...base, frequency: 'daily', endDate: d('2026-11-10') }, '2026-11-18')).toBe(
      false,
    );
    expect(dueOn({ ...base, frequency: 'daily', active: false }, '2026-11-18')).toBe(false);
    // 2026-11-18 is a Wednesday (3).
    expect(dueOn({ ...base, frequency: 'weekly', weekdays: [3] }, '2026-11-18')).toBe(true);
    expect(dueOn({ ...base, frequency: 'weekly', weekdays: [1, 5] }, '2026-11-18')).toBe(false);
    expect(dueOn({ ...base, frequency: 'monthly', dayOfMonth: 18 }, '2026-11-18')).toBe(true);
    // Day 31 falls on the last day of a shorter month.
    expect(dueOn({ ...base, frequency: 'monthly', dayOfMonth: 31 }, '2026-11-30')).toBe(true);
    expect(dueOn({ ...base, frequency: 'monthly', dayOfMonth: 31 }, '2026-11-29')).toBe(false);
  });

  it('makes today’s task once, notifies the assignee and audits the rule', async () => {
    const today = localDate(TZ);
    const res = await api
      .as(w.a.admin, w.a.id)
      .post('/recurring-tasks')
      .send({
        title: 'Clean the mixers',
        assigneeId: w.a.employee.userId,
        frequency: 'weekly',
        weekdays: [weekdayOfDate(today)],
        startDate: today,
      })
      .expect(201);
    expect(res.body).toMatchObject({
      frequency: 'weekly',
      active: true,
      assignee: { id: w.a.employee.userId },
      lastMade: { date: today, status: 'open' },
    });
    // The job running again (on any number of servers) makes nothing more today.
    await app.get(RecurringTasksService).generate();
    await app.get(RecurringTasksService).generate();
    const tasks = await api.as(w.a.employee, w.a.id).get('/tasks').expect(200);
    const mine = tasks.body.items.filter((t: { title: string }) => t.title === 'Clean the mixers');
    expect(mine).toHaveLength(1);
    expect(mine[0].dueDate).toBe(today);
    const inbox = await api.as(w.a.employee).get('/notifications?unread=true').expect(200);
    expect(
      inbox.body.items.some(
        (n: { type: string; payload: { title?: string } }) =>
          n.type === 'task.assigned' && n.payload.title === 'Clean the mixers',
      ),
    ).toBe(true);
    const audit = await auditFor(res.body.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toContain('recurring_task.create');
  });

  it('makes the next due day’s task when that day comes, in the bakery’s time zone', async () => {
    const today = localDate(TZ);
    const tomorrow = addDays(today, 1);
    const rule = await api
      .as(w.a.admin, w.a.id)
      .post('/recurring-tasks')
      .send({
        title: 'Count flour',
        assigneeId: w.a.employee.userId,
        frequency: 'daily',
        startDate: tomorrow,
      })
      .expect(201);
    expect(rule.body.lastMade).toBeNull();
    // Noon tomorrow in Seoul.
    await app.get(RecurringTasksService).generate(new Date(`${tomorrow}T03:00:00Z`));
    const list = await api.as(w.a.admin, w.a.id).get('/recurring-tasks').expect(200);
    const found = list.body.items.find((r: { id: string }) => r.id === rule.body.id);
    expect(found.lastMade).toEqual({ date: tomorrow, status: 'open' });
  });

  it('pauses with the version check and makes nothing while paused', async () => {
    const today = localDate(TZ);
    const rule = await api
      .as(w.a.admin, w.a.id)
      .post('/recurring-tasks')
      .send({
        title: 'Wipe shelves',
        assigneeId: w.a.employee.userId,
        frequency: 'daily',
        startDate: addDays(today, 2),
      })
      .expect(201);
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/recurring-tasks/${rule.body.id}`)
      .send({ active: false })
      .expect(428);
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/recurring-tasks/${rule.body.id}`)
      .set('If-Match', String(rule.body.version + 1))
      .send({ active: false })
      .expect(409);
    const paused = await api
      .as(w.a.admin, w.a.id)
      .patch(`/recurring-tasks/${rule.body.id}`)
      .set('If-Match', String(rule.body.version))
      .send({ active: false })
      .expect(200);
    expect(paused.body.active).toBe(false);
    await app.get(RecurringTasksService).generate(new Date(`${addDays(today, 2)}T03:00:00Z`));
    const list = await api.as(w.a.admin, w.a.id).get('/recurring-tasks').expect(200);
    expect(list.body.items.find((r: { id: string }) => r.id === rule.body.id).lastMade).toBeNull();
    const audit = await auditFor(rule.body.id, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    expect(audit.map((a) => a.action)).toContain('recurring_task.update');
  });

  it('checks the rule and who may manage it', async () => {
    const today = localDate(TZ);
    await api
      .as(w.a.admin, w.a.id)
      .post('/recurring-tasks')
      .send({ title: 'X', assigneeId: w.a.employee.userId, frequency: 'weekly', startDate: today })
      .expect(400);
    await api
      .as(w.a.admin, w.a.id)
      .post('/recurring-tasks')
      .send({ title: 'X', assigneeId: w.a.employee.userId, frequency: 'monthly', startDate: today })
      .expect(400);
    await api
      .as(w.a.admin, w.a.id)
      .post('/recurring-tasks')
      .send({ title: 'X', assigneeId: w.b.employee.userId, frequency: 'daily', startDate: today })
      .expect(400);
    await api
      .as(w.a.employee, w.a.id)
      .post('/recurring-tasks')
      .send({ title: 'X', assigneeId: w.a.employee.userId, frequency: 'daily', startDate: today })
      .expect(403);
    await api.as(w.a.employee, w.a.id).get('/recurring-tasks').expect(403);
  });
});
