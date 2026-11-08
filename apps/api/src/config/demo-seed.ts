const DEV_OWNER_MARKER = 'manorg_owner_dev';

/**
 * The demo seed creates known accounts with password `Password123!`.
 * It may run only against the local development database. Production compose never calls it,
 * and this guard still refuses if someone points the script at the production database.
 */
export function assertDemoSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' || env.MANORG_ENV === 'production') {
    throw new Error('Refusing to seed demo accounts when NODE_ENV or MANORG_ENV is production.');
  }
  const url = env.DATABASE_MIGRATION_URL ?? '';
  if (!url.includes(DEV_OWNER_MARKER) && env.ALLOW_DEMO_SEED !== '1') {
    throw new Error(
      'Refusing to seed demo accounts into a database that does not use the development owner password. Production must not create the Password123! accounts.',
    );
  }
}
