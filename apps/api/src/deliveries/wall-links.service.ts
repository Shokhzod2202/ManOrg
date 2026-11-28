import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { actorFor, AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, type OrgContext } from '../common/request-context';
import { localDate } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { DueNextService } from './due-next.service';

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** "Last opened" is written at most this often, not on every refresh of a screen. */
const SEEN_EVERY_MS = 5 * 60_000;

/**
 * Decided 2026-11-28: private links to the wall screen. Anyone with a link sees the orders due
 * next in a browser without an account, and picks how it looks. The link holds the organization
 * and a random secret; only a hash of the secret is stored, so the full link is shown once, when
 * it is made. Deleting a link stops it at once and leaves the other links working.
 */
@Injectable()
export class WallLinksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly dueNext: DueNextService,
  ) {}

  list(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.wallLink.findMany({
        where: { organizationId: org.organizationId, revokedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      return { items: rows.map(present) };
    });
  }

  create(user: AuthUser, org: OrgContext, name: string) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      const secret = randomBytes(24).toString('base64url');
      const row = await tx.wallLink.create({
        data: {
          organizationId: org.organizationId,
          name,
          tokenHash: hash(secret),
          createdById: user.userId,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'wall_link.create',
        entity: 'wall_link',
        entityId: row.id,
        after: { name },
      });
      // The only time the secret leaves the server.
      return { ...present(row), path: `/screen/${org.organizationId}/${secret}` };
    });
  }

  rename(user: AuthUser, org: OrgContext, id: string, name: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await tx.wallLink.findFirst({
        where: { id, organizationId: org.organizationId, revokedAt: null },
      });
      if (!before) throw Errors.notFound('Link');
      const row = await tx.wallLink.update({
        where: { id },
        data: { name, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'wall_link.rename',
        entity: 'wall_link',
        entityId: id,
        before: { name: before.name },
        after: { name },
      });
      return present(row);
    });
  }

  /** Stops the link at once; the row stays for the audit trail. Other links are untouched. */
  revoke(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const result = await tx.wallLink.updateMany({
        where: { id, organizationId: org.organizationId, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: user.userId, version: { increment: 1 } },
      });
      if (result.count !== 1) throw Errors.notFound('Link');
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'wall_link.delete',
        entity: 'wall_link',
        entityId: id,
        after: { revoked: true },
      });
    });
  }

  /** The screen behind a link, without an account. A wrong, old or deleted link answers 404. */
  async screen(organizationId: string, secret: string) {
    if (!UUID.test(organizationId) || secret.length < 20 || secret.length > 100) {
      throw Errors.notFound('Link');
    }
    // The link is found inside its organization; the board is then read on behalf of the admin
    // who made the link (organizations are readable to signed-in people only).
    const link = await this.db.run({ organizationId, userId: null }, async (tx) => {
      const found = await tx.wallLink.findFirst({
        where: { organizationId, tokenHash: hash(secret), revokedAt: null },
      });
      if (!found) return null;
      const now = new Date();
      if (!found.lastSeenAt || now.getTime() - found.lastSeenAt.getTime() > SEEN_EVERY_MS) {
        await tx.wallLink.update({ where: { id: found.id }, data: { lastSeenAt: now } });
      }
      return found;
    });
    if (!link) throw Errors.notFound('Link');
    return this.db.run({ organizationId, userId: link.createdById }, async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, type: true, timezone: true },
      });
      if (!org || org.type !== 'provider') throw Errors.notFound('Link');
      return {
        organization: { name: org.name },
        link: { name: link.name },
        today: localDate(org.timezone),
        generatedAt: new Date(),
        ...(await this.dueNext.publicBoard(tx, organizationId)),
      };
    });
  }
}

function present(row: { id: string; name: string; createdAt: Date; lastSeenAt: Date | null }) {
  return { id: row.id, name: row.name, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt };
}
