import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDate, localTime, weekdayIn } from '../../src/common/time';
import { jpegWithExifDate } from '../../src/storage/exif';
import { IngredientOrdersService } from '../../src/tasks/ingredient-orders.service';
import { Api, auditFor, createTestApp, PNG } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;
const TZ = 'Asia/Seoul';

/** EXIF time "YYYY:MM:DD HH:MM:SS" for minutes ago, in Seoul local time. */
function exifAgo(minutes: number): string {
  const at = new Date(Date.now() - minutes * 60_000);
  return `${localDate(TZ, at).replaceAll('-', ':')} ${localTime(TZ, at)}:00`;
}

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

async function newTask(title = 'Clean the ovens') {
  const res = await api
    .as(w.a.admin, w.a.id)
    .post('/tasks')
    .send({ title, assigneeId: w.a.employee.userId, dueDate: localDate(TZ) })
    .expect(201);
  return res.body.id as string;
}

describe('tasks (TSK-1)', () => {
  it('creates a task, notifies the assignee and audits it', async () => {
    const id = await newTask();
    const task = await api.as(w.a.employee, w.a.id).get(`/tasks/${id}`).expect(200);
    expect(task.body).toMatchObject({
      title: 'Clean the ovens',
      assignee: { id: w.a.employee.userId },
      status: 'open',
      photos: [],
    });
    const inbox = await api.as(w.a.employee).get('/notifications?unread=true').expect(200);
    expect(inbox.body.items[0]).toMatchObject({
      type: 'task.assigned',
      payload: expect.objectContaining({ taskId: id }),
    });
    await api.as(w.a.employee).post(`/notifications/${inbox.body.items[0].id}/read`).expect(204);
    const after = await api.as(w.a.employee).get('/notifications?unread=true').expect(200);
    expect(after.body.items.map((n: { id: string }) => n.id)).not.toContain(inbox.body.items[0].id);
    const audit = await auditFor(id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual(['task.create']);
  });

  it('is created by admins only; employees see only their own tasks', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .post('/tasks')
      .send({ title: 'x', assigneeId: w.a.employee.userId, dueDate: '2026-12-01' })
      .expect(403);
    const other = await api
      .as(w.a.admin, w.a.id)
      .post('/tasks')
      .send({ title: 'Admin job', assigneeId: w.a.admin.userId, dueDate: '2026-12-01' })
      .expect(201);
    const mine = await api.as(w.a.employee, w.a.id).get('/tasks').expect(200);
    expect(mine.body.items.map((t: { id: string }) => t.id)).not.toContain(other.body.id);
    await api.as(w.a.employee, w.a.id).get(`/tasks/${other.body.id}`).expect(404);
  });

  it('refuses an assignee from another organization', async () => {
    await api
      .as(w.a.admin, w.a.id)
      .post('/tasks')
      .send({ title: 'x', assigneeId: w.b.employee.userId, dueDate: '2026-12-01' })
      .expect(400);
  });
});

describe('completing a task with a camera photo (TSK-2, TSK-3)', () => {
  it('cannot be done without a photo', async () => {
    const id = await newTask();
    const res = await api
      .as(w.a.employee, w.a.id)
      .post(`/tasks/${id}/complete`)
      .field('captureToken', 'x'.repeat(20))
      .expect(400);
    expect(res.body.error.fields).toHaveProperty('photo');
  });

  it('refuses a photo without a fresh capture token (gallery upload)', async () => {
    const id = await newTask();
    const res = await api
      .as(w.a.employee, w.a.id)
      .post(`/tasks/${id}/complete`)
      .field('captureToken', 'made-up-token-123456')
      .attach('photo', PNG, 'gallery.png')
      .expect(422);
    expect(res.body.error.code).toBe('CAMERA_REQUIRED');
  });

  it('refuses a photo whose camera time is old, even with a token', async () => {
    const id = await newTask();
    const token = await api.as(w.a.employee, w.a.id).post(`/tasks/${id}/capture-token`).expect(201);
    const res = await api
      .as(w.a.employee, w.a.id)
      .post(`/tasks/${id}/complete`)
      .field('captureToken', token.body.captureToken)
      .attach('photo', jpegWithExifDate(exifAgo(60 * 24)), 'old.jpg')
      .expect(422);
    expect(res.body.error.code).toBe('CAMERA_REQUIRED');
  });

  it('completes with a fresh camera photo; the admin sees photo, time and person', async () => {
    const id = await newTask('Wipe the counters');
    const token = await api.as(w.a.employee, w.a.id).post(`/tasks/${id}/capture-token`).expect(201);
    const res = await api
      .as(w.a.employee, w.a.id)
      .post(`/tasks/${id}/complete`)
      .field('captureToken', token.body.captureToken)
      .attach('photo', jpegWithExifDate(exifAgo(1)), 'camera.jpg')
      .expect(200);
    expect(res.body).toMatchObject({ status: 'done', completedBy: { id: w.a.employee.userId } });
    const admin = await api.as(w.a.admin, w.a.id).get(`/tasks/${id}`).expect(200);
    expect(admin.body.photos).toHaveLength(1);
    expect(admin.body.photos[0].url).toContain('/api/v1/files/');
    expect(Math.abs(new Date(admin.body.completedAt).getTime() - Date.now())).toBeLessThan(10_000);
    // The token works once.
    await api
      .as(w.a.employee, w.a.id)
      .post(`/tasks/${id}/complete`)
      .field('captureToken', token.body.captureToken)
      .attach('photo', jpegWithExifDate(exifAgo(1)), 'again.jpg')
      .expect(409);
    const inbox = await api.as(w.a.admin).get('/notifications?unread=true').expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain('task.completed');
  });

  it('refuses files that are not photos', async () => {
    const id = await newTask();
    const token = await api.as(w.a.employee, w.a.id).post(`/tasks/${id}/capture-token`).expect(201);
    await api
      .as(w.a.employee, w.a.id)
      .post(`/tasks/${id}/complete`)
      .field('captureToken', token.body.captureToken)
      .attach('photo', Buffer.from('%PDF-1.7'), 'doc.pdf')
      .expect(400);
  });

  it('is only for the assignee', async () => {
    const id = await newTask();
    await api.as(w.a.admin, w.a.id).post(`/tasks/${id}/capture-token`).expect(403);
    await api.as(w.b.employee, w.b.id).post(`/tasks/${id}/capture-token`).expect(404);
  });
});

