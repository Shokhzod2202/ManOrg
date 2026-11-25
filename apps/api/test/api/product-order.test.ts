import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/** Decided 2026-11-30: product types, the custom order, and each person's sort choice. */
let app: INestApplication;
let api: Api;
let w: World;
const admin = () => api.as(w.a.admin, w.a.id);
const names = async () =>
  (await admin().get('/products').expect(200)).body.items.map((p: { name: string }) => p.name);
const product = async (name: string, typeId?: string) =>
  (
    await admin()
      .post('/products')
      .send({ name, minutesPer10: 5, unitPrice: 1000, ...(typeId ? { typeId } : {}) })
      .expect(201)
  ).body as { id: string; version: number; type: { id: string; name: string } | null };

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

describe('product types', () => {
  it('are made while adding products, once per name, and only used inside their organization', async () => {
    const meal = (await admin().post('/product-types').send({ name: 'Meal' }).expect(201)).body;
    const again = (await admin().post('/product-types').send({ name: 'meal' }).expect(201)).body;
    expect(again.id).toBe(meal.id);
    const bakery = (await admin().post('/product-types').send({ name: 'Bakery' }).expect(201)).body;
    const osh = await product('Osh', meal.id);
    expect(osh.type).toEqual({ id: meal.id, name: 'Meal' });
    // Edited to another type, or none.
    const edited = await admin()
      .patch(`/products/${osh.id}`)
      .set('If-Match', String(osh.version))
      .send({ typeId: bakery.id })
      .expect(200);
    expect(edited.body.type.name).toBe('Bakery');
    const list = await admin().get('/product-types').expect(200);
    expect(list.body.items.map((t: { name: string }) => t.name)).toEqual(['Bakery', 'Meal']);
    // Another organization's type is refused; employees cannot add types.
    const other = (
      await api.as(w.b.admin, w.b.id).post('/product-types').send({ name: 'Drinks' }).expect(201)
    ).body;
    await admin()
      .post('/products')
      .send({ name: 'X', minutesPer10: 5, typeId: other.id })
      .expect(400);
    await api.as(w.a.employee, w.a.id).post('/product-types').send({ name: 'Snacks' }).expect(403);
    const audit = await auditFor(meal.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toContain('product_type.create');
  });

  it('can be renamed, but not to another type’s name', async () => {
    const t = (await admin().post('/product-types').send({ name: 'Sweets' }).expect(201)).body;
    await admin().patch(`/product-types/${t.id}`).send({ name: 'Desserts' }).expect(200);
    await admin().patch(`/product-types/${t.id}`).send({ name: 'Meal' }).expect(409);
  });
});

describe('custom product order', () => {
  it('is saved by the admin, new products go last, and every list follows it', async () => {
    const zz = await product('Zz Somsa');
    const aa = await product('Aa Bread');
    const before = await names();
    expect(before.at(-1)).toBe('Aa Bread');
    // Drag: Aa Bread to the top, then Zz Somsa.
    const res = await admin()
      .put('/products/order')
      .send({ productIds: [aa.id, zz.id] })
      .expect(200);
    expect(res.body.productIds.slice(0, 2)).toEqual([aa.id, zz.id]);
    expect((await names()).slice(0, 2)).toEqual(['Aa Bread', 'Zz Somsa']);
    // The contractor's catalog follows the same order and shows each type.
    const catalog = await api
      .as(w.contractor.admin, w.contractor.id)
      .get(`/catalog?provider_id=${w.a.id}`)
      .expect(200);
    expect(catalog.body.items.slice(0, 2).map((i: { name: string }) => i.name)).toEqual([
      'Aa Bread',
      'Zz Somsa',
    ]);
    expect(catalog.body.items[0]).toHaveProperty('sortOrder');
    expect(catalog.body.items[0]).toHaveProperty('type');
    const audit = await auditFor(w.a.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toContain('product.reorder');
  });

  it('refuses products of another organization, and employees', async () => {
    const theirs = (await api.as(w.b.admin, w.b.id).get('/products').expect(200)).body.items[0];
    await admin()
      .put('/products/order')
      .send({ productIds: [theirs.id] })
      .expect(400);
    const mine = (await admin().get('/products').expect(200)).body.items[0];
    await api
      .as(w.a.employee, w.a.id)
      .put('/products/order')
      .send({ productIds: [mine.id] })
      .expect(403);
  });
});

describe('sort choice', () => {
  it('is kept on each person’s account: custom by default, A to Z or by type', async () => {
    const me = await api.as(w.a.employee).get('/me').expect(200);
    expect(me.body.preferences.productSort).toBe('custom');
    const changed = await api
      .as(w.a.employee)
      .patch('/me')
      .send({ preferences: { productSort: 'type' } })
      .expect(200);
    expect(changed.body.preferences.productSort).toBe('type');
    await api
      .as(w.a.employee)
      .patch('/me')
      .send({ preferences: { productSort: 'size' } })
      .expect(400);
  });
});
