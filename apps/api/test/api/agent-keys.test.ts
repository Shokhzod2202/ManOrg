import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp, type Session } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/**
 * Decided 2026-11-29: API keys the owner gives outside bots. A key works in one organization as
 * the bot; read keys only read, write keys also add and change, nothing is deleted, and every
 * change is audited with the key as actor on behalf of the owner.
 */
let app: INestApplication;
let api: Api;
let w: World;
let second: Session;
const owner = () => api.as(w.a.admin, w.a.id);
const withKey = (key: string) => {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${key}`);
  const http = request(app.getHttpServer());
  return {
    get: (url: string) => auth(http.get(`/api/v1${url}`)),
    post: (url: string) => auth(http.post(`/api/v1${url}`)),
    patch: (url: string) => auth(http.patch(`/api/v1${url}`)),
    put: (url: string) => auth(http.put(`/api/v1${url}`)),
    delete: (url: string) => auth(http.delete(`/api/v1${url}`)),
  };
};

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  second = await api.hireEmployee(w.a.id, w.a.admin, 'Second Admin');
  const members = await owner().get('/members').expect(200);
  const m = members.body.items.find((x: { user: { id: string } }) => x.user.id === second.userId);
  await owner()
    .patch(`/members/${m.id}`)
    .set('If-Match', String(m.version))
    .send({ role: 'admin' })
    .expect(200);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('API keys for outside bots', () => {
  let reader: { id: string; key: string };
  let writer: { id: string; key: string };

  it('are made by the owner only; the key is shown once', async () => {
    reader = (
      await owner().post('/agent-keys').send({ name: 'Grok reader', access: 'read' }).expect(201)
    ).body;
    writer = (
      await owner().post('/agent-keys').send({ name: 'Grok agent', access: 'write' }).expect(201)
    ).body;
    expect(reader.key).toMatch(new RegExp(`^mok_${w.a.id.replace(/-/g, '')}_[A-Za-z0-9_-]{40,}$`));
    const list = await owner().get('/agent-keys').expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(JSON.stringify(list.body)).not.toContain(reader.key);
    expect(list.body.items[0]).toMatchObject({
      name: 'Grok reader',
      access: 'read',
      hint: reader.key.slice(-4),
    });
    // Another admin, an employee and a contractor cannot make or see keys.
    await api
      .as(second, w.a.id)
      .post('/agent-keys')
      .send({ name: 'x', access: 'read' })
      .expect(403);
    await api.as(second, w.a.id).get('/agent-keys').expect(403);
    await api.as(w.a.employee, w.a.id).get('/agent-keys').expect(403);
    await api
      .as(w.contractor.admin, w.contractor.id)
      .post('/agent-keys')
      .send({ name: 'x', access: 'read' })
      .expect(403);
    await owner().post('/agent-keys').send({ name: '', access: 'all' }).expect(400);
    const audit = await auditFor(reader.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual(['agent_key.create']);
  });

  it('read without the organization header; read keys cannot change anything', async () => {
    const me = await withKey(reader.key).get('/agent/whoami').expect(200);
    expect(me.body).toMatchObject({
      organization: { id: w.a.id },
      key: { name: 'Grok reader', access: 'read' },
      openapi: '/api/v1/openapi.yaml',
    });
    const products = await withKey(reader.key).get('/products').expect(200);
    expect(products.body.items.map((p: { id: string }) => p.id)).toContain(w.a.productId);
    await withKey(reader.key).get('/orders/due-next').expect(200);
    const res = await withKey(reader.key)
      .post('/ingredients')
      .send({ name: 'Salt', source: 'Shop', packQuantity: 1, packUnit: 'kg', packPrice: 1000 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AGENT_READ_ONLY');
  });

  it('write keys add and change, audited as the bot on behalf of the owner', async () => {
    const made = await withKey(writer.key)
      .post('/ingredients')
      .send({ name: 'Sesame', source: 'Market', packQuantity: 5, packUnit: 'kg', packPrice: 25000 })
      .expect(201);
    const audit = await auditFor(made.body.id, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    expect(audit[0]).toMatchObject({
      actorType: 'bot',
      actorId: writer.id,
      onBehalfOf: w.a.admin.userId,
    });
  });

  it('never delete, never sign in or change accounts, never manage keys or the bot', async () => {
    const del = await withKey(writer.key).delete(`/agent-keys/${reader.id}`);
    expect(del.status).toBe(403);
    expect(del.body.error.code).toBe('AGENT_NO_DELETE');
    const account = await withKey(writer.key).get('/me');
    expect(account.status).toBe(403);
    expect(account.body.error.code).toBe('AGENT_ROUTE_NOT_ALLOWED');
    await withKey(writer.key)
      .post('/agent-keys')
      .send({ name: 'more', access: 'write' })
      .expect(403);
    await withKey(writer.key).get('/agent-keys').expect(403);
    // Owner-only data stays hidden, as for the in-app bot.
    await withKey(writer.key).get('/hourly-rates').expect(403);
  });

  it('work only in their own organization', async () => {
    const other = await withKey(writer.key).get('/products').set('X-Organization-Id', w.b.id);
    expect(other.status).toBe(404);
    // A key for one organization with another organization's id written in it is refused.
    const forged = writer.key.replace(w.a.id.replace(/-/g, ''), w.b.id.replace(/-/g, ''));
    await withKey(forged).get('/products').expect(401);
    await withKey('mok_nonsense').get('/products').expect(401);
  });

  it('stop at once when deleted; other keys keep working', async () => {
    await owner().delete(`/agent-keys/${reader.id}`).expect(204);
    await withKey(reader.key).get('/products').expect(401);
    await withKey(writer.key).get('/products').expect(200);
    const audit = await auditFor(reader.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual(['agent_key.create', 'agent_key.delete']);
    const list = await owner().get('/agent-keys').expect(200);
    expect(list.body.items.map((k: { name: string }) => k.name)).toEqual(['Grok agent']);
    expect(list.body.items[0].lastUsedAt).not.toBeNull();
  });

  it('serves the API description publicly', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/openapi.yaml').expect(200);
    expect(res.text).toContain('openapi:');
    expect(res.text).toContain('/agent-keys');
  });
});
