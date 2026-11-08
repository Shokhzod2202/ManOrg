import { Injectable } from '@nestjs/common';
import { type Tx } from '../database/prisma-client';
import { type ActorType, Prisma } from '../generated/prisma/client';

export interface AuditActor {
  type: ActorType;
  id: string;
  /** For bot actions: the admin who asked for it (spec section 4). */
  onBehalfOf?: string;
}

export interface AuditEntry {
  /** Empty only for account-level changes outside any organization. */
  organizationId: string | null;
  actor: AuditActor;
  /** Verb in `entity.verb` form, e.g. `membership.approve`. */
  action: string;
  entity: string;
  entityId: string;
  before?: object | null;
  after?: object | null;
}

/** Keys whose values are secrets. Flags such as `passwordChanged` are kept. */
const SECRET_KEY = /^password$|passwordhash|token|secret|hash$/i;

/** Removes secrets and turns Dates and Decimals into JSON-safe values. */
export function sanitizeForAudit(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toString();
  if (Array.isArray(value)) return value.map((v) => sanitizeForAudit(v)) as Prisma.InputJsonArray;
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, v] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      out[key] = sanitizeForAudit(v);
    }
    return out as Prisma.InputJsonObject;
  }
  if (typeof value === 'bigint') return value.toString();
  return value as Prisma.InputJsonValue;
}

/**
 * Writes one audit_log row (CLAUDE.md rule 4) inside the caller's transaction, so the change and
 * its audit entry commit or roll back together. The log is append-only for the API's role.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorType: entry.actor.type,
        actorId: entry.actor.id,
        onBehalfOf: entry.actor.onBehalfOf ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: sanitizeForAudit(entry.before) ?? Prisma.DbNull,
        after: sanitizeForAudit(entry.after) ?? Prisma.DbNull,
      },
    });
  }
}

/** The audit actor for a signed-in user. */
export function userActor(userId: string): AuditActor {
  return { type: 'user', id: userId };
}
