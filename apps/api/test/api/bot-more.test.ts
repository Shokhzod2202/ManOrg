import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LLM_PROVIDER } from '../../src/bot/llm/types';
import { TOOL_LIST } from '../../src/bot/tools';
import { addDays, localDate } from '../../src/common/time';
import { Api, createTestApp } from '../helpers/app';
import { asOwner, disconnectDatabases, resetDatabase } from '../helpers/db';
import { ScriptedLlm, say } from '../helpers/scripted-llm';
import { buildWorld, type World } from '../helpers/world';

/** The bot does everything the admin can (decided 2026-11-13), each change only on Confirm. */
let app: INestApplication;
let api: Api;
let w: World;
let llm: ScriptedLlm;
const admin = () => api.as(w.a.admin, w.a.id);
const today = () => localDate('Asia/Seoul');

beforeAll(async () => {
  await resetDatabase();
  llm = new ScriptedLlm();
  app = await createTestApp({}, [{ token: LLM_PROVIDER, value: llm }]);
  api = new Api(app);
  w = await buildWorld(api);
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

/** Asks the bot to call one tool, checks nothing changed, confirms, and returns the proposal. */
async function propose(tool: string, input: unknown, text = 'Do it') {
  llm.script(
    () => [llm.call(tool, input)],
    () => [say('Press Confirm.')],
  );
  const res = await admin().post('/bot/messages').send({ text }).expect(200);
  const seen = llm.seenToolResults();
  expect(res.body.proposals, seen.slice(-300)).toHaveLength(1);
  return res.body.proposals[0] as {
    id: string;
    summary: string;
    changes: { before: unknown; after: unknown }[];
  };
}
const confirm = (id: string) => admin().post(`/bot/proposals/${id}/confirm`).send({}).expect(200);
const botAudit = (action: string) =>
  asOwner({ organizationId: w.a.id, userId: w.a.admin.userId }, (tx) =>
    tx.auditLog.count({ where: { organizationId: w.a.id, action, actorType: 'bot' } }),
  );

describe('bot: more admin powers, all previewed', () => {
  it('creates a task for an employee', async () => {
    const p = await propose('create_task', {
      title: 'Clean the proofer',
      assignee_id: w.a.employee.userId,
      due_date: today(),
    });
    expect(p.summary).toContain(w.a.employee.name);
    expect(
      (await admin().get('/tasks?status=open').expect(200)).body.items.some(
        (t: { title: string }) => t.title === 'Clean the proofer',
      ),
    ).toBe(false);
    expect((await confirm(p.id)).body.status).toBe('applied');
    const tasks = await api.as(w.a.employee, w.a.id).get('/tasks?status=open').expect(200);
    expect(tasks.body.items.some((t: { title: string }) => t.title === 'Clean the proofer')).toBe(
      true,
    );
    expect(await botAudit('task.create')).toBe(1);
  });

  it('sets the products an employee logs, by name', async () => {
    const p = await propose('set_employee_products', {
      employee_id: w.a.employee.userId,
      product_names: ['alpha bread'],
    });
    expect(p.changes[0]!.after).toBe('Alpha Bread');
    await confirm(p.id);
    const list = await api
      .as(w.a.employee, w.a.id)
      .get(`/employees/${w.a.employee.userId}/products`)
      .expect(200);
    expect(list.body.items.map((x: { name: string }) => x.name)).toEqual(['Alpha Bread']);
  });

  it('sets who orders an ingredient', async () => {
    const p = await propose('set_ingredient_responsible', {
      ingredient_id: w.a.ingredientId,
      employee_ids: [w.a.employee.userId],
    });
    expect(p.changes[0]!.after).toBe(w.a.employee.name);
    await confirm(p.id);
    const ing = await admin().get(`/ingredients/${w.a.ingredientId}`).expect(200);
    expect(ing.body.responsibleEmployees.map((x: { id: string }) => x.id)).toEqual([
      w.a.employee.userId,
    ]);
  });

  it('decides a shift correction; the employee is told', async () => {
    const date = addDays(today(), -2);
    const req = await api
      .as(w.a.employee, w.a.id)
      .post('/punch-change-requests')
      .send({
        shiftDate: date,
        requestedStart: `${date}T06:00:00+09:00`,
        requestedEnd: `${date}T14:00:00+09:00`,
        reason: 'Phone died',
      })
      .expect(201);
    llm.script(
      () => [llm.call('search_data', { kind: 'punch_change_requests' })],
      () => [say('One waiting.')],
    );
    await admin()
      .post('/bot/messages')
      .send({ text: 'Any shift corrections waiting?' })
      .expect(200);
    expect(llm.seenToolResults()).toContain('Phone died');
    const p = await propose('decide_punch_correction', {
      request_id: req.body.id,
      decision: 'approve',
    });
    await confirm(p.id);
    const inbox = await api.as(w.a.employee).get('/notifications').expect(200);
    expect(inbox.body.items[0]).toMatchObject({ type: 'punch.change_decided' });
    expect(await botAudit('punch_change_request.approve')).toBe(1);
  });

  it("corrects a contractor's order, then decides a change request item", async () => {
    const date = addDays(today(), 3);
    const order = await api
      .as(w.contractor.admin, w.contractor.id)
      .post('/orders')
      .send({
        providerId: w.a.id,
        deliveryDate: date,
        lines: [{ productId: w.a.productId, quantity: 30 }],
      })
      .expect(201);
    const p = await propose('correct_order', {
      order_id: order.body.id,
      lines: [{ product_id: w.a.productId, quantity: 25 }],
    });
    expect(p.changes[0]).toMatchObject({ before: 'Alpha Bread 30', after: 'Alpha Bread 25' });
    await confirm(p.id);
    expect((await admin().get(`/orders/${order.body.id}`).expect(200)).body.lines[0].quantity).toBe(
      25,
    );

    await api
      .as(w.contractor.admin, w.contractor.id)
      .post(`/orders/${order.body.id}/change-requests`)
      .send({ lines: [{ productId: w.a.productId, quantity: 40 }] })
      .expect(201);
    const open = await admin().get('/order-change-requests?status=open').expect(200);
    const itemId = open.body.items[0].items[0].id;
    const d = await propose('decide_order_change', { item_id: itemId, decision: 'accept' });
    expect(d.changes[0]).toMatchObject({ before: 25, after: 40 });
    await confirm(d.id);
    expect((await admin().get(`/orders/${order.body.id}`).expect(200)).body.lines[0].quantity).toBe(
      40,
    );
  });

  it('ticks a product made in the orders due next', async () => {
    const due = await admin().get('/orders/due-next').expect(200);
    const productId = due.body.totals[0].productId;
    const p = await propose('mark_made', { product_id: productId, made: true });
    await confirm(p.id);
    const after = await admin().get('/orders/due-next').expect(200);
    expect(
      after.body.totals.find((t: { productId: string }) => t.productId === productId).done,
    ).toBe(true);
  });

  it('moves an ingredient order from requested to bought', async () => {
    const order = await api
      .as(w.a.employee, w.a.id)
      .post('/ingredient-orders')
      .send({ ingredientId: w.a.ingredientId, quantity: 2 })
      .expect(201);
    const early = await (async () => {
      llm.script(
        () => [llm.call('advance_ingredient_order', { order_id: order.body.id, step: 'check' })],
        () => [say('Cannot.')],
      );
      await admin().post('/bot/messages').send({ text: 'Mark it checked' }).expect(200);
      return llm.seenToolResults();
    })();
    expect(early).toContain('cannot be checked now');
    const p = await propose('advance_ingredient_order', {
      order_id: order.body.id,
      step: 'fulfil',
    });
    await confirm(p.id);
    const list = await admin().get('/ingredient-orders').expect(200);
    expect(list.body.items.find((o: { id: string }) => o.id === order.body.id).status).toBe(
      'fulfilled',
    );
  });

  it('still has no tool that deletes, or changes roles or its own permissions', async () => {
    const names = TOOL_LIST.map((t) => t.name);
    expect(names.filter((n) => /delete|remove|role|admin|permission|bot_access/i.test(n))).toEqual(
      [],
    );
    expect(names.length).toBeGreaterThanOrEqual(14);
  });
});
