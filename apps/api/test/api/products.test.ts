import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp, PNG } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;

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

function upload(orgId = w.a.id, session = w.a.admin, body: Buffer = PNG) {
  return api.as(session, orgId).post('/product-images').attach('file', body, 'picture.png');
}

/** Fetches a signed link through the app (links point at PUBLIC_API_URL). */
function fetchLink(link: string) {
  const url = new URL(link);
  return request(app.getHttpServer()).get(`${url.pathname}${url.search}`);
}

describe('POST /product-images', () => {
  it('stores a picture and returns a short-lived link to it', async () => {
    const res = await upload().expect(201);
    expect(res.body.imageKey).toMatch(new RegExp(`^${w.a.id}\\.product\\.`));
    const file = await fetchLink(res.body.imageUrl).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.from(file.body).equals(PNG)).toBe(true);
  });

  it('detects the type from the bytes and refuses other files', async () => {
    const res = await upload(w.a.id, w.a.admin, Buffer.from('%PDF-1.7 not a picture')).expect(400);
    expect(res.body.error.fields).toHaveProperty('file');
  });

  it('refuses pictures over 5 MB', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await upload(w.a.id, w.a.admin, big).expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('needs a file', async () => {
    await api.as(w.a.admin, w.a.id).post('/product-images').expect(400);
  });

  it('is forbidden to employees', async () => {
    await upload(w.a.id, w.a.employee).expect(403);
  });
});

describe('signed file links', () => {
  it('refuse a changed signature, an expired link or a guessed key', async () => {
    const res = await upload().expect(201);
    const url = new URL(res.body.imageUrl);
    const tampered = new URL(url);
    tampered.searchParams.set('signature', 'A'.repeat(43));
    await fetchLink(tampered.toString()).expect(404);
    const expired = new URL(url);
    expired.searchParams.set('expires', '1');
    await fetchLink(expired.toString()).expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/files/..%2F..%2Fetc%2Fpasswd?expires=9999999999&signature=xxxxxxxxxxxx')
      .expect(404);
  });
});

describe('POST /products (PRD-1)', () => {
  it('creates a product with name, picture, ingredients and minutes per 10, audited', async () => {
    const image = await upload().expect(201);
    const res = await api
      .as(w.a.admin, w.a.id)
      .post('/products')
      .send({
        name: 'Somsa',
        imageKey: image.body.imageKey,
        minutesPer10: 25,
        ingredients: [{ ingredientId: w.a.ingredientId, quantityPer10: 1.5 }],
      })
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'Somsa',
      imageKey: image.body.imageKey,
      imageUrl: expect.stringContaining('/api/v1/files/'),
      minutesPer10: 25,
      available: true,
      ingredients: [{ id: w.a.ingredientId, name: 'Alpha Flour', quantityPer10: 1.5 }],
      version: 1,
    });
    const audit = await auditFor(res.body.id, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.map((a) => a.action)).toEqual(['product.create']);
  });

  it('requires all four fields', async () => {
    const res = await api.as(w.a.admin, w.a.id).post('/products').send({}).expect(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual([
      'imageKey',
      'ingredients',
      'minutesPer10',
      'name',
    ]);
    const empty = await api
      .as(w.a.admin, w.a.id)
      .post('/products')
      .send({ name: 'X', imageKey: 'k', minutesPer10: 5, ingredients: [] })
      .expect(400);
    expect(empty.body.error.fields).toHaveProperty('ingredients');
  });

  it('refuses a picture that was not uploaded for this organization', async () => {
    const other = await upload(w.b.id, w.b.admin).expect(201);
    const res = await api
      .as(w.a.admin, w.a.id)
      .post('/products')
      .send({
        name: 'X',
        imageKey: other.body.imageKey,
        minutesPer10: 5,
        ingredients: [{ ingredientId: w.a.ingredientId }],
      })
      .expect(400);
    expect(res.body.error.fields).toHaveProperty('imageKey');
  });

  it('refuses another organization’s ingredient', async () => {
    const image = await upload().expect(201);
    const res = await api
      .as(w.a.admin, w.a.id)
      .post('/products')
      .send({
        name: 'X',
        imageKey: image.body.imageKey,
        minutesPer10: 5,
        ingredients: [{ ingredientId: w.b.ingredientId }],
      })
      .expect(400);
    expect(res.body.error.fields).toHaveProperty('ingredients');
  });

  it('is forbidden to employees and contractor admins', async () => {
    await api.as(w.a.employee, w.a.id).post('/products').send({}).expect(403);
    await api.as(w.contractor.admin, w.contractor.id).post('/products').send({}).expect(403);
  });
});

