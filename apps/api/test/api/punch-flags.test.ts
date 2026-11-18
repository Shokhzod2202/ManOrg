import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '../../src/common/time';
import { PUSH_TYPES } from '../../src/devices/push.service';
import { ShiftsService } from '../../src/shifts/shifts.service';
import { Api, createTestApp } from '../helpers/app';
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

describe('punch difference flagged red (spec section 9)', () => {
  it('tells the admins once per employee, day and kind, in-app only', async () => {
    const yesterday = addDays(localDate('Asia/Seoul'), -1);
    const weekday = new Date(`${yesterday}T00:00:00Z`).getUTCDay();
    await api
      .as(w.a.admin, w.a.id)
      .put('/shifts')
      .send({
        employeeId: w.a.employee.userId,
        days: [{ weekday, startTime: '06:00', endTime: '14:00' }],
      })
      .expect(200);
    const shifts = app.get(ShiftsService);
    expect(await shifts.notifyFlags()).toBeGreaterThanOrEqual(1);
    await shifts.notifyFlags();

    const inbox = await api.as(w.a.admin).get('/notifications').expect(200);
    const flagged = inbox.body.items.filter(
      (n: { type: string; payload: { date: string } }) =>
        n.type === 'punch.flagged' && n.payload.date === yesterday,
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0].payload).toMatchObject({ code: 'MISSING_PUNCH', name: w.a.employee.name });
    // Only the admins; and another bakery hears nothing about it.
    const mine = await api.as(w.a.employee).get('/notifications').expect(200);
    expect(mine.body.items.some((n: { type: string }) => n.type === 'punch.flagged')).toBe(false);
    const other = await api.as(w.b.admin).get('/notifications').expect(200);
    expect(
      other.body.items.some(
        (n: { payload: { name?: string } }) => n.payload.name === w.a.employee.name,
      ),
    ).toBe(false);
    expect(PUSH_TYPES.has('punch.flagged')).toBe(false);
  });
});
