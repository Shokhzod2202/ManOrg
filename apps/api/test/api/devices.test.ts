import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { localDate } from '../../src/common/time';
import { PushService } from '../../src/devices/push.service';
import { Api, createTestApp } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/** Stand-in for Expo's push service. */
let pushes: { to: string; title: string; body: string; data: Record<string, unknown> }[][] = [];
let mode: 'ok' | 'down' | 'gone' = 'ok';
let fake: Server;
let app: INestApplication;
let api: Api;
let w: World;
let push: PushService;
const TOKEN = 'ExponentPushToken[test-phone-0001]';

beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const messages = JSON.parse(raw);
      pushes.push(messages);
      res.setHeader('content-type', 'application/json');
      if (mode === 'down') {
        res.statusCode = 503;
        res.end('{}');
        return;
      }
      res.end(
        JSON.stringify({
          data: messages.map(() =>
            mode === 'gone'
              ? {
                  status: 'error',
                  message: 'not registered',
                  details: { error: 'DeviceNotRegistered' },
                }
              : { status: 'ok', id: 'ticket' },
          ),
        }),
      );
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  await resetDatabase();
  app = await createTestApp({
    EXPO_PUSH_URL: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/push`,
  });
  api = new Api(app);
  w = await buildWorld(api);
  push = app.get(PushService);
});

afterAll(async () => {
  await app.close();
  await new Promise((r) => fake.close(r));
  await disconnectDatabases();
});

beforeEach(() => {
  pushes = [];
  mode = 'ok';
});

const assignTask = (title: string) =>
  api
    .as(w.a.admin, w.a.id)
    .post('/tasks')
    .send({ title, assigneeId: w.a.employee.userId, dueDate: localDate('Asia/Seoul') })
    .expect(201);

describe('phone app session', () => {
  it('gives the app its own session that refreshes on its own, audited', async () => {
    const res = await api.as(w.a.employee).post('/me/device-session').expect(201);
    expect(res.body.refreshToken).toEqual(expect.any(String));
    const refreshed = await api.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: res.body.refreshToken })
      .expect(200);
    expect(refreshed.body.tokens.accessToken).toEqual(expect.any(String));
    const audit = await asOwner({ organizationId: null, userId: w.a.employee.userId }, (tx) =>
      tx.auditLog.findMany({ where: { actorId: w.a.employee.userId, action: 'device.session' } }),
    );
    expect(audit).toHaveLength(1);
    await api.http.post('/api/v1/me/device-session').expect(401);
  });
});

describe('phone push (spec section 9)', () => {
  it('sends push-worthy notifications created after the phone registered, once', async () => {
    await api
      .as(w.a.employee)
      .post('/me/devices')
      .send({ token: TOKEN, platform: 'android' })
      .expect(204);
    await assignTask('Clean the mixer');
    expect(await push.sendPending()).toBe(1);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]![0]).toMatchObject({
      to: TOKEN,
      title: 'Alpha Bakery',
      body: expect.stringContaining('New task: Clean the mixer'),
    });
    expect(await push.sendPending()).toBe(0);
    // An in-app-only type (task completed goes to admins in-app) never pushes.
    expect(pushes).toHaveLength(1);
  });

  it('tries three times, then leaves it to the in-app inbox', async () => {
    mode = 'down';
    await assignTask('Check the oven');
    for (let i = 0; i < 4; i += 1) await push.sendPending();
    expect(pushes).toHaveLength(3);
    const row = await asOwner({ organizationId: null, userId: w.a.employee.userId }, (tx) =>
      tx.notification.findFirst({
        where: { userId: w.a.employee.userId, type: 'task.assigned' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(row).toMatchObject({ pushAttempts: 3, sentAt: expect.any(Date) });
    const inbox = await api.as(w.a.employee).get('/notifications').expect(200);
    expect(inbox.body.items.some((n: { id: string }) => n.id === row!.id)).toBe(true);
  });

  it('forgets a token the phone no longer has', async () => {
    mode = 'gone';
    await assignTask('Sweep the floor');
    await push.sendPending();
    const left = await asOwner({ organizationId: null, userId: w.a.employee.userId }, (tx) =>
      tx.deviceToken.count({ where: { token: TOKEN } }),
    );
    expect(left).toBe(0);
  });

  it('lets a person remove their own token only', async () => {
    await api
      .as(w.a.employee)
      .post('/me/devices')
      .send({ token: TOKEN, platform: 'ios' })
      .expect(204);
    await api.as(w.a.admin).post('/me/devices/remove').send({ token: TOKEN }).expect(204);
    const kept = await asOwner({ organizationId: null, userId: w.a.employee.userId }, (tx) =>
      tx.deviceToken.count({ where: { token: TOKEN } }),
    );
    expect(kept).toBe(1);
    await api.as(w.a.employee).post('/me/devices/remove').send({ token: TOKEN }).expect(204);
  });
});

describe('punch correction decided (spec section 9)', () => {
  it('tells the employee', async () => {
    const date = '2026-11-02';
    const req = await api
      .as(w.a.employee, w.a.id)
      .post('/punch-change-requests')
      .send({
        shiftDate: date,
        requestedStart: `${date}T06:00:00+09:00`,
        requestedEnd: `${date}T14:00:00+09:00`,
        reason: 'Forgot to punch',
      })
      .expect(201);
    await api
      .as(w.a.admin, w.a.id)
      .post(`/punch-change-requests/${req.body.id}/decision`)
      .send({ decision: 'approve' })
      .expect(200);
    const inbox = await api.as(w.a.employee).get('/notifications').expect(200);
    expect(inbox.body.items[0]).toMatchObject({
      type: 'punch.change_decided',
      payload: { decision: 'approve', shiftDate: date },
    });
  });
});
