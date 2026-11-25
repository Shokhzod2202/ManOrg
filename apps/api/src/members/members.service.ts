import { Injectable } from '@nestjs/common';
import { actorFor, AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { assertNotInOrganization, createMembershipOnce } from '../common/memberships';
import { pageArgs, toPage } from '../common/pagination';
import { type AuthUser, type OrgContext, dbContext } from '../common/request-context';
import { StorageService } from '../storage/storage.service';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import {
  type CreateMemberInput,
  type ListMembersInput,
  type UpdateMemberInput,
} from './members.schemas';

const userFields = { id: true, name: true, email: true, avatarKey: true } as const;

type MemberRow = {
  id: string;
  role: 'admin' | 'employee';
  status: 'pending' | 'active' | 'rejected' | 'removed';
  version: number;
  owner: boolean;
  worksShifts: boolean;
  createdAt: Date;
  user: { id: string; name: string; email: string | null; avatarKey: string | null };
  avatarUrl?: string | null;
};

function present(m: MemberRow) {
  return {
    id: m.id,
    role: m.role,
    status: m.status,
    owner: m.owner,
    worksShifts: m.role === 'employee' || m.worksShifts,
    version: m.version,
    user: { id: m.user.id, name: m.user.name, email: m.user.email, avatarUrl: m.avatarUrl ?? null },
    createdAt: m.createdAt,
  };
}

/** ACC-7: admins add admins and change account types inside their organization. */
@Injectable()
export class MembersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  list(user: AuthUser, org: OrgContext, input: ListMembersInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.membership.findMany({
        where: { organizationId: org.organizationId, status: input.status },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { user: { select: userFields } },
        ...pageArgs(input),
      });
      const withAvatars = await Promise.all(
        rows.map(async (r) => ({
          ...r,
          avatarUrl: r.user.avatarKey ? await this.storage.signedUrl(r.user.avatarKey) : null,
        })),
      );
      return toPage(withAvatars, input, present);
    });
  }

  create(user: AuthUser, org: OrgContext, input: CreateMemberInput) {
    if (org.organizationType === 'contractor' && input.role !== 'admin')
      throw contractorAdminsOnly();
    if (input.role === 'admin') ownerOnly(user, org);
    return this.db.run(dbContext(user, org), async (tx) => {
      const person = await tx.user.findUnique({
        where: { email: input.email },
        select: userFields,
      });
      if (!person) {
        throw Errors.unprocessable(
          'ACCOUNT_NOT_FOUND',
          'No account uses this email. Ask the person to create an account first.',
        );
      }
      await assertNotInOrganization(tx, person.id, org.organizationId, 'they');
      const membership = await createMembershipOnce(
        () =>
          tx.membership.create({
            data: {
              organizationId: org.organizationId,
              userId: person.id,
              role: input.role,
              status: 'active',
              decidedById: user.userId,
              decidedAt: new Date(),
            },
            include: { user: { select: userFields } },
          }),
        'they',
      );
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'membership.create',
        entity: 'membership',
        entityId: membership.id,
        after: { ...membership, user: undefined },
      });
      return present(membership);
    });
  }

  update(user: AuthUser, org: OrgContext, id: string, version: number, input: UpdateMemberInput) {
    if (org.organizationType === 'contractor' && input.role === 'employee')
      throw contractorAdminsOnly();
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await tx.membership.findFirst({
        where: { id, organizationId: org.organizationId, status: { in: ['active', 'removed'] } },
      });
      if (!before) throw Errors.notFound('Member');
      if (before.status === 'removed') {
        throw Errors.conflict('MEMBER_REMOVED', 'This person is no longer a member.');
      }
      if (before.version !== version) throw Errors.versionConflict();
      // Decided 2026-11-26/27: an owner is never demoted or removed (they stop being an owner
      // first), and only owners make, demote or remove admins; anyone may step down themselves.
      const changesRole = input.role !== undefined && input.role !== before.role;
      if (before.owner && (changesRole || input.status === 'removed')) {
        throw Errors.conflict(
          'OWNER_PROTECTED',
          'An owner cannot be demoted or removed. They can stop being an owner themselves first.',
        );
      }
      const self = before.userId === user.userId && !user.viaBot;
      if (
        (changesRole && input.role === 'admin') ||
        (before.role === 'admin' && !self && (changesRole || input.status === 'removed'))
      ) {
        ownerOnly(user, org);
      }
      if (input.worksShifts !== undefined && (input.role ?? before.role) !== 'admin') {
        throw Errors.unprocessable('EMPLOYEES_ALWAYS_WORK', 'Employees always work shifts.');
      }
      const losesAdmin =
        before.role === 'admin' && (input.status === 'removed' || input.role === 'employee');
      if (losesAdmin) await this.assertAnotherAdmin(tx, org.organizationId, before.id);

      const result = await tx.membership.updateMany({
        where: { id, version },
        data: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.worksShifts !== undefined ? { worksShifts: input.worksShifts } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      const after = await tx.membership.findUniqueOrThrow({
        where: { id },
        include: { user: { select: userFields } },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action:
          input.status === 'removed'
            ? 'membership.remove'
            : changesRole
              ? 'membership.role_change'
              : 'membership.works_shifts',
        entity: 'membership',
        entityId: id,
        before,
        after: { ...after, user: undefined },
      });
      return present(after);
    });
  }

  /**
   * Decided 2026-11-27: ownership is shared. An owner makes another active member an owner too
   * (an employee becomes an admin as well) and stays an owner.
   */
  shareOwnership(user: AuthUser, org: OrgContext, id: string) {
    ownerOnly(user, org);
    return this.db.run(dbContext(user, org), async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id, organizationId: org.organizationId, status: 'active' },
      });
      if (!target) throw Errors.notFound('Member');
      if (target.owner) return this.presentOne(tx, id);
      await tx.membership.update({
        where: { id },
        data: { owner: true, role: 'admin', version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'membership.owner_add',
        entity: 'membership',
        entityId: id,
        before: { owner: false, role: target.role },
        after: { owner: true, role: 'admin' },
      });
      return this.presentOne(tx, id);
    });
  }

  /**
   * An owner stops being an owner (staying an admin). Only for oneself: owners never take
   * ownership from each other. The organization always keeps at least one owner.
   */
  leaveOwnership(user: AuthUser, org: OrgContext, id: string) {
    ownerOnly(user, org);
    if (id !== org.membershipId) {
      throw Errors.forbidden('Owners can only stop being an owner themselves.');
    }
    return this.db.run(dbContext(user, org), async (tx) => {
      const owners = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM memberships
        WHERE organization_id = ${org.organizationId}::uuid AND owner AND status = 'active'
        FOR UPDATE`;
      if (!owners.some((o) => o.id !== id)) {
        throw Errors.conflict(
          'LAST_OWNER',
          'Make someone else an owner before you stop being one.',
        );
      }
      await tx.membership.update({
        where: { id },
        data: { owner: false, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'membership.owner_leave',
        entity: 'membership',
        entityId: id,
        before: { owner: true },
        after: { owner: false },
      });
      return this.presentOne(tx, id);
    });
  }

  private async presentOne(tx: Tx, id: string) {
    const row = await tx.membership.findUniqueOrThrow({
      where: { id },
      include: { user: { select: userFields } },
    });
    return present(row);
  }

  /** An organization always keeps at least one active admin. Locks the admin rows first. */
  private async assertAnotherAdmin(tx: Tx, organizationId: string, excludingId: string) {
    const admins = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM memberships
      WHERE organization_id = ${organizationId}::uuid AND role = 'admin' AND status = 'active'
      FOR UPDATE`;
    if (!admins.some((a) => a.id !== excludingId)) {
      throw Errors.conflict('LAST_ADMIN', 'Add another admin before changing the last one.');
    }
  }
}

/** Decided 2026-11-26: only owners change who is an admin. The bot never does. */
function ownerOnly(user: AuthUser, org: OrgContext): void {
  if (!org.owner || user.viaBot) {
    throw Errors.forbidden('Only an owner can do this.');
  }
}

function contractorAdminsOnly() {
  return Errors.unprocessable(
    'CONTRACTOR_ADMINS_ONLY',
    'Contractor organizations have admins only in this version.',
  );
}
