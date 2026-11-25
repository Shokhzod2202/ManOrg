import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService } from '../../src/mail/mail.service';
import { Api, auditFor, createTestApp, type Session } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';

/** Decided 2026-11-29: "Forgot password" with an emailed one-time link. */
let app: INestApplication;
let api: Api;
let person: Session;
const login = (email: string, password: string) =>
  api.http.post('/api/v1/auth/login').send({ email, password });
const lastLink = () => {
  const mail = app.get(MailService).outbox.at(-1)!;
  const token = /reset-password\?token=([\w-]+)/.exec(mail.text)?.[1];
  return { mail, token: token! };
};

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  person = await api.register('Forgetful Baker');
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('forgot password', () => {
  it('answers the same for an unknown email and sends nothing', async () => {
    const before = app.get(MailService).outbox.length;
    const res = await api.http
      .post('/api/v1/auth/password-reset')
      .send({ email: 'nobody-here@test.local' })
      .expect(202);
    expect(res.body).toEqual({ sent: true });
    expect(app.get(MailService).outbox.length).toBe(before);
  });

  it('emails a link; the new password works, the old one and every session stop', async () => {
    await api.http.post('/api/v1/auth/password-reset').send({ email: person.email }).expect(202);
    const { mail, token } = lastLink();
    expect(mail.to).toBe(person.email);
    expect(mail.text).toContain('/reset-password?token=');
    // Only the hash is stored.
    const stored = await asOwner({ organizationId: null, userId: person.userId }, (tx) =>
      tx.passwordReset.findMany({ where: { userId: person.userId } }),
    );
    expect(JSON.stringify(stored)).not.toContain(token);
    await api.http
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, password: 'Brand-new-pass-1' })
      .expect(204);
    await login(person.email, 'Brand-new-pass-1').expect(200);
    await login(person.email, 'Password123!').expect(401);
    await api.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: person.refreshToken })
      .expect(401);
    // The person is told by email, and it is audited.
    expect(app.get(MailService).outbox.at(-1)!.subject).toContain('changed');
    const audit = await auditFor(person.userId, { organizationId: null, userId: person.userId });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['user.password_reset_requested', 'user.password_reset']),
    );
    // The link works once.
    const again = await api.http
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, password: 'Another-pass-22' })
      .expect(400);
    expect(again.body.error.code).toBe('RESET_LINK_INVALID');
  });

  it('a newer link replaces an older one, and an expired link is refused', async () => {
    await api.http.post('/api/v1/auth/password-reset').send({ email: person.email }).expect(202);
    const first = lastLink().token;
    await api.http.post('/api/v1/auth/password-reset').send({ email: person.email }).expect(202);
    const second = lastLink().token;
    await api.http
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token: first, password: 'Brand-new-pass-2' })
      .expect(400);
    await asOwner({ organizationId: null, userId: person.userId }, (tx) =>
      tx.passwordReset.updateMany({
        where: { userId: person.userId, usedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );
    await api.http
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token: second, password: 'Brand-new-pass-2' })
      .expect(400);
    // A short password is refused before the link is used.
    await api.http
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token: second, password: 'short' })
      .expect(400);
  });

  it('writes the email in the person’s language', async () => {
    const ko = await api.register('Korean Baker');
    await api.as(ko).patch('/me').send({ locale: 'ko' }).expect(200);
    await api.http.post('/api/v1/auth/password-reset').send({ email: ko.email }).expect(202);
    expect(lastLink().mail.subject).toBe('Haydar Systems 비밀번호 재설정');
  });
});
