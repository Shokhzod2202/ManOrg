import { describe, expect, it } from 'vitest';
import { assertDemoSeedAllowed } from './demo-seed';

const devUrl = 'postgresql://manorg_owner:manorg_owner_dev@localhost:5432/manorg';
const prodUrl = 'postgresql://manorg_owner:not-a-dev-password@db:5432/manorg';

describe('assertDemoSeedAllowed', () => {
  it('allows the local development database', () => {
    expect(() => assertDemoSeedAllowed({ DATABASE_MIGRATION_URL: devUrl })).not.toThrow();
  });

  it('refuses production even if the development password is still in the URL', () => {
    expect(() =>
      assertDemoSeedAllowed({ NODE_ENV: 'production', DATABASE_MIGRATION_URL: devUrl }),
    ).toThrow(/production/);
    expect(() =>
      assertDemoSeedAllowed({
        MANORG_ENV: 'production',
        DATABASE_MIGRATION_URL: devUrl,
        ALLOW_DEMO_SEED: '1',
      }),
    ).toThrow(/production/);
  });

  it('refuses a non-development database unless explicitly overridden', () => {
    expect(() => assertDemoSeedAllowed({ DATABASE_MIGRATION_URL: prodUrl })).toThrow(
      /Password123!/,
    );
    expect(() =>
      assertDemoSeedAllowed({ DATABASE_MIGRATION_URL: prodUrl, ALLOW_DEMO_SEED: '1' }),
    ).not.toThrow();
  });
});