describe('PATCH /products/{id} (PRD-2)', () => {
  it('makes a product unavailable without removing it, audited', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .patch(`/products/${w.a.productId}`)
      .set('If-Match', '1')
      .send({ available: false })
      .expect(200);
    expect(res.body).toMatchObject({ available: false, version: 2 });
    const list = await api.as(w.a.admin, w.a.id).get('/products').expect(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toContain(w.a.productId);
    const audit = await auditFor(w.a.productId, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    expect(audit.at(-1)).toMatchObject({
      action: 'product.availability_set',
      before: expect.objectContaining({ available: true }),
      after: expect.objectContaining({ available: false }),
    });
  });

  it('edits every field and replaces the ingredients', async () => {
    const image = await upload().expect(201);
    const second = await api
      .as(w.a.admin, w.a.id)
      .post('/ingredients')
      .send({ name: 'Salt', source: 'Mill', packQuantity: 1, packUnit: 'kg' })
      .expect(201);
    const res = await api
      .as(w.a.admin, w.a.id)
      .patch(`/products/${w.a.productId}`)
      .set('If-Match', '2')
      .send({
        name: 'Rye Bread',
        imageKey: image.body.imageKey,
        minutesPer10: 15,
        ingredients: [{ ingredientId: second.body.id }],
        available: true,
      })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Rye Bread',
      imageKey: image.body.imageKey,
      minutesPer10: 15,
      available: true,
      ingredients: [{ id: second.body.id, name: 'Salt', quantityPer10: null }],
      version: 3,
    });
  });

  it('rejects a stale version and needs If-Match', async () => {
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/products/${w.a.productId}`)
      .set('If-Match', '1')
      .send({ name: 'Old' })
      .expect(409);
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/products/${w.a.productId}`)
      .send({ name: 'Old' })
      .expect(428);
  });

  it('answers 404 for another organization’s product', async () => {
    await api.as(w.a.admin, w.a.id).get(`/products/${w.b.productId}`).expect(404);
    await api
      .as(w.a.admin, w.a.id)
      .patch(`/products/${w.b.productId}`)
      .set('If-Match', '1')
      .send({ name: 'X' })
      .expect(404);
  });

  it('is forbidden to employees', async () => {
    await api.as(w.a.employee, w.a.id).get('/products').expect(403);
    await api
      .as(w.a.employee, w.a.id)
      .patch(`/products/${w.a.productId}`)
      .set('If-Match', '1')
      .send({ name: 'X' })
      .expect(403);
  });
});

describe('employee products (PRD-3)', () => {
  it('lets an employee see only their own assigned products', async () => {
    const own = await api
      .as(w.b.employee, w.b.id)
      .get(`/employees/${w.b.employee.userId}/products`)
      .expect(200);
    expect(own.body.items.map((p: { id: string }) => p.id)).toEqual([w.b.productId]);
    await api.as(w.b.employee, w.b.id).get(`/employees/${w.b.admin.userId}/products`).expect(403);
  });

  it('lets the admin replace an employee’s products, audited', async () => {
    const extra = await api.as(w.b.admin, w.b.id).get('/products').expect(200);
    const res = await api
      .as(w.b.admin, w.b.id)
      .put(`/employees/${w.b.employee.userId}/products`)
      .send({ productIds: [] })
      .expect(200);
    expect(res.body.items).toEqual([]);
    const audit = await auditFor(w.b.employee.userId, {
      organizationId: w.b.id,
      userId: w.b.admin.userId,
    });
    expect(audit.at(-1)).toMatchObject({
      action: 'employee.products_set',
      before: { productIds: [w.b.productId] },
      after: { productIds: [] },
    });
    expect(extra.body.items.length).toBeGreaterThan(0);
  });

  it('refuses products and people from another organization', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .put(`/employees/${w.a.employee.userId}/products`)
      .send({ productIds: [w.b.productId] })
      .expect(400);
    expect(res.body.error.fields).toHaveProperty('productIds');
    await api
      .as(w.a.admin, w.a.id)
      .put(`/employees/${w.b.employee.userId}/products`)
      .send({ productIds: [] })
      .expect(404);
    await api.as(w.a.admin, w.a.id).get(`/employees/${w.b.employee.userId}/products`).expect(404);
  });

  it('is changed by admins only', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .put(`/employees/${w.a.employee.userId}/products`)
      .send({ productIds: [] })
      .expect(403);
  });
});
