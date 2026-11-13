import { type MembershipRole, type OrganizationType } from '../generated/prisma/client';
import { type EmployeeAccess, type EmployeeAccessKey } from './employee-access';

/**
 * Permission matrix from docs/SPEC.md section 2 and docs/F-001.md section 3, with the product
 * owner's decisions in docs/DECISIONS.md. Checked on the server only (CLAUDE.md rule 2).
 *
 * Actors:
 * - employee          an employee of a bakery organization
 * - org_admin         an admin of a bakery organization ("Organization Admin" / "Bakery Admin")
 * - contractor_admin  an admin of a contractor organization
 * - bot               the AI bot acting inside one organization for its admin (phase 2)
 *
 * Grants: 'any' (all records in the organization), 'own' (the caller's own records; services
 * enforce the "own" part), false, or { setting } for employee reads the admin switches on or off
 * in Employee access.
 */
export type Actor = 'employee' | 'org_admin' | 'contractor_admin' | 'bot';
export type Grant = 'any' | 'own' | false | { setting: EmployeeAccessKey };
type Row = { employee: Grant; org_admin: Grant; contractor_admin: Grant };

const setting = (key: EmployeeAccessKey) => ({ setting: key }) as const;

const MATRIX = {
  // Spec section 2, main table
  'organization.create': { employee: false, org_admin: 'any', contractor_admin: 'any' },
  'organization.apply': { employee: 'own', org_admin: false, contractor_admin: 'own' },
  'applications.decide': { employee: false, org_admin: 'any', contractor_admin: false },
  'members.manage': { employee: false, org_admin: 'any', contractor_admin: 'own' },
  'shifts.set': { employee: false, org_admin: 'any', contractor_admin: false },
  'shifts.read': { employee: setting('allShifts'), org_admin: 'any', contractor_admin: false },
  'punch.self': { employee: 'own', org_admin: false, contractor_admin: false },
  'punch.edit': { employee: false, org_admin: 'any', contractor_admin: false },
  'punch.requestChange': { employee: 'own', org_admin: false, contractor_admin: false },
  'output.log': { employee: 'own', org_admin: 'any', contractor_admin: false },
  'tasks.manage': { employee: false, org_admin: 'any', contractor_admin: false },
  'tasks.complete': { employee: 'own', org_admin: false, contractor_admin: false },
  'products.manage': { employee: false, org_admin: 'any', contractor_admin: false },
  'products.setAvailability': { employee: false, org_admin: 'any', contractor_admin: false },
  'ingredients.manage': { employee: false, org_admin: 'any', contractor_admin: false },
  'orders.place': { employee: false, org_admin: false, contractor_admin: 'own' },
  'orders.edit': { employee: false, org_admin: 'any', contractor_admin: 'own' },
  'deliveries.record': { employee: false, org_admin: 'any', contractor_admin: false },
  'deliveries.confirm': { employee: false, org_admin: false, contractor_admin: 'own' },
  'deliveries.requestChange': { employee: false, org_admin: false, contractor_admin: 'own' },
  'deliveries.decideChange': { employee: false, org_admin: 'any', contractor_admin: false },
  'organization.readAll': { employee: false, org_admin: 'any', contractor_admin: 'own' },
  'ingredients.order': { employee: 'any', org_admin: 'any', contractor_admin: false },
  'ingredients.fulfil': { employee: false, org_admin: 'any', contractor_admin: false },
  'ingredients.assignResponsibility': {
    employee: false,
    org_admin: 'any',
    contractor_admin: false,
  },
  'teams.manage': { employee: 'own', org_admin: false, contractor_admin: false },
  // Spec section 2, "Added capabilities"
  'output.logTeam': { employee: 'own', org_admin: 'any', contractor_admin: false },

  // Reads employees get when the admin opens the area in Employee access (decided 2026-11-12).
  'orders.readDueNext': {
    employee: setting('ordersDueNext'),
    org_admin: 'any',
    contractor_admin: false,
  },
  'orders.readHistory': {
    employee: setting('ordersHistory'),
    org_admin: 'any',
    contractor_admin: 'own',
  },
  'deliveries.read': { employee: setting('deliveries'), org_admin: 'any', contractor_admin: 'own' },
  'output.readAll': { employee: setting('outputAll'), org_admin: 'any', contractor_admin: false },
  'ingredients.readPrices': {
    employee: setting('ingredientPrices'),
    org_admin: 'any',
    contractor_admin: false,
  },
  'employeeAccess.manage': { employee: false, org_admin: 'any', contractor_admin: false },

  // docs/F-001.md section 3 (built after the MVP gate)
  'prices.manage': { employee: false, org_admin: 'any', contractor_admin: false },
  'finance.view': { employee: setting('finance'), org_admin: 'any', contractor_admin: 'own' },
  'payments.submit': { employee: false, org_admin: false, contractor_admin: 'own' },
  'payments.view': { employee: setting('finance'), org_admin: 'any', contractor_admin: 'own' },
  'payments.review': { employee: false, org_admin: 'any', contractor_admin: false },
  'settlement.edit': { employee: false, org_admin: 'any', contractor_admin: false },
  'settlement.view': { employee: setting('finance'), org_admin: 'any', contractor_admin: 'own' },
  'settlement.close': { employee: false, org_admin: 'any', contractor_admin: false },
} as const satisfies Record<string, Row>;

export type Capability = keyof typeof MATRIX;

/**
 * The bot acts for the bakery admin and can see and do everything the admin can (decided
 * 2026-11-13), except these. Every bot write is still previewed and confirmed by the admin and
 * audited as the bot (spec section 10); no bot tool deletes anything (CLAUDE.md rule 7).
 */
export const BOT_EXCLUDED: ReadonlySet<Capability> = new Set<Capability>([
  // Spec section 10: no tool changes roles or admins; access decisions stay with a person.
  'members.manage',
  'applications.decide',
  'employeeAccess.manage',
  // Creating or joining organizations is done by a person for themselves.
  'organization.create',
  'organization.apply',
]);

export const CAPABILITIES: Record<Capability, Record<Actor, Grant>> = Object.fromEntries(
  (Object.entries(MATRIX) as [Capability, Row][]).map(([capability, row]) => [
    capability,
    { ...row, bot: BOT_EXCLUDED.has(capability) ? false : row.org_admin },
  ]),
) as Record<Capability, Record<Actor, Grant>>;

export function actorFor(organizationType: OrganizationType, role: MembershipRole): Actor {
  if (organizationType === 'contractor') return 'contractor_admin';
  return role === 'admin' ? 'org_admin' : 'employee';
}

export function grantFor(actor: Actor, capability: Capability): Grant {
  return CAPABILITIES[capability][actor];
}

/**
 * Whether the actor may use the capability. Setting-gated grants need the organization's
 * resolved Employee access; without it they are denied.
 */
export function can(actor: Actor, capability: Capability, access?: EmployeeAccess): boolean {
  const grant = grantFor(actor, capability);
  if (grant === false) return false;
  if (typeof grant === 'object') return access?.[grant.setting] === true;
  return true;
}
