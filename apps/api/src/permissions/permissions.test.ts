import { describe, expect, it } from 'vitest';
import { resolveBotAccess } from './bot-access';
import { EMPLOYEE_ACCESS_KEYS, resolveEmployeeAccess } from './employee-access';
import {
  type Actor,
  actorFor,
  BOT_BY_SETTING,
  BOT_NEVER,
  CAPABILITIES,
  can,
  type Capability,
  grantFor,
  type OrgSettings,
} from './permissions';

const ACTORS: Actor[] = ['employee', 'org_admin', 'contractor_admin', 'bot'];
const ALL = Object.keys(CAPABILITIES) as Capability[];
const defaults: OrgSettings = {
  employeeAccess: resolveEmployeeAccess({}),
  botAccess: resolveBotAccess({}),
};
const allOpen: OrgSettings = {
  employeeAccess: Object.fromEntries(
    EMPLOYEE_ACCESS_KEYS.map((k) => [k, true]),
  ) as OrgSettings['employeeAccess'],
  botAccess: { decideApplications: true, manageMembers: true, manageEmployeeAccess: true },
};
const withEmployee = (patch: Partial<OrgSettings['employeeAccess']>): OrgSettings => ({
  ...defaults,
  employeeAccess: { ...defaults.employeeAccess, ...patch },
});

describe('actorFor', () => {
  it('maps organization type and role to the matrix actor', () => {
    expect(actorFor('provider', 'admin')).toBe('org_admin');
    expect(actorFor('provider', 'employee')).toBe('employee');
    expect(actorFor('contractor', 'admin')).toBe('contractor_admin');
    // Contractor organizations have admins only in v1 (open question 10).
    expect(actorFor('contractor', 'employee')).toBe('contractor_admin');
  });
});

describe('permission matrix (spec section 2)', () => {
  const phase0: [Capability, Record<Actor, boolean>][] = [
    [
      'applications.decide',
      { employee: false, org_admin: true, contractor_admin: false, bot: false },
    ],
    ['members.manage', { employee: false, org_admin: true, contractor_admin: true, bot: false }],
    [
      'organization.create',
      { employee: false, org_admin: true, contractor_admin: true, bot: false },
    ],
    [
      'organization.apply',
      { employee: true, org_admin: false, contractor_admin: true, bot: false },
    ],
  ];

  it.each(phase0)('%s is granted exactly as the spec says, by default', (capability, expected) => {
    for (const actor of ACTORS) {
      expect({ actor, allowed: can(actor, capability, defaults) }).toEqual({
        actor,
        allowed: expected[actor],
      });
    }
  });

  it('contractor admins create admins only in their own organization', () => {
    expect(grantFor('contractor_admin', 'members.manage')).toBe('own');
  });

  it('only employees punch and complete tasks, and only for themselves', () => {
    for (const capability of ['punch.self', 'tasks.complete', 'punch.requestChange'] as const) {
      expect(ACTORS.filter((a) => can(a, capability, allOpen))).toEqual(['employee']);
      expect(grantFor('employee', capability)).toBe('own');
    }
  });

  it('contractor admins see only their own orders, deliveries and payments', () => {
    for (const capability of [
      'organization.readAll',
      'orders.readHistory',
      'deliveries.read',
      'payments.view',
    ] as const) {
      expect({ capability, grant: grantFor('contractor_admin', capability) }).toEqual({
        capability,
        grant: 'own',
      });
    }
    expect(can('contractor_admin', 'shifts.read', allOpen)).toBe(false);
  });

  it('lists every actor for every capability', () => {
    for (const [capability, grants] of Object.entries(CAPABILITIES)) {
      expect({ capability, actors: Object.keys(grants).sort() }).toEqual({
        capability,
        actors: [...ACTORS].sort(),
      });
    }
  });
});

