import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { localDate } from '../../src/common/time';
import { TelegramService } from '../../src/telegram/telegram.service';
import { Api, createTestApp, type Session } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';

/** Account-level audit rows written by this person. */
const auditOf = (userId: string) =>
  asOwner({ organizationId: null, userId }, (tx) =>
    tx.auditLog.findMany({ where: { actorId: userId, entity: 'telegram_link' } }),
  );

const SECRET = 'webhook-secret-for-tests-0001';
const TOKEN = '123456:test-token';

/** Stand-in for api.telegram.org: records calls and answers like the Bot API. */
interface Call {
  method: string;
  token: string;
  body: Record<string, unknown>;
}
let calls: Call[] = [];
let failWith: { status: number; description: string } | null = null;
let fake: Server;

let app: INestApplication;
let api: Api;
let telegram: TelegramService;
let admin: Session;
let employee: Session;
let orgId: string;
let chat = 9000;

beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const [, token, method] = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '') ?? [];
      calls.push({ method: method ?? '', token: token ?? '', body: raw ? JSON.parse(raw) : {} });
      res.setHeader('content-type', 'application/json');
      if (failWith) {
        res.statusCode = failWith.status;
        res.end(
          JSON.stringify({
            ok: false,
            error_code: failWith.status,
            description: failWith.description,
          }),
        );
        return;
      }
      res.end(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  const port = (fake.address() as AddressInfo).port;

  await resetDatabase();
  app = await createTestApp({
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_API_URL: `http://127.0.0.1:${port}`,
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    WEB_APP_URL: 'https://app.example.com',
  });
  api = new Api(app);
  telegram = app.get(TelegramService);
  admin = await api.register('Tg Admin');
  orgId = await api.createOrganization(admin, 'Tg Bakery');
  employee = await api.hireEmployee(orgId, admin, 'Tg Worker');
});

afterAll(async () => {
  await app.close();
  await new Promise((r) => fake.close(r));
  await disconnectDatabases();
});

beforeEach(() => {
  calls = [];
  failWith = null;
});

const sent = () => calls.filter((c) => c.method === 'sendMessage');

function webhook(text: string, chatId: number, secret = SECRET) {
  return api.http
    .post('/api/v1/telegram/webhook')
    .set('X-Telegram-Bot-Api-Secret-Token', secret)
    .send({
      update_id: 1,
      message: { text, chat: { id: chatId, type: 'private' }, from: { username: 'worker' } },
    });
}

async function connect(session: Session): Promise<number> {
  chat += 1;
  const link = await api.as(session).post('/me/telegram/link').expect(201);
  const code = new URL(link.body.url).searchParams.get('start');
  await webhook(`/start ${code}`, chat).expect(200);
  return chat;
}

