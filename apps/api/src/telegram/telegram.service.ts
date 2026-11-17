import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { actorFor, AuditService, userActor } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors';
import { type AuthUser } from '../common/request-context';
import { env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { TelegramClient, TelegramError } from './telegram.client';
import { notificationText, notificationUrl } from './telegram.text';

const CODE_TTL_MS = 15 * 60_000;
/** A notice the bot could not send within a day is skipped rather than sent late. */
const STALE_MS = 24 * 60 * 60_000;
const BATCH = 20;

/** The parts of a Telegram update the bot reads. */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: { username?: string };
  };
}

const hash = (code: string) => createHash('sha256').update(code).digest('hex');

const HELP =
  'This bot sends your Haydar notifications.\n\nTo connect, open <b>Settings</b> in the Haydar app and press <b>Connect Telegram</b>.\nSend /stop to stop the messages.';

/**
 * Telegram alongside the phone app (decided 2026-11-13). The bot only delivers notifications that
 * already exist in-app, each read in its recipient's own security context; it never acts on
 * business data, so it needs no permission beyond the recipient's own.
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly config = env();
  private readonly client: TelegramClient | null = this.config.TELEGRAM_BOT_TOKEN
    ? new TelegramClient(this.config.TELEGRAM_BOT_TOKEN, this.config.TELEGRAM_API_URL)
    : null;
  private polling?: AbortController;
  private sending = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ account endpoints

  async status(user: AuthUser) {
    const link = await this.db.run({ organizationId: null, userId: user.userId }, (tx) =>
      tx.telegramLink.findUnique({ where: { userId: user.userId } }),
    );
    return {
      available: this.client !== null,
      botUsername: this.config.TELEGRAM_BOT_USERNAME,
      connected: link !== null,
      username: link?.username ?? null,
      connectedAt: link?.linkedAt ?? null,
    };
  }

  /** A one-time start link: t.me/<bot>?start=<code>. Only the hash is stored. */
  async createLink(user: AuthUser) {
    if (!this.client) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'TELEGRAM_NOT_CONFIGURED',
        'Telegram is not set up on this server yet.',
      );
    }
    const code = randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.db.run({ organizationId: null, userId: user.userId }, async (tx) => {
      await tx.telegramLinkCode.deleteMany({ where: { userId: user.userId, usedAt: null } });
      await tx.telegramLinkCode.create({
        data: { userId: user.userId, codeHash: hash(code), expiresAt },
      });
    });
    return { url: `https://t.me/${this.config.TELEGRAM_BOT_USERNAME}?start=${code}`, expiresAt };
  }

  async disconnect(user: AuthUser): Promise<void> {
    const removed = await this.db.run({ organizationId: null, userId: user.userId }, async (tx) => {
      const link = await tx.telegramLink.findUnique({ where: { userId: user.userId } });
      if (!link) return null;
      await tx.telegramLink.delete({ where: { id: link.id } });
      await this.audit.record(tx, {
        organizationId: null,
        actor: actorFor(user),
        action: 'telegram.disconnect',
        entity: 'telegram_link',
        entityId: link.id,
        before: { username: link.username, linkedAt: link.linkedAt },
      });
      return link;
    });
    if (!removed) throw Errors.notFound('Telegram connection');
    await this.say(
      removed.chatId,
      'Disconnected from Haydar. You will not get messages here any more.',
    );
  }

  // ------------------------------------------------------------------ updates from Telegram

  /** Webhook calls carry the secret Telegram was given in setWebhook. */
  verifyWebhook(secret: string | undefined): void {
    const expected = this.config.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || !this.client) throw Errors.notFound('Route');
    const a = Buffer.from(secret ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw Errors.unauthenticated('Not Telegram.');
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg?.text || msg.chat.type !== 'private') return;
    const [command, arg] = msg.text.trim().split(/\s+/, 2);
    const chatId = BigInt(msg.chat.id);
    if (command === '/start' && arg) return this.link(chatId, arg, msg.from?.username ?? null);
    if (command === '/stop') return this.stop(chatId);
    await this.say(chatId, HELP);
  }

  private async link(chatId: bigint, code: string, username: string | null): Promise<void> {
    const found = await this.db.run({ organizationId: null, userId: null }, (tx) =>
      tx.telegramLinkCode.findUnique({ where: { codeHash: hash(code) } }),
    );
    if (!found || found.usedAt || found.expiresAt < new Date()) {
      await this.say(
        chatId,
        'This link has expired. Press <b>Connect Telegram</b> in the Haydar app again.',
      );
      return;
    }
    const name = await this.db.run({ organizationId: null, userId: found.userId }, async (tx) => {
      const used = await tx.telegramLinkCode.updateMany({
        where: { id: found.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count === 0) return null;
      // One chat per person: a chat linked to another account moves to this one.
      await tx.telegramLink.deleteMany({ where: { chatId, NOT: { userId: found.userId } } });
      const link = await tx.telegramLink.upsert({
        where: { userId: found.userId },
        create: { userId: found.userId, chatId, username },
        update: { chatId, username, linkedAt: new Date() },
      });
      await this.audit.record(tx, {
        organizationId: null,
        actor: userActor(found.userId),
        action: 'telegram.connect',
        entity: 'telegram_link',
        entityId: link.id,
        after: { username, linkedAt: link.linkedAt },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: found.userId },
        select: { name: true },
      });
      return user.name;
    });
    await this.say(
      chatId,
      name
        ? `Connected to Haydar as <b>${name.replace(/[<>&]/g, '')}</b>. Your notifications will arrive here.\nSend /stop to stop them.`
        : 'This link was already used.',
    );
  }

  private async stop(chatId: bigint): Promise<void> {
    const link = await this.db.run({ organizationId: null, userId: null }, (tx) =>
      tx.telegramLink.findUnique({ where: { chatId } }),
    );
    if (link) {
      await this.db.run({ organizationId: null, userId: link.userId }, async (tx) => {
        await tx.telegramLink.delete({ where: { id: link.id } });
        await this.audit.record(tx, {
          organizationId: null,
          actor: userActor(link.userId),
          action: 'telegram.disconnect',
          entity: 'telegram_link',
          entityId: link.id,
          before: { username: link.username, linkedAt: link.linkedAt },
        });
      });
    }
    await this.say(chatId, link ? 'Stopped. Connect again from Settings in the Haydar app.' : HELP);
  }

  private async say(chatId: bigint, text: string): Promise<void> {
    try {
      await this.client?.sendMessage(chatId, text);
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : 'Telegram reply failed');
    }
  }

  // ------------------------------------------------------------------ delivery

  /**
   * Sends unsent notifications to every connected person, oldest first. Each person's rows are
   * read and marked inside their own context, so row-level security still applies.
   */
  get configured(): boolean {
    return this.client !== null;
  }

  async sendPending(now = new Date()): Promise<number> {
    if (!this.client || this.sending) return 0;
    this.sending = true;
    let sent = 0;
    try {
      const links = await this.db.run({ organizationId: null, userId: null }, (tx) =>
        tx.telegramLink.findMany({ orderBy: { linkedAt: 'asc' } }),
      );
      for (const link of links) {
        const result = await this.sendFor(link, now);
        sent += result.sent;
        if (result.rateLimited) break;
      }
    } finally {
      this.sending = false;
    }
    return sent;
  }

  private async sendFor(
    link: { id: string; userId: string; chatId: bigint; linkedAt: Date },
    now: Date,
  ): Promise<{ sent: number; rateLimited: boolean }> {
    const ctx = { organizationId: null, userId: link.userId };
    const rows = await this.db.run(ctx, (tx) =>
      tx.notification.findMany({
        where: { userId: link.userId, telegramSentAt: null, createdAt: { gte: link.linkedAt } },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
        include: { organization: { select: { name: true } } },
      }),
    );
    let sent = 0;
    for (const n of rows) {
      const mark = () =>
        this.db.run(ctx, (tx) =>
          tx.notification.update({ where: { id: n.id }, data: { telegramSentAt: new Date() } }),
        );
      if (now.getTime() - n.createdAt.getTime() > STALE_MS) {
        await mark();
        continue;
      }
      try {
        await this.client!.sendMessage(
          link.chatId,
          notificationText(n.type, n.payload as Record<string, unknown>, n.organization?.name),
          notificationUrl(n.type, this.config.WEB_APP_URL),
        );
        await mark();
        sent += 1;
      } catch (error) {
        if (error instanceof TelegramError && error.chatGone) {
          // The person blocked the bot: forget the chat; the in-app notices stay.
          await this.db.run(ctx, (tx) => tx.telegramLink.deleteMany({ where: { id: link.id } }));
          return { sent, rateLimited: false };
        }
        const rateLimited = error instanceof TelegramError && error.status === 429;
        if (!rateLimited)
          this.logger.warn(error instanceof Error ? error.message : 'Telegram send failed');
        return { sent, rateLimited };
      }
    }
    return { sent, rateLimited: false };
  }

  // ------------------------------------------------------------------ background work

  onModuleInit(): void {
    // Sending runs as a scheduled job (jobs/jobs.service.ts); only polling lives here.
    if (!this.client) return;
    if (this.config.TELEGRAM_POLLING === 'true') void this.poll();
  }

  onModuleDestroy(): void {
    this.polling?.abort();
  }

  /** Long polling for development or a server without a public URL. */
  private async poll(): Promise<void> {
    this.polling = new AbortController();
    const { signal } = this.polling;
    let offset = 0;
    try {
      await this.client!.call('deleteWebhook', {}, signal);
    } catch {
      // Polling still works if this fails; getUpdates reports the real problem.
    }
    while (!signal.aborted) {
      try {
        const updates = await this.client!.call<TelegramUpdate[]>(
          'getUpdates',
          { offset, timeout: 25, allowed_updates: ['message'] },
          signal,
        );
        for (const u of updates) {
          offset = u.update_id + 1;
          await this.handleUpdate(u).catch((error: unknown) =>
            this.logger.warn(error instanceof Error ? error.message : 'Telegram update failed'),
          );
        }
      } catch (error) {
        if (signal.aborted) return;
        this.logger.warn(error instanceof Error ? error.message : 'Telegram polling failed');
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  }
}
