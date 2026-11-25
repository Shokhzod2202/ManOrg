import { type Tx } from '../database/prisma-client';
import { Prisma } from '../generated/prisma/client';
import { Errors } from './errors';

/**
 * Decided 2026-11-24 (replaces open question 3's default of one organization per person): a person
 * may belong to several organizations, but has at most one pending or active membership in each.
 */
export async function assertNotInOrganization(
  tx: Tx,
  userId: string,
  organizationId: string,
  who: 'you' | 'they',
): Promise<void> {
  const open = await tx.membership.findFirst({
    where: { userId, organizationId, status: { in: ['pending', 'active'] } },
    select: { id: true },
  });
  if (open) throw alreadyIn(who);
}

const alreadyIn = (who: 'you' | 'they') =>
  Errors.conflict(
    'ALREADY_IN_ORGANIZATION',
    who === 'you'
      ? 'You already belong to or have applied to this organization.'
      : 'This person already belongs to or has applied to this organization.',
  );

/** A rejected applicant may re-apply after 7 days (assumed, spec section 4). */
export const REAPPLY_AFTER_DAYS = 7;

export function assertReapplyAllowed(
  lastRejectedAt: Date | null | undefined,
  now = new Date(),
): void {
  if (!lastRejectedAt) return;
  const allowedFrom = new Date(lastRejectedAt.getTime() + REAPPLY_AFTER_DAYS * 86_400_000);
  if (allowedFrom > now) {
    throw Errors.conflict(
      'REAPPLY_TOO_SOON',
      `This application was rejected. You can apply again from ${allowedFrom.toISOString().slice(0, 10)}.`,
    );
  }
}

/**
 * Creates a membership, mapping the one-open-membership-per-organization unique index to a clear
 * 409; the database index is the final guard against two requests at once.
 */
export async function createMembershipOnce<T>(
  create: () => Promise<T>,
  who: 'you' | 'they',
): Promise<T> {
  try {
    return await create();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw alreadyIn(who);
    }
    throw error;
  }
}

/**
 * Checks that every user id is an active member of the organization, returning their names.
 * Ids outside the organization are reported as not found, which reveals nothing about them.
 */
export async function activeMembers(
  tx: Tx,
  organizationId: string,
  userIds: string[],
): Promise<{ id: string; name: string; title: string | null }[]> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  const rows = await tx.membership.findMany({
    where: { organizationId, userId: { in: unique }, status: 'active' },
    select: PERSON,
  });
  if (rows.length !== unique.length) {
    const found = new Set(rows.map((r) => r.user.id));
    const missing = unique.filter((id) => !found.has(id));
    throw Errors.validation({ employeeIds: missing.map((id) => `${id} is not an active member.`) });
  }
  return rows.map(personOf);
}

/**
 * Decided 2026-11-26: who works shifts, and so appears in shift plans, timesheets, punch flags and
 * the Today on-shift list: every employee, and admins switched on in Settings.
 */
export const WORKS_SHIFTS = {
  OR: [{ role: 'employee' as const }, { role: 'admin' as const, worksShifts: true }],
};

/**
 * Decided 2026-11-29: inside an organization a person is shown by the name its admins gave them
 * (else their account name), with their title. Select this from a membership, then `personOf`.
 */
export const PERSON = {
  displayName: true,
  title: true,
  user: { select: { id: true, name: true } },
} as const;

export function personOf(m: {
  displayName: string | null;
  title: string | null;
  user: { id: string; name: string };
}): { id: string; name: string; title: string | null } {
  return { id: m.user.id, name: m.displayName || m.user.name, title: m.title };
}

/** People by id as the organization shows them (removed members included). */
export async function orgPeople(
  tx: Tx,
  organizationId: string,
  ids: string[],
): Promise<Map<string, { id: string; name: string; title: string | null }>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const [users, memberships] = await Promise.all([
    tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
    tx.membership.findMany({
      where: { organizationId, userId: { in: unique } },
      select: { userId: true, displayName: true, title: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  // The latest membership wins (someone can leave and join again).
  const own = new Map(memberships.map((m) => [m.userId, m]));
  return new Map(
    users.map((u) => {
      const m = own.get(u.id);
      return [u.id, { id: u.id, name: m?.displayName || u.name, title: m?.title ?? null }];
    }),
  );
}
