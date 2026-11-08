import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports ok', () => {
    expect(new HealthController().get()).toEqual({ status: 'ok' });
  });
});
