import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { type Request } from 'express';
import { type MembershipRole, type OrganizationType } from '../generated/prisma/client';
import { type DbContext } from '../database/prisma-client';
import { type Capability } from '../permissions/permissions';

export interface AuthUser {
  userId: string;
}

/** The caller's verified, active membership in the organization named by X-Organization-Id. */
export interface OrgContext {
  organizationId: string;
  organizationType: OrganizationType;
  membershipId: string;
  role: MembershipRole;
}

export interface AppRequest extends Request {
  user?: AuthUser;
  org?: OrgContext;
}

export const IS_PUBLIC = 'manorg:isPublic';
export const ORG_REQUIREMENT = 'manorg:orgRequirement';

export type OrgRequirement =
  { kind: 'required'; capability?: Capability } | { kind: 'optional'; capability?: Capability };

/** No access token needed. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * The route acts inside one organization: X-Organization-Id is required, the caller must hold an
 * active membership there (else 404), and their role must allow `capability` (else 403).
 */
export const RequireOrg = (capability?: Capability) =>
  SetMetadata(ORG_REQUIREMENT, { kind: 'required', capability } satisfies OrgRequirement);

/** Like RequireOrg, but X-Organization-Id may be left out (the caller acts as themselves). */
export const OptionalOrg = (capability?: Capability) =>
  SetMetadata(ORG_REQUIREMENT, { kind: 'optional', capability } satisfies OrgRequirement);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AppRequest>().user;
  if (!user) throw new Error('CurrentUser used on a public route');
  return user;
});

export const CurrentOrg = createParamDecorator((_: unknown, ctx: ExecutionContext): OrgContext => {
  const org = ctx.switchToHttp().getRequest<AppRequest>().org;
  if (!org) throw new Error('CurrentOrg used on a route without RequireOrg');
  return org;
});

export const OptionalCurrentOrg = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): OrgContext | undefined =>
    ctx.switchToHttp().getRequest<AppRequest>().org,
);

/** The database context for a caller, optionally inside an organization. */
export function dbContext(user: AuthUser, org?: OrgContext): DbContext {
  return { userId: user.userId, organizationId: org?.organizationId ?? null };
}
