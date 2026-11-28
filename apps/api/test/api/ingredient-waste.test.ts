import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, auditFor, createTestApp } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

/**
 * Decided 2026-11-28: how much of a pack is thrown away (peel, trimmings). A 20 kg sack of
 * potatoes with 4 kg peeled off leaves 16 kg; costs use the 16 kg.
 */
let app: INestApplication;
let api: Api;
let w: World;
let potato: string;
const admin = () => api.as(w.a.admin, w.a.id);

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

describe('thrown away per pack', () => {
  it('is saved with the ingredient and leaves the usable part, priced per usable unit', async () => {
    const res = await admin()
      .post('/ingredients')
      .send({
        name: 'Potato',
        source: 'Market',
        packQuantity: 20,
        packUnit: 'kg',
        wasteQuantity: 4,
        packPrice: 32_000,
      })
      .expect(201);
    potato = res.body.id;
    // 32,000 won for the 16 kg that can be used: 2,000 won per kg.
    expect(res.body).toMatchObject({ wasteQuantity: 4, usableQuantity: 16, unitPrice: 2000 });
  });

  it('must be less than the pack, and changes are audited', async () => {
    const bad = await admin()
      .post('/ingredients')
      .send({ name: 'Onion', source: 'Market', packQuantity: 5, packUnit: 'kg', wasteQuantity: 5 })
      .expect(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(['wasteQuantity']);
    const now = (await admin().get(`/ingredients/${potato}`).expect(200)).body;
    await admin()
      .patch(`/ingredients/${potato}`)
      .set('If-Match', String(now.version))
      .send({ packQuantity: 3 })
      .expect(400);
    const res = await admin()
      .patch(`/ingredients/${potato}`)
      .set('If-Match', String(now.version))
      .send({ wasteQuantity: 2 })
      .expect(200);
    expect(res.body).toMatchObject({ wasteQuantity: 2, usableQuantity: 18 });
    const audit = await auditFor(potato, { organizationId: w.a.id, userId: w.a.admin.userId });
    expect(audit.at(-1)).toMatchObject({ action: 'ingredient.update' });
    await admin()
      .patch(`/ingredients/${potato}`)
      .set('If-Match', String(res.body.version))
      .send({ wasteQuantity: 4 })
      .expect(200);
  });

  it('makes product costs use the usable part', async () => {
    const product = await admin()
      .post('/products')
      .send({
        name: 'Potato somsa',
        minutesPer10: 20,
        batchYield: 40,
        ingredients: [{ ingredientId: potato, quantity: 8, unit: 'kg' }],
      })
      .expect(201);
    // 8 kg of usable potato at 2,000 won per usable kg: 16,000 won a batch, 400 a piece.
    expect(product.body.ingredients[0]).toMatchObject({ quantity: 8, cost: 16_000 });
    expect(product.body.cost).toEqual({ perBatch: 16_000, perPiece: 400, missing: 0 });
  });
});
