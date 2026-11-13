import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { Errors } from '../common/errors';
import { type AppRequest, ORG_REQUIREMENT, type OrgRequirement } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { resolveEmployeeAccess } from './employee-access';
import { actorFor, can } from './permissions';

const uuid = z.uuid();

/**
 * Global, runs after JwtAuthGuard. For routes marked @RequireOrg / @OptionalOrg it turns the
 * X-Organization-Id header into a verified active membership (the server never trusts the header
 * alone, spec section 12) and checks the permission matrix.
 * - header missing on a RequireOrg route: 400
 * - no active membership in that organization: 404, so other organizations' ids reveal nothing
 * - membership exists but the role lacks the capability: 403 (for employees, some reads follow
 *   the organization's Employee access setting)
 * Membership is read on every request, so role changes apply on the next request (ACC-7).
 */
@Injectable()
export class OrgContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<OrgRequirement | undefined>(
      ORG_REQUIREMENT,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    const user = req.user;
    if (!user) throw Errors.unauthenticated();

    const header = req.header('x-organization-id');
    if (!header) {
      if (requirement.kind === 'optional') return true;
      throw Errors.badRequest('ORGANIZATION_REQUIRED', 'Send the X-Organization-Id header.');
    }
    if (!uuid.safeParse(header).success) {
      throw Errors.badRequest('INVALID_ORGANIZATION_ID', 'X-Organization-Id must be a UUID.');
    }

    const membership = await this.db.run({ organizationId: null, userId: user.userId }, (tx) =>
      tx.membership.findFirst({
        where: { userId: user.userId, organizationId: header, status: 'active' },
        select: {
          id: true,
          role: true,
          organization: { select: { id: true, type: true, employeeAccess: true } },
        },
      }),
    );
    if (!membership) throw Errors.notFound('Organization');

    const actor = actorFor(membership.organization.type, membership.role);
    const access = resolveEmployeeAccess(membership.organization.employeeAccess);
    if (requirement.capability && !can(actor, requirement.capability, access)) {
      throw Errors.forbidden();
    }

    req.org = {
      organizationId: membership.organization.id,
      organizationType: membership.organization.type,
      membershipId: membership.id,
      role: membership.role,
    };
    return true;
  }
}
