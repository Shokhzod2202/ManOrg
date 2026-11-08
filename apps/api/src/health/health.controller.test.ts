import { describe, expect, it } from 'vitest';
import { type DatabaseService } from '../database/database.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports liveness without asking the database', () => {
    const controller = new HealthController(undefined as unknown as DatabaseService);
    expect(controller.get()).toEqual({ status: 'ok' });
  });
});
