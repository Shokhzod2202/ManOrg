import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { assertNoOpenMembership, createMembershipOnce } from '../common/memberships';
import { pageArgs, toPage } from '../common/pagination';
import { type AuthUser, type OrgContext, dbContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import {
  type CreateMemberInput,
  type ListMembersInput,
  type UpdateMemberInput,
} from './members.schemas';

const userFields = { id: true, name: true, email: true } as const;

type MemberRow = {
  id: string;
  role: 'admin' | 'employee';
  status: 'pending' | 'active' | 'rejected' | 'removed';
  version: number;
  createdAt: Date;
  user: { id: string; name: string; email: string | null };
};

function present(m: MemberRow) {
  return {
    id: m.id,
    role: m.role,
    status: m.status,
    version: m.version,
    user: m.user,
    createdAt: m.createdAt,
  };
}

/** ACC-7: admins add admins and change account types inside their organization. */
@Injectable()
export class MembersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(user: AuthUser, org: OrgContext, input: ListMembersInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.membership.findMany({
        where: { organizationId: org.organizationId, status: input.status },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { user: { select: userFields } },
        ...pageArgs(input),
      });
      return toPage(rows, input, present);
    });
  }

  create(user: AuthUser, org: OrgContext, input: CreateMemberInput) {
    if (org.organizationType === 'contractor' && input.role !== 'admin')
      throw contractorAdminsOnly();
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
      await assertNoOpenMembership(tx, person.id, 'they');
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
        actor: userActor(user.userId),
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
      const losesAdmin =
        before.role === 'admin' && (input.status === 'removed' || input.role === 'employee');
      if (losesAdmin) await this.assertAnotherAdmin(tx, org.organizationId, before.id);

      const result = await tx.membership.updateMany({
        where: { id, version },
        data: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
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
        actor: userActor(user.userId),
        action: input.status === 'removed' ? 'membership.remove' : 'membership.role_change',
        entity: 'membership',
        entityId: id,
        before,
        after: { ...after, user: undefined },
      });
      return present(after);
    });
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

function contractorAdminsOnly() {
  return Errors.unprocessable(
    'CONTRACTOR_ADMINS_ONLY',
    'Contractor organizations have admins only in this version.',
  );
}