describe('Telegram notifications (decided 2026-11-13)', () => {
  it('gives a one-time start link for the bot', async () => {
    const status = await api.as(employee).get('/me/telegram').expect(200);
    expect(status.body).toMatchObject({
      available: true,
      connected: false,
      botUsername: 'haydar_inc_bot',
    });
    const link = await api.as(employee).post('/me/telegram/link').expect(201);
    expect(link.body.url).toMatch(/^https:\/\/t\.me\/haydar_inc_bot\?start=[\w-]{20,64}$/);
  });

  it('refuses webhook calls without the secret', async () => {
    await webhook('/start x', 1, 'wrong-secret-wrong-secret-00').expect(401);
    await api.http.post('/api/v1/telegram/webhook').send({ update_id: 1 }).expect(401);
  });

  it('connects the chat with /start <code>, once, and audits it', async () => {
    const link = await api.as(employee).post('/me/telegram/link').expect(201);
    const code = new URL(link.body.url).searchParams.get('start');
    await webhook(`/start ${code}`, 4242).expect(200);
    expect(sent().at(-1)?.body).toMatchObject({ chat_id: '4242' });
    expect(String(sent().at(-1)?.body.text)).toContain('Connected to Haydar as <b>Tg Worker</b>');
    expect(calls.every((c) => c.token === TOKEN)).toBe(true);

    const status = await api.as(employee).get('/me/telegram').expect(200);
    expect(status.body).toMatchObject({ connected: true, username: 'worker' });
    const audit = await auditOf(employee.userId);
    expect(audit.some((a) => a.action === 'telegram.connect')).toBe(true);

    // The same code cannot connect another chat.
    await webhook(`/start ${code}`, 5555).expect(200);
    expect(String(sent().at(-1)?.body.text)).toContain('expired');
    const again = await api.as(employee).get('/me/telegram').expect(200);
    expect(again.body.connected).toBe(true);
  });

  it('sends each person only their own notifications, once, with the organization name', async () => {
    const chatId = await connect(employee);
    calls = [];
    await api
      .as(admin, orgId)
      .post('/tasks')
      .send({
        title: 'Wipe <the> ovens',
        assigneeId: employee.userId,
        dueDate: localDate('Asia/Seoul'),
      })
      .expect(201);
    expect(await telegram.sendPending()).toBe(1);
    const msg = sent()[0]!;
    expect(msg.body.chat_id).toBe(String(chatId));
    expect(msg.body.text).toContain('<b>Tg Bakery</b>');
    expect(msg.body.text).toContain('New task: <b>Wipe &lt;the&gt; ovens</b>');
    expect(msg.body.reply_markup).toMatchObject({
      inline_keyboard: [[{ url: 'https://app.example.com/app/tasks' }]],
    });
    // Nothing twice, and nothing addressed to the (unconnected) admin.
    expect(await telegram.sendPending()).toBe(0);
    expect(sent().every((c) => c.body.chat_id === String(chatId))).toBe(true);
  });

  it('forgets the chat when the person blocks the bot', async () => {
    await connect(employee);
    await api
      .as(admin, orgId)
      .post('/tasks')
      .send({
        title: 'Blocked task',
        assigneeId: employee.userId,
        dueDate: localDate('Asia/Seoul'),
      })
      .expect(201);
    failWith = { status: 403, description: 'Forbidden: bot was blocked by the user' };
    expect(await telegram.sendPending()).toBe(0);
    const status = await api.as(employee).get('/me/telegram').expect(200);
    expect(status.body.connected).toBe(false);
  });

  it('stops with /stop and with Disconnect in Settings', async () => {
    const chatId = await connect(employee);
    await webhook('/stop', chatId).expect(200);
    expect((await api.as(employee).get('/me/telegram').expect(200)).body.connected).toBe(false);

    await connect(employee);
    await api.as(employee).delete('/me/telegram').expect(204);
    await api.as(employee).delete('/me/telegram').expect(404);
    const audit = await auditOf(employee.userId);
    expect(audit.filter((a) => a.action === 'telegram.disconnect').length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('answers anything else with help and ignores group chats', async () => {
    await webhook('hello', 777).expect(200);
    expect(String(sent().at(-1)?.body.text)).toContain('Connect Telegram');
    calls = [];
    await api.http
      .post('/api/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send({ update_id: 2, message: { text: '/stop', chat: { id: -100, type: 'group' } } })
      .expect(200);
    expect(sent()).toHaveLength(0);
  });
});

describe('Telegram without a bot token', () => {
  it('reports it as unavailable', async () => {
    const plain = await createTestApp({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_WEBHOOK_SECRET: SECRET });
    const p = new Api(plain);
    const user = await p.register('No Tg');
    expect((await p.as(user).get('/me/telegram').expect(200)).body.available).toBe(false);
    const res = await p.as(user).post('/me/telegram/link').expect(503);
    expect(res.body.error.code).toBe('TELEGRAM_NOT_CONFIGURED');
    await p.http
      .post('/api/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send({ update_id: 1 })
      .expect(404);
    await plain.close();
  });
});
