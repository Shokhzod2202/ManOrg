import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { actorFor, AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors';
import {
  type AgentKeyRef,
  type AuthUser,
  dbContext,
  type OrgContext,
} from '../common/request-context';
import { env } from '../config/env';
import { DatabaseService } from '../database/database.service';

export type AgentAccess = 'read' | 'write';

/** Keys look like `mok_<organization id without dashes>_<secret>`. */
const PREFIX = 'mok_';
const KEY = /^mok_([0-9a-f]{32})_([A-Za-z0-9_-]{40,64})$/;
const hash = (key: string) => createHash('sha256').update(key).digest('hex');
/** "Last used" is written at most this often, not on every request. */
const USED_EVERY_MS = 60_000;
const READ_METHODS = new Set(['GET', 'HEAD']);

export const isAgentKey = (token: string) => token.startsWith(PREFIX);

/**
 * Decided 2026-11-29: API keys the owner gives outside bots (Grok and other agents) so they can
 * use the app's API directly. A key belongs to one organization and acts there as the bot for
 * the owner who made it: the bot's column of the permission matrix and the Bot permissions
 * switches apply, owner-only data stays hidden, and every change is audited as the bot with the
 * key as actor and the owner on whose behalf it acted. "read" keys may only read; "write" keys may
 * also add and change; no key deletes anything (CLAUDE.md rule 7). Only a hash is stored, so the
 * key is shown once; deleting it stops it at once and leaves other keys working.
 */
@Injectable()
export class AgentKeysService {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private ownerOnly(user: AuthUser, org: OrgContext) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    if (!org.owner || user.viaBot) {
      throw Errors.forbidden('Only the owner can manage API keys for bots.');
    }
  }

  list(user: AuthUser, org: OrgContext) {
    this.ownerOnly(user, org);
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.agentKey.findMany({
        where: { organizationId: org.organizationId, revokedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      return { items: rows.map(present) };
    });
  }

  create(user: AuthUser, org: OrgContext, input: { name: string; access: AgentAccess }) {
    this.ownerOnly(user, org);
    return this.db.run(dbContext(user, org), async (tx) => {
      const key = `${PREFIX}${org.organizationId.replace(/-/g, '')}_${randomBytes(32).toString('base64url')}`;
      const row = await tx.agentKey.create({
        data: {
          organizationId: org.organizationId,
          name: input.name,
          access: input.access,
          tokenHash: hash(key),
          hint: key.slice(-4),
          createdById: user.userId,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'agent_key.create',
        entity: 'agent_key',
        entityId: row.id,
        after: { name: row.name, access: row.access },
      });
      // The only time the key leaves the server.
      return { ...present(row), key };
    });
  }

  revoke(user: AuthUser, org: OrgContext, id: string) {
    this.ownerOnly(user, org);
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await tx.agentKey.findFirst({
        where: { id, organizationId: org.organizationId, revokedAt: null },
      });
      if (!before) throw Errors.notFound('Key');
      await tx.agentKey.update({
        where: { id },
        data: { revokedAt: new Date(), revokedById: user.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'agent_key.delete',
        entity: 'agent_key',
        entityId: id,
        before: { name: before.name, access: before.access },
      });
    });
  }

  /**
   * Turns a key into the user it acts for. Unknown, deleted or malformed keys, and keys whose
   * maker is no longer the organization's owner, are refused as unauthenticated.
   */
  async authenticate(token: string, method: string, orgRoute: boolean): Promise<AuthUser> {
    const m = KEY.exec(token);
    if (!m) throw Errors.unauthenticated('This API key is not valid.');
    const hex = m[1]!;
    const organizationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const key = await this.db.run({ organizationId, userId: null }, (tx) =>
      tx.agentKey.findFirst({ where: { tokenHash: hash(token), revokedAt: null } }),
    );
    if (!key || key.organizationId !== organizationId) {
      throw Errors.unauthenticated('This API key is not valid or was deleted.');
    }
    const owner = await this.db.run({ organizationId: null, userId: key.createdById }, (tx) =>
      tx.membership.findFirst({
        where: {
          userId: key.createdById,
          organizationId,
          status: 'active',
          role: 'admin',
          owner: true,
        },
        select: { id: true },
      }),
    );
    if (!owner) {
      throw Errors.unauthenticated('The owner who made this key no longer owns the organization.');
    }

    // Rules before the route runs, so nothing is half done.
    if (!orgRoute) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'AGENT_ROUTE_NOT_ALLOWED',
        'API keys work only on the organization endpoints, not on sign-in or account settings.',
      );
    }
    if (method === 'DELETE') {
      throw new AppError(HttpStatus.FORBIDDEN, 'AGENT_NO_DELETE', 'Bots cannot delete anything.');
    }
    if (key.access !== 'write' && !READ_METHODS.has(method)) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'AGENT_READ_ONLY',
        'This API key may only read. The owner can make a key that may also add and change.',
      );
    }
    this.limit(key.id);

    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > USED_EVERY_MS) {
      await this.db.run({ organizationId, userId: null }, (tx) =>
        tx.agentKey.updateMany({ where: { id: key.id }, data: { lastUsedAt: new Date() } }),
      );
    }
    const agentKey: AgentKeyRef = {
      id: key.id,
      name: key.name,
      access: key.access as AgentAccess,
      organizationId,
    };
    return { userId: key.createdById, viaBot: true, agentKey };
  }

  /** A simple per-key limit, so a runaway bot cannot flood the server. */
  private limit(id: string) {
    const now = Date.now();
    const w = this.windows.get(id);
    if (!w || now - w.start >= 60_000) {
      this.windows.set(id, { start: now, count: 1 });
      return;
    }
    w.count += 1;
    if (w.count > env().AGENT_REQUESTS_PER_MINUTE) {
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'AGENT_RATE_LIMITED',
        `Too many requests: at most ${env().AGENT_REQUESTS_PER_MINUTE} a minute per key.`,
      );
    }
  }
}

function present(row: {
  id: string;
  name: string;
  access: string;
  hint: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}) {
  return {
    id: row.id,
    name: row.name,
    access: row.access as AgentAccess,
    hint: row.hint,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}