describe('AI bot (decided 2026-11-13)', () => {
  it('has the provider admin’s grants, except setting-dependent and never-allowed ones', () => {
    for (const capability of ALL) {
      if (BOT_NEVER.has(capability) || BOT_BY_SETTING[capability]) continue;
      expect({ capability, bot: grantFor('bot', capability) }).toEqual({
        capability,
        bot: grantFor('org_admin', capability),
      });
    }
  });

  it('sees the orders, the monthly list, payments and finance', () => {
    for (const capability of [
      'orders.readDueNext',
      'orders.readHistory',
      'deliveries.read',
      'payments.view',
      'payments.review',
      'finance.view',
      'settlement.view',
      'prices.manage',
      'ingredients.readPrices',
    ] as const) {
      expect({ capability, bot: can('bot', capability, defaults) }).toEqual({
        capability,
        bot: true,
      });
    }
  });

  it('approves applications, manages admins or changes employee access only when switched on', () => {
    const cases = [
      ['applications.decide', 'decideApplications'],
      ['members.manage', 'manageMembers'],
      ['employeeAccess.manage', 'manageEmployeeAccess'],
    ] as const;
    for (const [capability, key] of cases) {
      expect(can('bot', capability, defaults)).toBe(false);
      expect(
        can('bot', capability, { ...defaults, botAccess: { ...defaults.botAccess, [key]: true } }),
      ).toBe(true);
    }
  });

  it('can never change its own permissions or join organizations, whatever is switched on', () => {
    for (const capability of [
      'botAccess.manage',
      'organization.create',
      'organization.apply',
    ] as const) {
      expect(can('bot', capability, allOpen)).toBe(false);
    }
  });

  it('never acts as an employee or a contractor for them', () => {
    for (const capability of [
      'punch.self',
      'tasks.complete',
      'orders.place',
      'deliveries.confirm',
      'payments.submit',
    ] as const) {
      expect(can('bot', capability, allOpen)).toBe(false);
    }
  });

  it('bot switches never give employees anything', () => {
    for (const capability of Object.keys(BOT_BY_SETTING) as Capability[]) {
      expect(can('employee', capability, allOpen)).toBe(false);
    }
  });
});

describe('employee access setting (decided 2026-11-12)', () => {
  const gated = ALL.filter((c) => typeof grantFor('employee', c) === 'object');

  it('can only ever open read access, never writes', () => {
    expect(gated.length).toBeGreaterThan(0);
    for (const capability of gated) {
      expect(capability).toMatch(/\.(read\w*|view)$/);
    }
  });

  it('starts with everyone’s shifts and the orders due next open, everything else closed', () => {
    expect(gated.filter((c) => can('employee', c, defaults)).sort()).toEqual([
      'orders.readDueNext',
      'shifts.read',
    ]);
  });

  it('follows each switch', () => {
    expect(can('employee', 'orders.readHistory', defaults)).toBe(false);
    expect(can('employee', 'orders.readHistory', withEmployee({ ordersHistory: true }))).toBe(true);
    expect(can('employee', 'payments.view', withEmployee({ finance: true }))).toBe(true);
    expect(can('employee', 'orders.readDueNext', withEmployee({ ordersDueNext: false }))).toBe(
      false,
    );
  });

  it('is denied when the settings are unknown', () => {
    expect(can('employee', 'shifts.read')).toBe(false);
  });

  it('never lets employees edit orders, touch money or change settings, whatever is switched on', () => {
    for (const capability of [
      'orders.edit',
      'orders.place',
      'payments.review',
      'payments.submit',
      'prices.manage',
      'settlement.edit',
      'settlement.close',
      'employeeAccess.manage',
      'botAccess.manage',
    ] as const) {
      expect(can('employee', capability, allOpen)).toBe(false);
    }
  });
});

describe('resolveEmployeeAccess', () => {
  it('fills missing areas with defaults and ignores unknown or malformed values', () => {
    expect(resolveEmployeeAccess({ ordersHistory: true, finance: 'yes', bogus: true })).toEqual({
      ...defaults.employeeAccess,
      ordersHistory: true,
    });
    expect(resolveEmployeeAccess(null)).toEqual(defaults.employeeAccess);
  });
});
