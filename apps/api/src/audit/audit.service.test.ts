import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { type Tx } from '../database/prisma-client';
import { AuditService, sanitizeForAudit } from './audit.service';

describe('sanitizeForAudit', () => {
  it('drops secrets at any depth', () => {
    expect(
      sanitizeForAudit({
        name: 'Mina',
        password: 'plain',
        passwordHash: 'x',
        passwordChanged: true,
        nested: { refreshToken: 'y', ok: 1 },
        list: [{ apiSecret: 'z', keep: true }],
      }),
    ).toEqual({ name: 'Mina', passwordChanged: true, nested: { ok: 1 }, list: [{ keep: true }] });
  });

  it('serialises dates and decimals', () => {
    expect(
      sanitizeForAudit({
        at: new Date('2026-11-02T05:00:00Z'),
        price: new Prisma.Decimal('1500.50'),
      }),
    ).toEqual({ at: '2026-11-02T05:00:00.000Z', price: '1500.5' });
  });

  it('keeps an absent value empty', () => {
    expect(sanitizeForAudit(undefined)).toBeNull();
  });
});

describe('AuditService.record', () => {
  it('writes old value, new value, actor and entity in the given transaction', async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = { auditLog: { create } } as unknown as Tx;
    await new AuditService().record(tx, {
      organizationId: 'org-1',
      actor: { type: 'bot', id: 'bot-1', onBehalfOf: 'admin-1' },
      action: 'membership.role_change',
      entity: 'membership',
      entityId: 'm-1',
      before: { role: 'employee' },
      after: { role: 'admin' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        actorType: 'bot',
        actorId: 'bot-1',
        onBehalfOf: 'admin-1',
        action: 'membership.role_change',
        entity: 'membership',
        entityId: 'm-1',
        before: { role: 'employee' },
        after: { role: 'admin' },
      },
    });
  });

  it('stores a missing before value as SQL NULL', async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = { auditLog: { create } } as unknown as Tx;
    await new AuditService().record(tx, {
      organizationId: null,
      actor: { type: 'user', id: 'u-1' },
      action: 'user.create',
      entity: 'user',
      entityId: 'u-1',
      after: { name: 'Mina' },
    });
    expect(create.mock.calls[0]?.[0].data.before).toBe(Prisma.DbNull);
  });
});
