import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '../../src/common/time';
import { Api, auditFor, createProduct, createTestApp, type Session } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';
import { buildWorld, type World } from '../helpers/world';

let app: INestApplication;
let api: Api;
let w: World;
let joon: Session;
let pilaf: string;
let teamA: string;
const today = () => localDate('Asia/Seoul');

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  api = new Api(app);
  w = await buildWorld(api);
  joon = await api.hireEmployee(w.a.id, w.a.admin, 'Joon');
  pilaf = await createProduct(api, w.a.admin, w.a.id, w.a.ingredientId, 'Pilaf');
  for (const person of [w.a.employee, joon]) {
    await api
      .as(w.a.admin, w.a.id)
      .put(`/employees/${person.userId}/products`)
      .send({ productIds: person === joon ? [pilaf] : [w.a.productId, pilaf] })
      .expect(200);
  }
});

afterAll(async () => {
  await app.close();
  await disconnectDatabases();
});

describe('teams (TEAM-1, OUT-4, OUT-5)', () => {
  it('saves a team with its creator as a member, private to the creator', async () => {
    const res = await api
      .as(w.a.employee, w.a.id)
      .post('/teams')
      .send({ name: 'Team A', memberIds: [joon.userId] })
      .expect(201);
    teamA = res.body.id;
    expect(res.body.members.map((m: { id: string }) => m.id).sort()).toEqual(
      [w.a.employee.userId, joon.userId].sort(),
    );
    const mine = await api.as(w.a.employee, w.a.id).get('/teams').expect(200);
    expect(mine.body.items.map((t: { id: string }) => t.id)).toEqual([teamA]);
    const theirs = await api.as(joon, w.a.id).get('/teams').expect(200);
    expect(theirs.body.items).toEqual([]);
    await api.as(joon, w.a.id).patch(`/teams/${teamA}`).send({ name: 'Mine now' }).expect(404);
  });

  it('refuses members from another organization', async () => {
    await api
      .as(w.a.employee, w.a.id)
      .post('/teams')
      .send({ name: 'X', memberIds: [w.b.employee.userId] })
      .expect(400);
  });

  it('is for employees; admins do not keep teams', async () => {
    await api.as(w.a.admin, w.a.id).get('/teams').expect(403);
  });
});

