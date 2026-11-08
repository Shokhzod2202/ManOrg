import { createHmac, randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../../src/config/env';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';

const BOT = '1000000000:TESTONLYTELEGRAMBOTTOKENVALUE00001';
const WEBHOOK_SECRET = 'telegram-webhook-test-secret';
const ADMIN_TELEGRAM_ID = 4200000001;
const OTHER_ADMIN_TELEGRAM_ID = 4200000002;
const EMPLOYEE_TELEGRAM_ID = 4200000003;
const PENDING_SAME_ORG_ID = 4200000004;
const PENDING_OTHER_ORG_ID = 4200000005;

process.env.TELEGRAM_BOT_TOKEN = BOT;
process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.TELEGRAM_BOOTSTRAP_ADMIN_IDS = [
  ADMIN_TELEGRAM_ID,
  OTHER_ADMIN_TELEGRAM_ID,
  PENDING_SAME_ORG_ID,
  PENDING_OTHER_ORG_ID,
].join(',');
process.env.TELEGRAM_BOOTSTRAP_ORG_NAME = 'Shohona Bakery';
process.env.TELEGRAM_BOOTSTRAP_TIMEZONE = 'Asia/Tashkent';
process.env.TELEGRAM_WEBAPP_URL = 'https://bakery.haydar.store';
process.env.TELEGRAM_API_BASE = 'http://127.0.0.1:9';

function signInitData(
  id: number,
  botToken = BOT,
  authDate = Math.floor(Date.now() / 1000),
): string {
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAE',
    user: JSON.stringify({ id, first_name: 'Ada', last_name: 'Lovelace', username: 'ada' }),
  };
  const keys = Object.keys(fields).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = keys.map((key) => `${key}=${fields[key]}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return [...keys, 'hash']
    .map((key) => `${key}=${encodeURIComponent(key === 'hash' ? hash : fields[key]!)}`)
    .join('&');
}

let app: INestApplication;
let api: Api;

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('Telegram Mini App sign-in', () => {
  it('is ready and has no demo accounts', async () => {
    await api.http.get('/api/v1/health/ready').expect(200);
    await api.http
      .post('/api/v1/auth/login')
      .send({ email: 'admin@sunrise.test', password: 'Password123!' })
      .expect(401);
  });

  it('rejects forged initData, a bare user id, and the wrong bot token', async () => {
    const signed = signInitData(EMPLOYEE_TELEGRAM_ID);
    const params = new URLSearchParams(signed);
    const user = JSON.parse(params.get('user') ?? '{}') as { id: number };
    user.id = ADMIN_TELEGRAM_ID;
    params.set('user', JSON.stringify(user));
    await api.http.post('/api/v1/auth/telegram').send({ initData: params.toString() }).expect(401);
    await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signed, telegramUserId: ADMIN_TELEGRAM_ID })
      .expect(400);
    await api.http
      .post('/api/v1/auth/telegram')
      .send({
        initData: signInitData(EMPLOYEE_TELEGRAM_ID, '999999:OTHERTOKENOTHERTOKENOTHERTOKEN'),
      })
      .expect(401);
    await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(EMPLOYEE_TELEGRAM_ID, BOT, 1_000) })
      .expect(401);
  });

  it('does not make an arbitrary Telegram user an admin', async () => {
    const res = await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(EMPLOYEE_TELEGRAM_ID) })
      .expect(200);
    expect(res.body.provisioning).toBe('not_bootstrap_admin');
    expect(res.body.user.email).toBeNull();
    expect(res.body.user.telegramUserId).toBe(String(EMPLOYEE_TELEGRAM_ID));
    const me = await api.http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${res.body.tokens.accessToken}`)
      .expect(200);
    expect(me.body.memberships).toEqual([]);
    expect(me.body.locale).toBe('en');
    const audit = await auditFor(res.body.user.id, {
      organizationId: null,
      userId: res.body.user.id,
    });
    expect(audit.map((entry) => entry.action)).toEqual(['user.telegram_register']);
    expect(JSON.stringify(audit)).not.toMatch(/password|initData|bot/i);
  });

  it('does not move a bootstrap id that already belongs to an organization', async () => {
    const existing = await api.register('Already Admin');
    await api.createOrganization(existing, 'Other Bakery');
    await asOwner({ organizationId: null, userId: existing.userId }, (tx) =>
      tx.user.update({
        where: { id: existing.userId },
        data: { telegramUserId: BigInt(OTHER_ADMIN_TELEGRAM_ID) },
      }),
    );
    const res = await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(OTHER_ADMIN_TELEGRAM_ID) })
      .expect(200);
    expect(res.body.provisioning).toBe('skipped_other_organization');
    expect(res.body.user.id).toBe(existing.userId);
    const me = await api.http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${res.body.tokens.accessToken}`)
      .expect(200);
    expect(
      me.body.memberships.map((m: { organization: { name: string } }) => m.organization.name),
    ).toEqual(['Other Bakery']);
  });

  it('creates the bakery once for a configured admin and does not restore a removed admin', async () => {
    const first = await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(ADMIN_TELEGRAM_ID) })
      .expect(200);
    expect(first.body.provisioning).toBe('created_organization');
    const me = await api.http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${first.body.tokens.accessToken}`)
      .expect(200);
    expect(me.body.memberships).toEqual([
      expect.objectContaining({
        role: 'admin',
        status: 'active',
        organization: expect.objectContaining({ name: 'Shohona Bakery', type: 'bakery' }),
      }),
    ]);
    const orgId = me.body.memberships[0].organization.id as string;
    const membershipId = me.body.memberships[0].id as string;

    const second = await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(ADMIN_TELEGRAM_ID) })
      .expect(200);
    expect(second.body.provisioning).toBe('already_member');
    expect(second.body.user.id).toBe(first.body.user.id);

    await asOwner({ organizationId: orgId, userId: first.body.user.id }, (tx) =>
      tx.membership.update({ where: { id: membershipId }, data: { status: 'removed' } }),
    );
    const afterRemoval = await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(ADMIN_TELEGRAM_ID) })
      .expect(200);
    expect(afterRemoval.body.provisioning).toBe('already_member');
    const rows = await asOwner({ organizationId: orgId, userId: first.body.user.id }, (tx) =>
      tx.membership.findMany({ where: { userId: first.body.user.id } }),
    );
    expect(rows.map((row) => row.status)).toEqual(['removed']);

    const employee = await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(EMPLOYEE_TELEGRAM_ID) })
      .expect(200);
    await api.http
      .post(`/api/v1/organizations/${orgId}/applications`)
      .set('Authorization', `Bearer ${employee.body.tokens.accessToken}`)
      .expect(201);
  });

  it('promotes a pending configured owner in Shohona Bakery and leaves other accounts alone', async () => {
    const admin = await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(ADMIN_TELEGRAM_ID) })
      .expect(200);
    const shohona = await asOwner({ organizationId: null, userId: admin.body.user.id }, (tx) =>
      tx.organization.findFirst({ where: { name: 'Shohona Bakery' }, select: { id: true } }),
    );
    expect(shohona).not.toBeNull();
    const shohonaId = shohona!.id;

    await asOwner({ organizationId: null, userId: admin.body.user.id }, (tx) =>
      tx.platformSetting.delete({ where: { key: 'telegram_bootstrap_org_id' } }),
    );
    const pendingOwnerId = randomUUID();
    await asOwner({ organizationId: shohonaId, userId: pendingOwnerId }, async (tx) => {
      await tx.user.create({
        data: {
          id: pendingOwnerId,
          name: 'Pending Owner',
          telegramUserId: BigInt(PENDING_SAME_ORG_ID),
        },
      });
      await tx.membership.create({
        data: {
          organizationId: shohonaId,
          userId: pendingOwnerId,
          role: 'employee',
          status: 'pending',
        },
      });
    });

    const promoted = await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(PENDING_SAME_ORG_ID) })
      .expect(200);
    expect(promoted.body.provisioning).toBe('promoted_admin');
    expect(promoted.body.user).toMatchObject({
      id: pendingOwnerId,
      telegramUserId: String(PENDING_SAME_ORG_ID),
    });
    const promotedMe = await api.http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${promoted.body.tokens.accessToken}`)
      .expect(200);
    expect(promotedMe.body.memberships).toEqual([
      expect.objectContaining({
        role: 'admin',
        status: 'active',
        organization: expect.objectContaining({ id: shohonaId, name: 'Shohona Bakery' }),
      }),
    ]);

    const again = await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(PENDING_SAME_ORG_ID) })
      .expect(200);
    expect(again.body.provisioning).toBe('already_member');
    const audits = await auditFor(promotedMe.body.memberships[0].id as string, {
      organizationId: shohonaId,
      userId: pendingOwnerId,
    });
    expect(audits.filter((entry) => entry.action === 'membership.bootstrap_admin')).toHaveLength(1);

    const email = await api.register('Shokhzod Haydar');
    await api.http
      .post(`/api/v1/organizations/${shohonaId}/applications`)
      .set('Authorization', `Bearer ${email.accessToken}`)
      .expect(201);
    const emailMe = await api.http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${email.accessToken}`)
      .expect(200);
    expect(emailMe.body.telegramUserId).toBeNull();
    expect(emailMe.body.email).toBe(email.email);
    expect(emailMe.body.memberships).toEqual([
      expect.objectContaining({
        role: 'employee',
        status: 'pending',
        organization: expect.objectContaining({ name: 'Shohona Bakery' }),
      }),
    ]);

    const otherOrg = await asOwner({ organizationId: null, userId: admin.body.user.id }, (tx) =>
      tx.organization.findFirst({ where: { name: 'Other Bakery' }, select: { id: true } }),
    );
    expect(otherOrg).not.toBeNull();
    const otherUserId = randomUUID();
    await asOwner({ organizationId: otherOrg!.id, userId: otherUserId }, async (tx) => {
      await tx.user.create({
        data: {
          id: otherUserId,
          name: 'Other Pending',
          telegramUserId: BigInt(PENDING_OTHER_ORG_ID),
        },
      });
      await tx.membership.create({
        data: {
          organizationId: otherOrg!.id,
          userId: otherUserId,
          role: 'employee',
          status: 'pending',
        },
      });
    });
    const skipped = await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(PENDING_OTHER_ORG_ID) })
      .expect(200);
    expect(skipped.body.provisioning).toBe('skipped_other_organization');
    const skippedMe = await api.http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${skipped.body.tokens.accessToken}`)
      .expect(200);
    expect(skippedMe.body.memberships).toEqual([
      expect.objectContaining({
        role: 'employee',
        status: 'pending',
        organization: expect.objectContaining({ id: otherOrg!.id, name: 'Other Bakery' }),
      }),
    ]);
  });

  it('lets a Telegram-only account set an email and password without a current password', async () => {
    const session = await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(EMPLOYEE_TELEGRAM_ID) })
      .expect(200);
    await api.http
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${session.body.tokens.accessToken}`)
      .send({ email: 'ada@bakery.test', password: 'unique-password-1' })
      .expect(200);
    await api.http
      .post('/api/v1/auth/login')
      .send({ email: 'ada@bakery.test', password: 'unique-password-1' })
      .expect(200);
  });
});

