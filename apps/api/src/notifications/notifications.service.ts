import { Injectable } from '@nestjs/common';
import { type AuthUser } from '../common/request-context';
import { Errors } from '../common/errors';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { type Prisma } from '../generated/prisma/client';

export interface NotifyInput {
  organizationId: string;
  userIds: string[];
  type: string;
  payload: Prisma.InputJsonObject;
  /** Same key for the same user is sent once. */
  dedupeKey?: string;
}

/**
 * In-app notifications (spec section 9). Rows are written in the caller's transaction; delivery
 * to Telegram and phones reads from here once those channels exist (decided 2026-11-13).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  async notify(tx: Tx, input: NotifyInput): Promise<void> {
    const userIds = [...new Set(input.userIds)];
    if (userIds.length === 0) return;
    await tx.notification.createMany({
      data: userIds.map((userId) => ({
        organizationId: input.organizationId,
        userId,
        type: input.type,
        payload: input.payload,
        dedupeKey: input.dedupeKey ?? null,
      })),
      skipDuplicates: true,
    });
  }

  /** Everyone with an active admin membership. */
  async admins(tx: Tx, organizationId: string): Promise<string[]> {
    const rows = await tx.membership.findMany({
      where: { organizationId, status: 'active', role: 'admin' },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  list(user: AuthUser, unreadOnly: boolean) {
    return this.db.run({ organizationId: null, userId: user.userId }, async (tx) => {
      const rows = await tx.notification.findMany({
        where: { userId: user.userId, ...(unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return {
        items: rows.map((n) => ({
          id: n.id,
          organizationId: n.organizationId,
          type: n.type,
          payload: n.payload,
          readAt: n.readAt,
          createdAt: n.createdAt,
        })),
        nextCursor: null,
      };
    });
  }

  markRead(user: AuthUser, id: string) {
    return this.db.run({ organizationId: null, userId: user.userId }, async (tx) => {
      const result = await tx.notification.updateMany({
        where: { id, userId: user.userId, readAt: null },
        data: { readAt: new Date() },
      });
      if (result.count === 0) {
        const exists = await tx.notification.findFirst({
          where: { id, userId: user.userId },
          select: { id: true },
        });
        if (!exists) throw Errors.notFound('Notification');
      }
    });
  }
}
