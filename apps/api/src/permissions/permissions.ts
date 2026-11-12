import { type MembershipRole, type OrganizationType } from '../generated/prisma/client';

/**
 * Permission matrix from docs/SPEC.md section 2, one entry per row, checked on the server only
 * (CLAUDE.md rule 2). "own" means the caller's own records; services enforce the "own" part.
 *
 * Actors:
 * - employee          an employee of a bakery organization
 * - org_admin         an admin of a bakery organization ("Organization Admin" / "Bakery Admin")
 * - contractor_admin  an admin of a contractor organization
 * - bot               the AI bot acting inside one organization (phase 2)
 */
export type Actor = 'employee' | 'org_admin' | 'contractor_admin' | 'bot';
export type Grant = 'any' | 'own' | false;

export const CAPABILITIES = {
  // Section 2, main table
  'organization.create': { employee: false, org_admin: 'any', contractor_admin: 'any', bot: false },
  'organization.apply': { employee: 'own', org_admin: false, contractor_admin: 'own', bot: false },
  'applications.decide': { employee: false, org_admin: 'any', contractor_admin: false, bot: false },
  'members.manage': { employee: false, org_admin: 'any', contractor_admin: 'own', bot: false },
  'shifts.set': { employee: false, org_admin: 'any', contractor_admin: false, bot: 'any' },
  'shifts.read': { employee: 'any', org_admin: 'any', contractor_admin: false, bot: 'any' },
  'punch.self': { employee: 'own', org_admin: false, contractor_admin: false, bot: false },
  'punch.edit': { employee: false, org_admin: 'any', contractor_admin: false, bot: 'any' },
  'punch.requestChange': { employee: 'own', org_admin: false, contractor_admin: false, bot: false },
  'output.log': { employee: 'own', org_admin: 'any', contractor_admin: false, bot: 'any' },
  'tasks.manage': { employee: false, org_admin: 'any', contractor_admin: false, bot: 'any' },
  'tasks.complete': { employee: 'own', org_admin: false, contractor_admin: false, bot: false },
  'products.manage': { employee: false, org_admin: 'any', contractor_admin: false, bot: 'any' },
  'products.setAvailability': {
    employee: false,
    org_admin: 'any',
    contractor_admin: false,
    bot: 'any',
  },
  'ingredients.manage': { employee: false, org_admin: 'any', contractor_admin: false, bot: 'any' },
  'orders.place': { employee: false, org_admin: false, contractor_admin: 'own', bot: false },
  'orders.edit': { employee: false, org_admin: 'any', contractor_admin: 'own', bot: false },
  'deliveries.record': { employee: false, org_admin: 'any', contractor_admin: false, bot: 'any' },
  'deliveries.confirm': { employee: false, org_admin: false, contractor_admin: 'own', bot: false },
  'deliveries.requestChange': {
    employee: false,
    org_admin: false,
    contractor_admin: 'own',
    bot: false,
  },
  'deliveries.decideChange': {
    employee: false,
    org_admin: 'any',
    contractor_admin: false,
    bot: false,
  },
  'organization.readAll': {
    employee: false,
    org_admin: 'any',
    contractor_admin: 'own',
    bot: 'any',
  },
  'ingredients.order': { employee: 'any', org_admin: 'any', contractor_admin: false, bot: false },
  'ingredients.fulfil': { employee: false, org_admin: 'any', contractor_admin: false, bot: false },
  'ingredients.assignResponsibility': {
    employee: false,
    org_admin: 'any',
    contractor_admin: false,
    bot: false,
  },
  'teams.manage': { employee: 'own', org_admin: false, contractor_admin: false, bot: false },
  // Section 2, "Added capabilities"
  'output.logTeam': { employee: 'own', org_admin: 'any', contractor_admin: false, bot: 'any' },
  // Decided 2026-11-12 (docs/DECISIONS.md): employees read the orders due next (TOD-1 to TOD-7)
  // but never edit them; the monthly orders list is for admins and each contractor's own admin.
  'orders.readDueNext': { employee: 'any', org_admin: 'any', contractor_admin: false, bot: 'any' },
  'orders.readHistory': { employee: false, org_admin: 'any', contractor_admin: 'own', bot: false },
  // docs/F-001.md section 3 (built after the MVP gate). Employees and the bot have no access to
  // financial data; payment confirmations are seen by the bakery admin and the contractor's own admin.
  'prices.manage': { employee: false, org_admin: 'any', contractor_admin: false, bot: false },
  'finance.view': { employee: false, org_admin: 'any', contractor_admin: 'own', bot: false },
  'payments.submit': { employee: false, org_admin: false, contractor_admin: 'own', bot: false },
  'payments.view': { employee: false, org_admin: 'any', contractor_admin: 'own', bot: false },
  'payments.review': { employee: false, org_admin: 'any', contractor_admin: false, bot: false },
  'settlement.edit': { employee: false, org_admin: 'any', contractor_admin: false, bot: false },
  'settlement.view': { employee: false, org_admin: 'any', contractor_admin: 'own', bot: false },
  'settlement.close': { employee: false, org_admin: 'any', contractor_admin: false, bot: false },
} as const satisfies Record<string, Record<Actor, Grant>>;

export type Capability = keyof typeof CAPABILITIES;

export function actorFor(organizationType: OrganizationType, role: MembershipRole): Actor {
  if (organizationType === 'contractor') return 'contractor_admin';
  return role === 'admin' ? 'org_admin' : 'employee';
}

export function grantFor(actor: Actor, capability: Capability): Grant {
  return CAPABILITIES[capability][actor];
}

export function can(actor: Actor, capability: Capability): boolean {
  return grantFor(actor, capability) !== false;
}
