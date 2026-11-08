import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import {
  assertNoOpenMembership,
  assertReapplyAllowed,
  createMembershipOnce,
} from '../common/memberships';
import { pageArgs, toPage } from '../common/pagination';
import { type AuthUser, type OrgContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { switchOrganization, type Tx } from '../database/prisma-client';
import { env } from '../config/env';
import {
  type CreateOrganizationInput,
  type SearchOrganizationsInput,
} from './organizations.schemas';

const poolFields = { id: true, name: true, type: true } as const;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** ACC-3: the searchable account pool. Only id, name and type are public. */
  search(user: AuthUser, input: SearchOrganizationsInput) {
    return this.db.run({ organizationId: null, userId: user.userId }, async (tx) => {
      const rows = await tx.organization.findMany({
        where: input.q ? { name: { contains: input.q, mode: 'insensitive' } } : {},
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: poolFields,
        ...pageArgs(input),
      });
      return toPage(rows, input, (r) => r);
    });
  }

  /** ACC-4: the creator becomes the first admin. */
  create(user: AuthUser, input: CreateOrganizationInput) {
    const organizationId = randomUUID();
    return this.db.run({ organizationId: null, userId: user.userId }, async (tx) => {
      await assertNoOpenMembership(tx, user.userId, 'you');
      const org = await tx.organization.create({
        data: {
          id: organizationId,
          name: input.name,
          type: input.type,
          timezone: input.timezone ?? env().APP_TIMEZONE_DEFAULT,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          createdById: user.userId,
        },
      });
      await switchOrganization(tx, org.id);
      const membership = await createMembershipOnce(
        () =>
          tx.membership.create({
            data: { organizationId: org.id, userId: user.userId, role: 'admin', status: 'active' },
          }),
        'you',
      );
      await this.audit.record(tx, {
        organizationId: org.id,
        actor: userActor(user.userId),
        action: 'organization.create',
        entity: 'organization',
        entityId: org.id,
        after: org,
      });
      await this.audit.record(tx, {
        organizationId: org.id,
        actor: userActor(user.userId),
        action: 'membership.create',
        entity: 'membership',
        entityId: membership.id,
        after: membership,
      });
      return {
        organization: {
          id: org.id,
          name: org.name,
          type: org.type,
          timezone: org.timezone,
          version: org.version,
        },
        membership: { id: membership.id, role: membership.role, status: membership.status },
      };
    });
  }

  /**
   * ACC-5 / ACC-6. Without an organization context a user applies to join a bakery as an
   * employee. With a contractor organization's context, its admin applies for that contractor to
   * buy from the bakery.
   */
  apply(user: AuthUser, org: OrgContext | undefined, targetId: string) {
    return this.db.run(
      { organizationId: org?.organizationId ?? null, userId: user.userId },
      async (tx) => {
        const target = await tx.organization.findUnique({
          where: { id: targetId },
          select: poolFields,
        });
        if (!target) throw Errors.notFound('Organization');
        if (target.type !== 'bakery') {
          throw Errors.unprocessable(
            'CONTRACTOR_ADMINS_ONLY',
            'Contractor organizations have admins only; ask an admin to add you.',
          );
        }
        if (org) return this.applyAsContractor(tx, user, org, target);
        return this.applyAsEmployee(tx, user, target);
      },
    );
  }

  private async applyAsEmployee(
    tx: Tx,
    user: AuthUser,
    target: { id: string; name: string; type: 'bakery' | 'contractor' },
  ) {
    await assertNoOpenMembership(tx, user.userId, 'you');
    const lastRejected = await tx.membership.findFirst({
      where: { userId: user.userId, organizationId: target.id, status: 'rejected' },
      orderBy: { decidedAt: 'desc' },
      select: { decidedAt: true },
    });
    assertReapplyAllowed(lastRejected?.decidedAt);
    const membership = await createMembershipOnce(
      () =>
        tx.membership.create({
          data: {
            organizationId: target.id,
            userId: user.userId,
            role: 'employee',
            status: 'pending',
          },
        }),
      'you',
    );
    // The applicant is not in the organization yet, so the entry is account-level.
    await this.audit.record(tx, {
      organizationId: null,
      actor: userActor(user.userId),
      action: 'membership.apply',
      entity: 'membership',
      entityId: membership.id,
      after: membership,
    });
    return {
      id: membership.id,
      kind: 'employee' as const,
      status: membership.status,
      organization: target,
      createdAt: membership.createdAt,
    };
  }

  private async applyAsContractor(
    tx: Tx,
    user: AuthUser,
    org: OrgContext,
    target: { id: string; name: string; type: 'bakery' | 'contractor' },
  ) {
    if (org.organizationType !== 'contractor') {
      throw Errors.forbidden('Only a contractor organization can apply to buy from a bakery.');
    }
    const existing = await tx.contractorLink.findFirst({
      where: {
        organizationId: target.id,
        contractorOrgId: org.organizationId,
        status: { in: ['pending', 'approved'] },
      },
      select: { status: true },
    });
    if (existing) {
      throw Errors.conflict(
        existing.status === 'approved' ? 'ALREADY_LINKED' : 'ALREADY_APPLIED',
        existing.status === 'approved'
          ? 'Your organization is already approved by this bakery.'
          : 'Your organization has already applied to this bakery.',
      );
    }
    const lastRejected = await tx.contractorLink.findFirst({
      where: { organizationId: target.id, contractorOrgId: org.organizationId, status: 'rejected' },
      orderBy: { decidedAt: 'desc' },
      select: { decidedAt: true },
    });
    assertReapplyAllowed(lastRejected?.decidedAt);
    const link = await tx.contractorLink.create({
      data: {
        organizationId: target.id,
        contractorOrgId: org.organizationId,
        status: 'pending',
        requestedById: user.userId,
      },
    });
    await this.audit.record(tx, {
      organizationId: org.organizationId,
      actor: userActor(user.userId),
      action: 'contractor_link.apply',
      entity: 'contractor_link',
      entityId: link.id,
      after: link,
    });
    return {
      id: link.id,
      kind: 'contractor' as const,
      status: link.status,
      organization: target,
      createdAt: link.createdAt,
    };
  }
}