describe('POST /telegram/webhook', () => {
  it('requires the secret header and only replies for private messages', async () => {
    await api.http.post('/api/v1/telegram/webhook').send({ update_id: 1 }).expect(401);
    await api.http
      .post('/api/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'wrong-secret')
      .send({ message: { chat: { id: 1, type: 'private' }, text: '/start' } })
      .expect(401);
    const start = await api.http
      .post('/api/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', WEBHOOK_SECRET)
      .send({
        update_id: 2,
        message: { message_id: 3, chat: { id: 7, type: 'private' }, text: '/start' },
      })
      .expect(200);
    expect(start.body).toEqual({ ok: true, delivered: false });
    const group = await api.http
      .post('/api/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', WEBHOOK_SECRET)
      .send({ message: { chat: { id: 8, type: 'group' }, text: '/start' } })
      .expect(200);
    expect(group.body).toEqual({ ok: true, ignored: true });
    const callback = await api.http
      .post('/api/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', WEBHOOK_SECRET)
      .send({ callback_query: { id: '1', data: 'order' } })
      .expect(200);
    expect(callback.body).toEqual({ ok: true, ignored: true });
  });

  it('answers 503 when Telegram is not configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    resetEnvCache();
    await api.http
      .post('/api/v1/auth/telegram')
      .send({ initData: signInitData(EMPLOYEE_TELEGRAM_ID) })
      .expect(503);
    process.env.TELEGRAM_BOT_TOKEN = BOT;
    resetEnvCache();
  });
});
