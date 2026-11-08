/**
 * Development seed: two sample organizations (spec section 15).
 * - Sunrise Bakery (bakery): one admin and two employees.
 * - City Cafe (contractor): one admin, approved to buy from Sunrise Bakery.
 * Every account's password is `Password123!`. Runs as the table owner with the tenant settings
 * applied, so it passes the same row-level security policies as the API.
 */
import path from 'node:path';
import { hash } from '@node-rs/argon2';
import { config as loadEnv } from 'dotenv';
import { assertDemoSeedAllowed } from '../src/config/demo-seed';
import { createPrismaClient, withDbContext } from '../src/database/prisma-client';

loadEnv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

const PASSWORD = 'Password123!';

async function main(): Promise<void> {
  assertDemoSeedAllowed();
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error('DATABASE_MIGRATION_URL is not set');
  const prisma = createPrismaClient(url);
  try {
    if (await prisma.user.findUnique({ where: { email: 'admin@sunrise.test' } })) {
      console.log('Seed data already present; nothing to do.');
      return;
    }
    const passwordHash = await hash(PASSWORD);
    const [bakeryAdmin, mina, joon, cafeAdmin] = await Promise.all(
      [
        ['Sunrise Admin', 'admin@sunrise.test'],
        ['Mina Park', 'mina@sunrise.test'],
        ['Joon Kim', 'joon@sunrise.test'],
        ['City Cafe Admin', 'admin@citycafe.test'],
      ].map(([name, email]) =>
        prisma.user.create({ data: { name: name!, email: email!, passwordHash } }),
      ),
    );

    const bakery = await withDbContext(
      prisma,
      { organizationId: null, userId: bakeryAdmin!.id },
      (tx) =>
        tx.organization.create({
          data: { name: 'Sunrise Bakery', type: 'bakery', createdById: bakeryAdmin!.id },
        }),
    );
    await withDbContext(prisma, { organizationId: bakery.id, userId: bakeryAdmin!.id }, (tx) =>
      tx.membership.createMany({
        data: [
          { organizationId: bakery.id, userId: bakeryAdmin!.id, role: 'admin', status: 'active' },
          {
            organizationId: bakery.id,
            userId: mina!.id,
            role: 'employee',
            status: 'active',
            decidedById: bakeryAdmin!.id,
            decidedAt: new Date(),
          },
          {
            organizationId: bakery.id,
            userId: joon!.id,
            role: 'employee',
            status: 'active',
            decidedById: bakeryAdmin!.id,
            decidedAt: new Date(),
          },
        ],
      }),
    );

    const cafe = await withDbContext(
      prisma,
      { organizationId: null, userId: cafeAdmin!.id },
      (tx) =>
        tx.organization.create({
          data: { name: 'City Cafe', type: 'contractor', createdById: cafeAdmin!.id },
        }),
    );
    await withDbContext(prisma, { organizationId: cafe.id, userId: cafeAdmin!.id }, async (tx) => {
      await tx.membership.create({
        data: { organizationId: cafe.id, userId: cafeAdmin!.id, role: 'admin', status: 'active' },
      });
    });
    await withDbContext(prisma, { organizationId: bakery.id, userId: bakeryAdmin!.id }, (tx) =>
      tx.contractorLink.create({
        data: {
          organizationId: bakery.id,
          contractorOrgId: cafe.id,
          status: 'approved',
          requestedById: cafeAdmin!.id,
          decidedById: bakeryAdmin!.id,
          decidedAt: new Date(),
        },
      }),
    );

    console.log('Seeded Sunrise Bakery and City Cafe.');
    console.log(
      `Accounts (password ${PASSWORD}): admin@sunrise.test, mina@sunrise.test, joon@sunrise.test, admin@citycafe.test`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
