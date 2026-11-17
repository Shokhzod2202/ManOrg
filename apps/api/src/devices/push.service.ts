import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { notificationText } from '../telegram/telegram.text';

/** Spec section 9: the events that also go to the phone; the rest stay in the in-app inbox. */
export const PUSH_TYPES = new Set([
  'application.approved',
  'application.rejected',
  'application.created',
  'task.assigned',
  'punch.change_decided',
  'order.placed',
  'order.edited',
  'delivery.completed',
  'delivery.change_requested',
  'ingredient.ordered',
  'ingredient.due',
]);
const MAX_ATTEMPTS = 3;
const STALE_MS = 24 * 60 * 60_000;
const BATCH = 50;

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Phone push through Expo's push service, which reaches FCM (Android) and APNs (iOS). Each
 * person's notifications are read in their own context. A failed push is tried three times,
 * then left to the in-app inbox; a token the phone no longer has is forgotten.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly config = env();
  private sending = false;

  constructor(private readonly db: DatabaseService) {}

  async sendPending(now = new Date()): Promise<number> {
    if (this.sending) return 0;
    this.sending = true;
    let sent = 0;
    try {
      const devices = await this.db.run({ organizationId: null, userId: null }, (tx) =>
        tx.deviceToken.findMany({
          where: { platform: { in: ['ios', 'android'] } },
          orderBy: { createdAt: 'asc' },
        }),
      );
      const byUser = new Map<string, typeof devices>();
      for (const d of devices) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
      for (const [userId, tokens] of byUser) sent += await this.sendFor(userId, tokens, now);
    } finally {
      this.sending = false;
    }
    return sent;
  }

  private async sendFor(
    userId: string,
    tokens: { id: string; token: string; createdAt: Date }[],
    now: Date,
  ): Promise<number> {
    const ctx = { organizationId: null, userId };
    const since = new Date(Math.min(...tokens.map((t) => t.createdAt.getTime())));
    const rows = await this.db.run(ctx, (tx) =>
      tx.notification.findMany({
        where: { userId, sentAt: null, createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
        include: { organization: { select: { name: true } } },
      }),
    );
    let sent = 0;
    for (const n of rows) {
      const done = () =>
        this.db.run(ctx, (tx) =>
          tx.notification.update({ where: { id: n.id }, data: { sentAt: new Date() } }),
        );
      if (!PUSH_TYPES.has(n.type) || now.getTime() - n.createdAt.getTime() > STALE_MS) {
        await done();
        continue;
      }
      const body = plain(notificationText(n.type, n.payload as Record<string, unknown>));
      const messages = tokens.map((t) => ({
        to: t.token,
        title: n.organization?.name ?? 'Haydar',
        body,
        sound: 'default',
        data: { type: n.type, notificationId: n.id, organizationId: n.organizationId },
      }));
      let tickets: ExpoTicket[] | null = null;
      try {
        const res = await fetch(this.config.EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(this.config.EXPO_ACCESS_TOKEN
              ? { Authorization: `Bearer ${this.config.EXPO_ACCESS_TOKEN}` }
              : {}),
          },
          body: JSON.stringify(messages),
        });
        if (res.ok) tickets = ((await res.json()) as { data: ExpoTicket[] }).data;
        else this.logger.warn(`Expo push answered ${res.status}`);
      } catch {
        this.logger.warn('Expo push could not be reached');
      }
      if (!tickets) {
        await this.db.run(ctx, (tx) =>
          tx.notification.update({
            where: { id: n.id },
            data: {
              pushAttempts: { increment: 1 },
              ...(n.pushAttempts + 1 >= MAX_ATTEMPTS ? { sentAt: new Date() } : {}),
            },
          }),
        );
        continue;
      }
      // Tokens the phone gave up (app removed, notifications reset) are forgotten.
      const gone = tickets
        .map((t, i) =>
          t.status === 'error' && t.details?.error === 'DeviceNotRegistered'
            ? tokens[i]?.id
            : undefined,
        )
        .filter((x): x is string => Boolean(x));
      if (gone.length) {
        await this.db.run({ organizationId: null, userId: null }, (tx) =>
          tx.deviceToken.deleteMany({ where: { id: { in: gone } } }),
        );
      }
      await done();
      if (tickets.some((t) => t.status === 'ok')) sent += 1;
    }
    return sent;
  }
}
