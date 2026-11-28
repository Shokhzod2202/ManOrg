import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { type Request } from 'express';
import { type MembershipRole, type OrganizationType } from '../generated/prisma/client';
import { type DbContext } from '../database/prisma-client';
import { type BotAccess } from '../permissions/bot-access';
import { type EmployeeAccess } from '../permissions/employee-access';
import { type Actor, can, type Capability } from '../permissions/permissions';

/** Decided 2026-11-29: the API key an outside bot signed in with. */
export interface AgentKeyRef {
  id: string;
  name: string;
  access: 'read' | 'write';
  organizationId: string;
}

export interface AuthUser {
  userId: string;
  /** Set for a request made with an outside bot's API key; it then also acts as the bot. */
  agentKey?: AgentKeyRef;
  /** Set when the AI bot acts for this admin (spec section 10); audit rows then say "bot". */
  viaBot?: boolean;
}

/** The caller's verified, active membership in the organization named by X-Organization-Id. */
export interface OrgContext {
  organizationId: string;
  organizationType: OrganizationType;
  membershipId: string;
  role: MembershipRole;
  /** The matrix actor for this membership (spec section 2). */
  actor: Actor;
  /** The organization's resolved Employee access setting. */
  employeeAccess: EmployeeAccess;
  /** The organization's resolved Bot permissions setting. */
  botAccess: BotAccess;
  /** Decided 2026-11-26: the owner, an admin with power over the other admins. */
  owner: boolean;
  /** Decided 2026-11-26: an admin who also works shifts (punch card, shift lists, hours). */
  worksShifts: boolean;
}

/** Permission check inside a service, for parts of a response or action the route allows. */
export function orgCan(org: OrgContext, capability: Capability): boolean {
  return memberCan(org.actor, capability, org, org.worksShifts);
}

/**
 * The matrix, plus decided 2026-11-26: an admin switched on to work shifts also punches in and
 * out and asks for punch corrections, like an employee.
 */
export function memberCan(
  actor: Actor,
  capability: Capability,
  settings: Pick<OrgContext, 'employeeAccess' | 'botAccess'>,
  worksShifts: boolean,
): boolean {
  if (can(actor, capability, settings)) return true;
  return actor === 'org_admin' && worksShifts && ADMIN_WORKER_CAPABILITIES.has(capability);
}

const ADMIN_WORKER_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'punch.self',
  'punch.requestChange',
]);

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
