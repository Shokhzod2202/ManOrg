import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { type AppRequest, type OrgRequirement } from '../common/request-context';
import { type DatabaseService } from '../database/database.service';
import { OrgContextGuard } from './org-context.guard';

const ORG = '6f1c2f8e-9a51-4d0e-8a7e-1b1f2b3c4d5e';

function setup(opts: {
  requirement?: OrgRequirement;
  header?: string;
  membership?: { role: 'admin' | 'employee'; type: 'bakery' | 'contractor' } | null;
  employeeAccess?: Record<string, boolean>;
}) {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(opts.requirement),
  } as unknown as Reflector;
  const findFirst = vi.fn().mockResolvedValue(
    opts.membership
      ? {
          id: 'm-1',
          role: opts.membership.role,
          organization: {
            id: ORG,
            type: opts.membership.type,
            employeeAccess: opts.employeeAccess ?? {},
          },
        }
      : null,
  );
  const db = {
    run: vi.fn((_ctx, fn) => fn({ membership: { findFirst } })),
  } as unknown as DatabaseService;
  const req = {
    user: { userId: 'u-1' },
    header: (name: string) => (name === 'x-organization-id' ? opts.header : undefined),
  } as unknown as AppRequest;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { guard: new OrgContextGuard(reflector, db), context, req, findFirst };
}

describe('OrgContextGuard', () => {
  it('ignores routes that do not act inside an organization', async () => {
    const { guard, context, findFirst } = setup({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('requires the header on RequireOrg routes', async () => {
    const { guard, context } = setup({ requirement: { kind: 'required' } });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 400 });
  });

  it('lets an OptionalOrg route through without the header', async () => {
    const { guard, context, req } = setup({ requirement: { kind: 'optional' } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.org).toBeUndefined();
  });

  it('rejects a malformed organization id', async () => {
    const { guard, context } = setup({ requirement: { kind: 'required' }, header: 'abc' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 400 });
  });

  it('answers 404 when the caller has no active membership there', async () => {
    const { guard, context, findFirst } = setup({
      requirement: { kind: 'required' },
      header: ORG,
      membership: null,
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 404 });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-1', organizationId: ORG, status: 'active' } }),
    );
  });

  it('answers 403 when the role lacks the capability', async () => {
    const { guard, context } = setup({
      requirement: { kind: 'required', capability: 'applications.decide' },
      header: ORG,
      membership: { role: 'employee', type: 'bakery' },
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });

  it('denies contractor admins the bakery-only approval capability', async () => {
    const { guard, context } = setup({
      requirement: { kind: 'required', capability: 'applications.decide' },
      header: ORG,
      membership: { role: 'admin', type: 'contractor' },
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });

  it('lets an employee read an area only while the organization has it switched on', async () => {
    const closed = setup({
      requirement: { kind: 'required', capability: 'orders.readHistory' },
      header: ORG,
      membership: { role: 'employee', type: 'bakery' },
    });
    await expect(closed.guard.canActivate(closed.context)).rejects.toMatchObject({ status: 403 });
    const open = setup({
      requirement: { kind: 'required', capability: 'orders.readHistory' },
      header: ORG,
      membership: { role: 'employee', type: 'bakery' },
      employeeAccess: { ordersHistory: true },
    });
    await expect(open.guard.canActivate(open.context)).resolves.toBe(true);
  });

  it('attaches the verified membership when allowed', async () => {
    const { guard, context, req } = setup({
      requirement: { kind: 'required', capability: 'members.manage' },
      header: ORG,
      membership: { role: 'admin', type: 'bakery' },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.org).toEqual({
      organizationId: ORG,
      organizationType: 'bakery',
      membershipId: 'm-1',
      role: 'admin',
    });
  });
});
