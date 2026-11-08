import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';

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

describe('POST /auth/register (ACC-2)', () => {
  it('creates an account with no organization and signs it in', async () => {
    const res = await api.http
      .post('/api/v1/auth/register')
      .send({ name: ' Mina Park ', email: 'Mina@Example.com', password: 'Password123!' })
      .expect(201);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Mina Park',
      email: 'mina@example.com',
    });
    expect(res.body.tokens).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    const me = await api.http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${res.body.tokens.accessToken}`)
      .expect(200);
    expect(me.body.memberships).toEqual([]);
    const audit = await auditFor(res.body.user.id, {
      organizationId: null,
      userId: res.body.user.id,
    });
    expect(audit.map((a) => a.action)).toEqual(['user.register']);
    expect(JSON.stringify(audit)).not.toMatch(/password/i);
  });

  it('rejects a duplicate sign-in identifier, whatever its case', async () => {
    const res = await api.http
      .post('/api/v1/auth/register')
      .send({ name: 'Other', email: 'MINA@example.com', password: 'Password123!' })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates the body and names each bad field', async () => {
    const res = await api.http
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'nope', password: 'short', role: 'admin' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body.error.fields).sort()).toEqual([
      'email',
      'name',
      'password',
      'role',
    ]);
  });
});

describe('POST /auth/login', () => {
  it('signs in with the right password', async () => {
    const res = await api.http
      .post('/api/v1/auth/login')
      .send({ email: 'mina@example.com', password: 'Password123!' })
      .expect(200);
    expect(res.body.user.email).toBe('mina@example.com');
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await api.http
      .post('/api/v1/auth/login')
      .send({ email: 'mina@example.com', password: 'Wrong-password' })
      .expect(401);
    const unknown = await api.http
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'Wrong-password' })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and refuses the old one', async () => {
    const session = await api.register('Rotator');
    const first = await api.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    expect(first.body.tokens.refreshToken).not.toBe(session.refreshToken);
    await api.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });

  it('revokes the whole family when a used token is presented again', async () => {
    const session = await api.register('Victim');
    const next = await api.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    // An attacker replays the stolen first token...
    await api.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
    // ...so the legitimate newer token stops working too.
    await api.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: next.body.tokens.refreshToken })
      .expect(401);
  });

  it('refuses an unknown token', async () => {
    await api.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'not-a-real-refresh-token' })
      .expect(401);
  });
});

describe('access tokens', () => {
  it('protects every non-public route', async () => {
    const res = await api.http.get('/api/v1/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    await api.http.get('/api/v1/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
  });

  it('does not accept a refresh token as an access token', async () => {
    const session = await api.register('Mixer');
    await api.http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${session.refreshToken}`)
      .expect(401);
  });

  it('leaves /health public', async () => {
    await api.http.get('/api/v1/health').expect(200, { status: 'ok' });
  });
});

describe('sign-in rate limit (spec section 12)', () => {
  it('answers 429 after the configured number of attempts per minute', async () => {
    const limited = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const http = request(limited.getHttpServer());
      for (let i = 0; i < 3; i += 1) {
        await http
          .post('/api/v1/auth/login')
          .send({ email: 'x@example.com', password: 'nope' })
          .expect(401);
      }
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email: 'x@example.com', password: 'nope' })
        .expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
