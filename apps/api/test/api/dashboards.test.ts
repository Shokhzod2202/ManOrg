import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '../../src/common/time';
import { Api, createTestApp } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;
const today = () => localDate('Asia/Seoul');

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  await api.as(w.a.employee, w.a.id).post('/punch').send({ action: 'start' }).expect(200);
  await api
    .as(w.contractor.admin, w.contractor.id)
    .post('/orders')
    .send({
      providerId: w.a.id,
      deliveryDate: addDays(today(), 1),
      lines: [{ productId: w.a.productId, quantity: 30 }],
    })
    .expect(201);
  await api
    .as(w.a.admin, w.a.id)
    .post('/tasks')
    .send({ title: 'Clean ovens', assigneeId: w.a.employee.userId, dueDate: today() })
    .expect(201);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe("Today's Dashboard (DSH-1)", () => {
  it('shows who is on shift, tasks due, orders due next and what waits for a decision', async () => {
    const res = await api.as(w.a.admin, w.a.id).get('/dashboard/today').expect(200);
    expect(res.body.today).toBe(today());
    expect(res.body.onShift).toEqual([
      expect.objectContaining({
        employee: { id: w.a.employee.userId, name: w.a.employee.name },
        status: 'working',
      }),
    ]);
    expect(res.body.tasks.due.map((t: { title: string }) => t.title)).toContain('Clean ovens');
    expect(res.body.ordersDueNext.totals).toEqual([
      { productId: w.a.productId, productName: 'Alpha Bread', quantity: 30 },
    ]);
    expect(res.body.waiting.applications).toBe(1);
  });

  it('is for admins; employees and contractors use their own homes', async () => {
    await api.as(w.a.employee, w.a.id).get('/dashboard/today').expect(403);
    await api.as(w.contractor.admin, w.contractor.id).get('/dashboard/today').expect(403);
    await api.as(w.a.admin, w.b.id).get('/dashboard/today').expect(404);
  });
});

describe('employee home (DSH-2)', () => {
  it('puts the punch card, today’s output, own tasks and My Orders in one call', async () => {
    const res = await api.as(w.a.employee, w.a.id).get('/dashboard/home').expect(200);
    expect(res.body.punchCard).toMatchObject({
      status: 'working',
      allowedActions: ['pause', 'end'],
    });
    expect(res.body.output).toMatchObject({ date: today() });
    expect(res.body.tasks.map((t: { title: string }) => t.title)).toEqual(['Clean ovens']);
    expect(res.body.myOrders.orders[0].lines).toEqual([
      { productId: w.a.productId, productName: 'Alpha Bread', quantity: 30 },
    ]);
    expect(res.body.unreadNotifications).toBeGreaterThan(0);
  });
});

describe('application notifications (spec section 9)', () => {
  it('tell the admins about a new application and the applicant about the decision', async () => {
    const person = await api.register('Notified Applicant');
    const applied = await api.as(person).post(`/organizations/${w.b.id}/applications`).expect(201);
    const adminInbox = await api.as(w.b.admin).get('/notifications?unread=true').expect(200);
    expect(adminInbox.body.items.map((n: { type: string }) => n.type)).toContain(
      'application.created',
    );
    await api.as(w.b.admin, w.b.id).post(`/applications/${applied.body.id}/approve`).expect(200);
    const inbox = await api.as(person).get('/notifications').expect(200);
    expect(inbox.body.items[0]).toMatchObject({
      type: 'application.approved',
      organizationId: w.b.id,
    });
  });
});
