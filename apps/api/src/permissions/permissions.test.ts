import { describe, expect, it } from 'vitest';
import { type Actor, actorFor, CAPABILITIES, can, type Capability, grantFor } from './permissions';

const ACTORS: Actor[] = ['employee', 'org_admin', 'contractor_admin', 'bot'];

describe('actorFor', () => {
  it('maps organization type and role to the matrix actor', () => {
    expect(actorFor('bakery', 'admin')).toBe('org_admin');
    expect(actorFor('bakery', 'employee')).toBe('employee');
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

  it.each(phase0)('%s is granted exactly as the spec says', (capability, expected) => {
    for (const actor of ACTORS) {
      expect({ actor, allowed: can(actor, capability) }).toEqual({
        actor,
        allowed: expected[actor],
      });
    }
  });

  it('contractor admins create admins only in their own organization', () => {
    expect(grantFor('contractor_admin', 'members.manage')).toBe('own');
  });

  it('never lets the bot approve people, manage admins or create organizations', () => {
    for (const capability of [
      'applications.decide',
      'members.manage',
      'organization.create',
      'organization.apply',
    ] as const) {
      expect(can('bot', capability)).toBe(false);
    }
  });

  it('only employees punch and complete tasks, and only for themselves', () => {
    for (const capability of ['punch.self', 'tasks.complete', 'punch.requestChange'] as const) {
      expect(ACTORS.filter((a) => can(a, capability))).toEqual(['employee']);
      expect(grantFor('employee', capability)).toBe('own');
    }
  });

  it('contractor admins see only their own orders', () => {
    expect(grantFor('contractor_admin', 'organization.readAll')).toBe('own');
    expect(can('contractor_admin', 'shifts.read')).toBe(false);
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