describe('ingredient orders (ING-5 to ING-7)', () => {
  it('turns an employee order into an admin task, then fulfils and checks it', async () => {
    const created = await api
      .as(w.a.employee, w.a.id)
      .post('/ingredient-orders')
      .send({ ingredientId: w.a.ingredientId, quantity: 2, note: 'Running low' })
      .expect(201);
    expect(created.body).toMatchObject({
      quantity: 2,
      status: 'requested',
      note: 'Running low',
      requestedBy: { id: w.a.employee.userId },
    });
    expect(created.body).not.toHaveProperty('packPrice');

    const tasks = await api.as(w.a.admin, w.a.id).get('/tasks?type=ingredient_order').expect(200);
    const task = tasks.body.items.find((t: { id: string }) => t.id === created.body.taskId);
    expect(task).toMatchObject({
      title: 'Order 2 packs of Alpha Flour',
      assignee: null,
      ingredientOrderId: created.body.id,
    });

    const adminView = await api
      .as(w.a.admin, w.a.id)
      .get('/ingredient-orders?status=requested')
      .expect(200);
    expect(adminView.body.items[0]).toMatchObject({ id: created.body.id, packPrice: 30_000 });

    await api
      .as(w.a.employee, w.a.id)
      .post(`/ingredient-orders/${created.body.id}/fulfil`)
      .expect(403);
    await api.as(w.a.admin, w.a.id).post(`/ingredient-orders/${created.body.id}/check`).expect(409);
    const fulfilled = await api
      .as(w.a.admin, w.a.id)
      .post(`/ingredient-orders/${created.body.id}/fulfil`)
      .expect(200);
    expect(fulfilled.body).toMatchObject({
      status: 'fulfilled',
      fulfilledBy: { id: w.a.admin.userId },
    });
    const checked = await api
      .as(w.a.admin, w.a.id)
      .post(`/ingredient-orders/${created.body.id}/check`)
      .expect(200);
    expect(checked.body).toMatchObject({ status: 'checked', checkedBy: { id: w.a.admin.userId } });
    const closed = await api.as(w.a.admin, w.a.id).get(`/tasks/${created.body.taskId}`).expect(200);
    expect(closed.body.status).toBe('done');

    const audit = await auditFor(created.body.id, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    expect(audit.map((a) => a.action)).toEqual([
      'ingredient_order.create',
      'ingredient_order.fulfil',
      'ingredient_order.check',
    ]);
    const inbox = await api.as(w.a.employee).get('/notifications?unread=true').expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain('ingredient.fulfilled');
  });

  it('keeps the price in force when ordered, even after the price changes', async () => {
    const order = await api
      .as(w.a.employee, w.a.id)
      .post('/ingredient-orders')
      .send({ ingredientId: w.a.ingredientId, quantity: 1 })
      .expect(201);
    await api
      .as(w.a.admin, w.a.id)
      .put(`/ingredients/${w.a.ingredientId}/price`)
      .send({ packPrice: 45_000 })
      .expect(200);
    const list = await api.as(w.a.admin, w.a.id).get('/ingredient-orders').expect(200);
    expect(list.body.items.find((o: { id: string }) => o.id === order.body.id)).toMatchObject({
      packPrice: 30_000,
    });
  });

  it('shows employees only their own orders and refuses other organizations’ ingredients', async () => {
    const mine = await api.as(w.a.employee, w.a.id).get('/ingredient-orders').expect(200);
    expect(
      mine.body.items.every(
        (o: { requestedBy: { id: string } }) => o.requestedBy.id === w.a.employee.userId,
      ),
    ).toBe(true);
    await api
      .as(w.a.employee, w.a.id)
      .post('/ingredient-orders')
      .send({ ingredientId: w.b.ingredientId, quantity: 1 })
      .expect(400);
  });

  it('reminds responsible employees once on the ingredient’s ordering day (ING-7)', async () => {
    const now = new Date();
    const res = await api
      .as(w.b.admin, w.b.id)
      .post('/ingredients')
      .send({
        name: 'Butter',
        source: 'Dairy',
        packQuantity: 1,
        packUnit: 'kg',
        orderSchedule: { weekday: weekdayIn(TZ, now), time: '00:00' },
      })
      .expect(201);
    await api
      .as(w.b.admin, w.b.id)
      .put(`/ingredients/${res.body.id}/responsible`)
      .send({ employeeIds: [w.b.employee.userId] })
      .expect(200);
    const jobs = app.get(IngredientOrdersService);
    expect(await jobs.sendDueReminders(now)).toBeGreaterThanOrEqual(1);
    await jobs.sendDueReminders(now);
    const inbox = await api.as(w.b.employee).get('/notifications').expect(200);
    const due = inbox.body.items.filter(
      (n: { type: string; payload: { ingredientId: string } }) =>
        n.type === 'ingredient.due' && n.payload.ingredientId === res.body.id,
    );
    expect(due).toHaveLength(1);
  });
});
