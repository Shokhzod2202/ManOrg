import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/**
 * Decided 2026-12-01: each ingredient's amount for one batch, in a unit of its kind; how many
 * pieces a batch makes; and what a batch and a piece cost at today's ingredient prices.
 */
let app: INestApplication;
let api: Api;
let w: World;
let oil: string;
let product: string;
const admin = () => api.as(w.a.admin, w.a.id);

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  // Flour: a 20 kg sack for 30,000 won. Oil: a 1.8 L bottle for 9,000 won.
  await admin()
    .put(`/ingredients/${w.a.ingredientId}/price`)
    .send({ packPrice: 30_000 })
    .expect(200);
  oil = (
    await admin()
      .post('/ingredients')
      .send({ name: 'Soybean oil', source: 'Market', packQuantity: 1.8, packUnit: 'L' })
      .expect(201)
  ).body.id;
  await admin().put(`/ingredients/${oil}/price`).send({ packPrice: 9_000 }).expect(200);
  product = (
    await admin()
      .post('/products')
      .send({
        name: 'Non',
        minutesPer10: 30,
        batchYield: 40,
        ingredients: [
          { ingredientId: w.a.ingredientId, quantity: 10, unit: 'kg' },
          { ingredientId: oil, quantity: 500, unit: 'mL' },
        ],
      })
      .expect(201)
  ).body.id;
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('batch ingredients and cost', () => {
  it('shows each line and the batch cost, and the cost per piece', async () => {
    const res = await admin().get(`/products/${product}`).expect(200);
    expect(res.body.batchYield).toBe(40);
    expect(res.body.ingredients).toEqual([
      expect.objectContaining({ name: 'Alpha Flour', quantity: 10, unit: 'kg', cost: 15_000 }),
      expect.objectContaining({ name: 'Soybean oil', quantity: 500, unit: 'mL', cost: 2_500 }),
    ]);
    expect(res.body.cost).toEqual({ perBatch: 17_500, perPiece: 438, missing: 0 });
  });

  it('follows today’s ingredient prices', async () => {
    await admin().put(`/ingredients/${oil}/price`).send({ packPrice: 18_000 }).expect(200);
    const res = await admin().get('/products').expect(200);
    const non = res.body.items.find((p: { id: string }) => p.id === product);
    expect(non.cost).toEqual({ perBatch: 20_000, perPiece: 500, missing: 0 });
  });

  it('keeps saved amounts when an edit lists the ingredient without one, and audits changes', async () => {
    const before = (await admin().get(`/products/${product}`).expect(200)).body;
    const res = await admin()
      .patch(`/products/${product}`)
      .set('If-Match', String(before.version))
      .send({
        ingredients: [
          { ingredientId: w.a.ingredientId },
          { ingredientId: oil, quantity: 1, unit: 'L' },
        ],
      })
      .expect(200);
    expect(res.body.ingredients).toEqual([
      expect.objectContaining({ quantity: 10, unit: 'kg' }),
      expect.objectContaining({ quantity: 1, unit: 'L', cost: 10_000 }),
    ]);
    const audit = await auditFor(product, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.at(-1)).toMatchObject({ action: 'product.update' });
  });

  it('counts lines without an amount as missing, and refuses a unit of another kind', async () => {
    const before = (await admin().get(`/products/${product}`).expect(200)).body;
    const res = await admin()
      .patch(`/products/${product}`)
      .set('If-Match', String(before.version))
      .send({
        ingredients: [{ ingredientId: w.a.ingredientId }, { ingredientId: oil, quantity: null }],
      })
      .expect(200);
    expect(res.body.cost).toEqual({ perBatch: 15_000, perPiece: 375, missing: 1 });
    const bad = await admin()
      .patch(`/products/${product}`)
      .set('If-Match', String(res.body.version))
      .send({ ingredients: [{ ingredientId: oil, quantity: 2, unit: 'kg' }] })
      .expect(400);
    expect(bad.body.error.fields.ingredients[0]).toContain('Soybean oil');
  });

  it('shows no costs to employees', async () => {
    const mine = await api
      .as(w.a.employee, w.a.id)
      .get(`/employees/${w.a.employee.userId}/products`)
      .expect(200);
    for (const p of mine.body.items) expect(p).not.toHaveProperty('cost');
  });
});