describe('PUT /output/{date} (OUT-1, OUT-6, TEAM-2 to TEAM-4)', () => {
  it('saves Self Bread 30 plus Team A Pilaf 30 and credits the team equally', async () => {
    const res = await api
      .as(w.a.employee, w.a.id)
      .put(`/output/${today()}`)
      .send({
        lines: [
          { productId: w.a.productId, quantity: 30 },
          { productId: pilaf, quantity: 30, teamId: teamA },
        ],
        cleaningHours: 1.5,
      })
      .expect(200);
    expect(res.body).toMatchObject({
      date: today(),
      personal: [{ productId: w.a.productId, quantity: 30, expectedMinutes: 36 }],
      team: [
        {
          team: { id: teamA, name: 'Team A' },
          productId: pilaf,
          quantity: 30,
          creditedQuantity: 15,
        },
      ],
      cleaningHours: 1.5,
      creditedQuantity: 45,
      expectedMinutes: 54,
    });
    const audit = await auditFor(w.a.employee.userId, {
      organizationId: w.a.id,
      userId: w.a.admin.userId,
    });
    expect(audit.at(-1)).toMatchObject({
      action: 'output.set',
      after: expect.objectContaining({ cleaningHours: 1.5 }),
    });
  });

  it('shows the team line on every member’s own output (TEAM-4)', async () => {
    const res = await api.as(joon, w.a.id).get(`/output?from=${today()}&to=${today()}`).expect(200);
    expect(res.body.days[0]).toMatchObject({
      personal: [],
      team: [{ productId: pilaf, quantity: 30, creditedQuantity: 15 }],
      creditedQuantity: 15,
    });
  });

  it('counts a team line once: another member cannot log it again', async () => {
    const res = await api
      .as(joon, w.a.id)
      .put(`/output/${today()}`)
      .send({ lines: [{ productId: pilaf, quantity: 30, teamId: teamA }] })
      .expect(409);
    expect(res.body.error.code).toBe('TEAM_LINE_EXISTS');
  });

  it('requires the person to be in the team they log for (TEAM-3)', async () => {
    const other = await api
      .as(joon, w.a.id)
      .post('/teams')
      .send({ name: 'Joon solo', memberIds: [] })
      .expect(201);
    const res = await api
      .as(w.a.employee, w.a.id)
      .put(`/output/${today()}`)
      .send({ lines: [{ productId: pilaf, quantity: 5, teamId: other.body.id }] })
      .expect(400);
    expect(res.body.error.fields.lines[0]).toMatch(/must be a member of Joon solo/);
  });

  it('accepts only products assigned to the person (PRD-3)', async () => {
    await api
      .as(joon, w.a.id)
      .put(`/output/${today()}`)
      .send({ lines: [{ productId: w.a.productId, quantity: 5 }] })
      .expect(400);
  });

  it('lets employees edit today and yesterday only; admins may correct any past day', async () => {
    const old = addDays(today(), -3);
    const res = await api
      .as(w.a.employee, w.a.id)
      .put(`/output/${old}`)
      .send({ lines: [] })
      .expect(422);
    expect(res.body.error.code).toBe('OUTPUT_LOCKED');
    await api
      .as(w.a.employee, w.a.id)
      .put(`/output/${addDays(today(), -1)}`)
      .send({ lines: [] })
      .expect(200);
    await api
      .as(w.a.admin, w.a.id)
      .put(`/output/${old}?employee_id=${w.a.employee.userId}`)
      .send({ lines: [{ productId: w.a.productId, quantity: 10 }] })
      .expect(200);
    await api
      .as(w.a.admin, w.a.id)
      .put(`/output/${addDays(today(), 1)}?employee_id=${w.a.employee.userId}`)
      .send({ lines: [] })
      .expect(422);
  });

  it('does not let an employee log for someone else', async () => {
    await api
      .as(joon, w.a.id)
      .put(`/output/${today()}?employee_id=${w.a.employee.userId}`)
      .send({ lines: [] })
      .expect(403);
  });
});

describe('reading output (OUT-2, OUT-3)', () => {
  it('lets employees read only their own output unless the admin opens it', async () => {
    await api
      .as(joon, w.a.id)
      .get(`/output?from=${today()}&to=${today()}&employee_id=${w.a.employee.userId}`)
      .expect(403);
    await api
      .as(w.a.admin, w.a.id)
      .get(`/output?from=${today()}&to=${today()}&employee_id=${w.a.employee.userId}`)
      .expect(200);
  });

  it('puts hours next to output with day totals counting team lines once', async () => {
    const res = await api
      .as(w.a.admin, w.a.id)
      .get(`/dashboard/shift-output?date=${today()}`)
      .expect(200);
    expect(res.body.totals).toEqual(
      expect.arrayContaining([
        { productId: w.a.productId, name: 'Alpha Bread', quantity: 30 },
        { productId: pilaf, name: 'Pilaf', quantity: 30 },
      ]),
    );
    const employee = res.body.employees.find(
      (e: { employee: { id: string } }) => e.employee.id === w.a.employee.userId,
    );
    expect(employee).toMatchObject({
      workedMinutes: expect.any(Number),
      output: { creditedQuantity: 45, cleaningHours: 1.5 },
    });
    const own = await api
      .as(joon, w.a.id)
      .get(`/dashboard/shift-output?date=${today()}`)
      .expect(200);
    expect(own.body.employees.map((e: { employee: { id: string } }) => e.employee.id)).toEqual([
      joon.userId,
    ]);
  });

  it('is not for contractor admins', async () => {
    await api
      .as(w.contractor.admin, w.contractor.id)
      .get(`/dashboard/shift-output?date=${today()}`)
      .expect(403);
  });
});

describe('deleting a team', () => {
  it('hides it from its creator and keeps logged lines with their members', async () => {
    await api.as(w.a.employee, w.a.id).delete(`/teams/${teamA}`).expect(204);
    const mine = await api.as(w.a.employee, w.a.id).get('/teams').expect(200);
    expect(mine.body.items).toEqual([]);
    const res = await api.as(joon, w.a.id).get(`/output?from=${today()}&to=${today()}`).expect(200);
    expect(res.body.days[0].team[0].members).toHaveLength(2);
  });
});
