import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '../../src/common/time';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/**
 * Decided 2026-11-28: private wall-screen links. Anyone with a link sees the orders due next
 * without an account; deleting a link stops it at once and leaves the others working.
 */
let app: INestApplication;
let api: Api;
let w: World;
const admin = () => api.as(w.a.admin, w.a.id);
const open = (path: string) =>
  request(app.getHttpServer()).get(`/api/v1/public/wall/${path.replace('/screen/', '')}`);

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  await api
    .as(w.contractor.admin, w.contractor.id)
    .post('/orders')
    .send({
      providerId: w.a.id,
      deliveryDate: addDays(localDate('Asia/Seoul'), 1),
      lines: [{ productId: w.a.productId, quantity: 25 }],
    })
    .expect(201);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('wall-screen links', () => {
  let kitchen: { id: string; path: string };
  let front: { id: string; path: string };

  it('are made by admins; the link opens the board without an account', async () => {
    kitchen = (await admin().post('/wall-links').send({ name: 'Kitchen TV' }).expect(201)).body;
    front = (await admin().post('/wall-links').send({ name: 'Front desk' }).expect(201)).body;
    expect(kitchen.path).toMatch(new RegExp(`^/screen/${w.a.id}/[A-Za-z0-9_-]{30,}$`));
    const screen = await open(kitchen.path).expect(200);
    expect(screen.body).toMatchObject({
      organization: { name: expect.any(String) },
      link: { name: 'Kitchen TV' },
      totals: [expect.objectContaining({ productName: 'Alpha Bread', quantity: 25 })],
    });
    // No money and no people on a shared screen.
    expect(JSON.stringify(screen.body)).not.toMatch(/amount|unitPrice|employee|byEmployee/);
    const list = await admin().get('/wall-links').expect(200);
    expect(list.body.items.map((l: { name: string }) => l.name)).toEqual([
      'Kitchen TV',
      'Front desk',
    ]);
    expect(list.body.items[0].lastSeenAt).toEqual(expect.any(String));
    expect(JSON.stringify(list.body)).not.toContain(kitchen.path.split('/').at(-1));
  });

  it('answers 404 for a wrong secret or another organization', async () => {
    const secret = kitchen.path.split('/').at(-1)!;
    await open(`/screen/${w.a.id}/${'x'.repeat(32)}`).expect(404);
    await open(`/screen/${w.b.id}/${secret}`).expect(404);
    await open(`/screen/not-a-uuid/${secret}`).expect(404);
  });

  it('stops a deleted link at once and keeps the others working, audited', async () => {
    await admin().delete(`/wall-links/${kitchen.id}`).expect(204);
    await open(kitchen.path).expect(404);
    await open(front.path).expect(200);
    await admin().delete(`/wall-links/${kitchen.id}`).expect(404);
    const fresh = (await admin().post('/wall-links').send({ name: 'Kitchen TV 2' }).expect(201))
      .body;
    await open(fresh.path).expect(200);
    const audit = await auditFor(kitchen.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual(['wall_link.create', 'wall_link.delete']);
  });

  it('is for admins of the organization only', async () => {
    await api.as(w.a.employee, w.a.id).post('/wall-links').send({ name: 'x' }).expect(403);
    await api.as(w.a.employee, w.a.id).get('/wall-links').expect(403);
    await api.as(w.b.admin, w.b.id).delete(`/wall-links/${front.id}`).expect(404);
    await open(front.path).expect(200);
  });
});
