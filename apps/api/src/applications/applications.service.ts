import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, type OrgContext, dbContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';

type Decision = 'approve' | 'reject';

const userFields = { id: true, name: true, email: true } as const;

/** ACC-5 and ACC-6: a bakery admin reviews employees and contractors who applied. */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const [memberships, links] = await Promise.all([
        tx.membership.findMany({
          where: { organizationId: org.organizationId, status: 'pending' },
          orderBy: { createdAt: 'asc' },
          include: { user: { select: userFields } },
        }),
        tx.contractorLink.findMany({
          where: { organizationId: org.organizationId, status: 'pending' },
          orderBy: { createdAt: 'asc' },
          include: { contractor: { select: { id: true, name: true, type: true } } },
        }),
      ]);
      const requesters = await tx.user.findMany({
        where: { id: { in: links.map((l) => l.requestedById) } },
        select: userFields,
      });
      const byId = new Map(requesters.map((u) => [u.id, u]));
      const items = [
        ...memberships.map((m) => ({
          id: m.id,
          kind: 'employee' as const,
          status: m.status,
          applicant: m.user,
          contractor: null,
          createdAt: m.createdAt,
        })),
        ...links.map((l) => ({
          id: l.id,
          kind: 'contractor' as const,
          status: l.status,
          applicant: byId.get(l.requestedById) ?? null,
          contractor: l.contractor,
          createdAt: l.createdAt,
        })),
      ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      // Pending applications are few; the whole queue is returned as one page.
      return { items, nextCursor: null };
    });
  }

  decide(user: AuthUser, org: OrgContext, id: string, decision: Decision) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (membership) return this.decideMembership(tx, user, org, membership, decision);
      const link = await tx.contractorLink.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (link) return this.decideLink(tx, user, org, link, decision);
      throw Errors.notFound('Application');
    });
  }

  private async decideMembership(
    tx: Tx,
    user: AuthUser,
    org: OrgContext,
    before: Awaited<ReturnType<Tx['membership']['findFirstOrThrow']>>,
    decision: Decision,
  ) {
    if (before.status !== 'pending') throw notPending();
    const now = new Date();
    const result = await tx.membership.updateMany({
      where: { id: before.id, status: 'pending' },
      data: {
        status: decision === 'approve' ? 'active' : 'rejected',
        decidedById: user.userId,
        decidedAt: now,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw notPending();
    const after = await tx.membership.findUniqueOrThrow({
      where: { id: before.id },
      include: { user: { select: userFields } },
    });
    await this.audit.record(tx, {
      organizationId: org.organizationId,
      actor: userActor(user.userId),
      action: `membership.${decision}`,
      entity: 'membership',
      entityId: before.id,
      before,
      after: { ...after, user: undefined },
    });
    return {
      id: after.id,
      kind: 'employee' as const,
      status: after.status,
      applicant: after.user,
      contractor: null,
      createdAt: after.createdAt,
    };
  }

  private async decideLink(
    tx: Tx,
    user: AuthUser,
    org: OrgContext,
    before: Awaited<ReturnType<Tx['contractorLink']['findFirstOrThrow']>>,
    decision: Decision,
  ) {
    if (before.status !== 'pending') throw notPending();
    const result = await tx.contractorLink.updateMany({
      where: { id: before.id, status: 'pending' },
      data: {
        status: decision === 'approve' ? 'approved' : 'rejected',
        decidedById: user.userId,
        decidedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw notPending();
    const after = await tx.contractorLink.findUniqueOrThrow({
      where: { id: before.id },
      include: { contractor: { select: { id: true, name: true, type: true } } },
    });
    await this.audit.record(tx, {
      organizationId: org.organizationId,
      actor: userActor(user.userId),
      action: `contractor_link.${decision}`,
      entity: 'contractor_link',
      entityId: before.id,
      before,
      after: { ...after, contractor: undefined },
    });
    const applicant = await tx.user.findUnique({
      where: { id: after.requestedById },
      select: userFields,
    });
    return {
      id: after.id,
      kind: 'contractor' as const,
      status: after.status,
      applicant,
      contractor: after.contractor,
      createdAt: after.createdAt,
    };
  }
}

function notPending() {
  return Errors.conflict('NOT_PENDING', 'This application has already been decided.');
}
