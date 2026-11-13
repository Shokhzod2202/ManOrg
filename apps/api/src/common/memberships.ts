import { type Tx } from '../database/prisma-client';
import { Prisma } from '../generated/prisma/client';
import { Errors } from './errors';

/** Open question 3: one organization per user in v1 (a pending or active membership). */
export async function assertNoOpenMembership(
  tx: Tx,
  userId: string,
  who: 'you' | 'they',
): Promise<void> {
  const open = await tx.membership.findFirst({
    where: { userId, status: { in: ['pending', 'active'] } },
    select: { id: true },
  });
  if (open) {
    throw Errors.conflict(
      'ALREADY_IN_ORGANIZATION',
      who === 'you'
        ? 'You already belong to or have applied to an organization.'
        : 'This person already belongs to or has applied to an organization.',
    );
  }
}

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
 * Creates a membership, mapping the one-open-membership unique index to a clear 409. The check
 * above it cannot always see the other membership: row-level security hides other organizations'
 * rows, so the database index is the final guard.
 */
export async function createMembershipOnce<T>(
  create: () => Promise<T>,
  who: 'you' | 'they',
): Promise<T> {
  try {
    return await create();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw Errors.conflict(
        'ALREADY_IN_ORGANIZATION',
        who === 'you'
          ? 'You already belong to or have applied to an organization.'
          : 'This person already belongs to or has applied to an organization.',
      );
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
): Promise<{ id: string; name: string }[]> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  const rows = await tx.membership.findMany({
    where: { organizationId, userId: { in: unique }, status: 'active' },
    select: { user: { select: { id: true, name: true } } },
  });
  if (rows.length !== unique.length) {
    const found = new Set(rows.map((r) => r.user.id));
    const missing = unique.filter((id) => !found.has(id));
    throw Errors.validation({ employeeIds: missing.map((id) => `${id} is not an active member.`) });
  }
  return rows.map((r) => r.user);
}
