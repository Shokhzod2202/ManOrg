import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { createMembershipOnce } from '../common/memberships';
import { env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { switchOrganization, type Tx } from '../database/prisma-client';
import { Prisma } from '../generated/prisma/client';
import { type TokenPair, TokensService } from '../auth/tokens.service';
import { verifyTelegramInitData } from './init-data';

const BOOTSTRAP_KEY = 'telegram_bootstrap_org_id';

export type TelegramProvisioning =
  | 'not_bootstrap_admin'
  | 'created_organization'
  | 'joined_organization'
  | 'already_member'
  | 'promoted_admin'
  | 'skipped_other_organization';

export interface TelegramAuthResult {
  user: {
    id: string;
    name: string;
    email: string | null;
    telegramUserId: string;
  };
  tokens: TokenPair;
  provisioning: TelegramProvisioning;
}

interface PrivateMessage {
  chatId: number;
  text?: string;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Signs in the Telegram user inside initData. The user id is taken from the checked
   * payload only. Ids in TELEGRAM_BOOTSTRAP_ADMIN_IDS become admin of the one bootstrap
   * bakery. A pending or active employee membership in that bakery is promoted. A membership
   * in another organization is left alone, and a removed or rejected membership is not restored.
   * Every other Telegram user gets an ordinary account and no membership.
   */
  async login(initData: string): Promise<TelegramAuthResult> {
    const config = env();
    if (!config.TELEGRAM_BOT_TOKEN) {
      throw Errors.unavailable('TELEGRAM_NOT_CONFIGURED', 'Telegram sign-in is not configured.');
    }
    const verified = verifyTelegramInitData(
      initData,
      config.TELEGRAM_BOT_TOKEN,
      Math.floor(Date.now() / 1000),
      config.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
    );
    if (!verified.ok) throw Errors.unauthenticated('Telegram sign-in is not valid.');

    const telegramUserId = BigInt(verified.user.id);
    const name = displayName(verified.user.firstName, verified.user.lastName);
    const username = verified.user.username ?? null;
    const locale = localeOf(verified.user.languageCode);

    return this.db.run({ organizationId: null, userId: null }, async (tx) => {
      const user = await this.findOrCreateUser(tx, {
        telegramUserId,
        name,
        username,
        locale,
      });
      if (user.deletedAt) throw Errors.unauthenticated('Telegram sign-in is not valid.');
      await tx.$queryRaw`SELECT set_config('app.user_id', ${user.id}, true)`;
      if ((user.telegramUsername ?? null) !== username) {
        const before = user.telegramUsername;
        await tx.user.update({ where: { id: user.id }, data: { telegramUsername: username } });
        await this.audit.record(tx, {
          organizationId: null,
          actor: userActor(user.id),
          action: 'user.update',
          entity: 'user',
          entityId: user.id,
          before: { telegramUsername: before },
          after: { telegramUsername: username },
        });
      }
      const provisioning = await this.provision(tx, user.id, telegramUserId);
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          telegramUserId: telegramUserId.toString(),
        },
        tokens: await this.tokens.issuePair(tx, user.id),
        provisioning,
      };
    });
  }

  /**
   * Bot API webhook. The secret header is the only authentication.
   * Private messages get a pointer to the Mini App. Other updates are acknowledged
   * so Telegram does not retry them. This does not take orders in chat.
   */
  async handleWebhook(
    secretHeader: string | undefined,
    body: unknown,
  ): Promise<{ ok: true; ignored?: true; delivered?: boolean }> {
    const secret = env().TELEGRAM_WEBHOOK_SECRET;
    if (!secret) {
      throw Errors.unavailable('TELEGRAM_NOT_CONFIGURED', 'Telegram webhook is not configured.');
    }
    if (!secretHeader || !secretsMatch(secretHeader, secret)) {
      throw Errors.unauthenticated('The webhook secret is not valid.');
    }
    const message = readPrivateMessage(body);
    if (!message) return { ok: true, ignored: true };
    const delivered = await this.reply(message);
    return { ok: true, delivered };
  }

  private async findOrCreateUser(
    tx: Tx,
    input: { telegramUserId: bigint; name: string; username: string | null; locale: string },
  ) {
    const existing = await tx.user.findUnique({ where: { telegramUserId: input.telegramUserId } });
    if (existing) return existing;
    const id = randomUUID();
    try {
      const user = await tx.user.create({
        data: {
          id,
          name: input.name,
          email: null,
          passwordHash: null,
          telegramUserId: input.telegramUserId,
          telegramUsername: input.username,
          locale: input.locale,
        },
      });
      await tx.$queryRaw`SELECT set_config('app.user_id', ${id}, true)`;
      await this.audit.record(tx, {
        organizationId: null,
        actor: userActor(id),
        action: 'user.telegram_register',
        entity: 'user',
        entityId: id,
        after: {
          name: user.name,
          telegramUserId: input.telegramUserId.toString(),
          locale: user.locale,
        },
      });
      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await tx.user.findUnique({ where: { telegramUserId: input.telegramUserId } });
        if (raced) return raced;
      }
      throw error;
    }
  }

  private async provision(
    tx: Tx,
    userId: string,
    telegramUserId: bigint,
  ): Promise<TelegramProvisioning> {
    const admins = env().bootstrapAdminIds;
    if (!admins.some((id) => id === telegramUserId)) return 'not_bootstrap_admin';

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(81421901)`;
    const open = await this.openMembership(tx, userId);
    const setting = await tx.platformSetting.findUnique({ where: { key: BOOTSTRAP_KEY } });
    if (!setting) {
      if (!open) return this.createBootstrapOrganization(tx, userId);
      if (!this.isIntendedBakery(open.organization)) return 'skipped_other_organization';
      await tx.platformSetting.create({ data: { key: BOOTSTRAP_KEY, value: open.organizationId } });
      return this.ensureBootstrapAdmin(tx, userId, open);
    }

    const org = await tx.organization.findUnique({
      where: { id: setting.value },
      select: { id: true, name: true, type: true },
    });
    if (!org) {
      throw Errors.unavailable(
        'BOOTSTRAP_ORG_MISSING',
        'The bakery created for Telegram admins is missing.',
      );
    }
    if (open && open.organizationId !== org.id) return 'skipped_other_organization';

    const membership =
      open && open.organizationId === org.id
        ? open
        : await tx.membership.findFirst({
            where: { userId, organizationId: org.id },
            select: membershipShape,
          });
    if (!membership) return this.joinBootstrapOrganization(tx, userId, org.id);
    if (membership.status === 'removed' || membership.status === 'rejected')
      return 'already_member';
    return this.ensureBootstrapAdmin(tx, userId, membership);
  }

  private async joinBootstrapOrganization(
    tx: Tx,
    userId: string,
    organizationId: string,
  ): Promise<TelegramProvisioning> {
    await switchOrganization(tx, organizationId);
    const created = await createMembershipOnce(
      () =>
        tx.membership.create({
          data: { organizationId, userId, role: 'admin', status: 'active' },
        }),
      'you',
    );
    await this.audit.record(tx, {
      organizationId,
      actor: userActor(userId),
      action: 'membership.create',
      entity: 'membership',
      entityId: created.id,
      after: { role: created.role, status: created.status, userId },
    });
    return 'joined_organization';
  }

  /** Promotes a pending or active employee of the bootstrap bakery. An active admin is unchanged. */
  private async ensureBootstrapAdmin(
    tx: Tx,
    userId: string,
    membership: OpenMembership,
  ): Promise<TelegramProvisioning> {
    if (membership.role === 'admin' && membership.status === 'active') return 'already_member';
    await switchOrganization(tx, membership.organizationId);
    await tx.membership.update({
      where: { id: membership.id },
      data: {
        role: 'admin',
        status: 'active',
        decidedById: userId,
        decidedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await this.audit.record(tx, {
      organizationId: membership.organizationId,
      actor: userActor(userId),
      action: 'membership.bootstrap_admin',
      entity: 'membership',
      entityId: membership.id,
      before: { role: membership.role, status: membership.status },
      after: { role: 'admin', status: 'active', userId },
    });
    return 'promoted_admin';
  }

  private isIntendedBakery(organization: { name: string; type: string }): boolean {
    return (
      organization.type === 'bakery' && organization.name === env().TELEGRAM_BOOTSTRAP_ORG_NAME
    );
  }

  private openMembership(tx: Tx, userId: string): Promise<OpenMembership | null> {
    return tx.membership.findFirst({
      where: { userId, status: { in: ['pending', 'active'] } },
      select: membershipShape,
    });
  }

  private async createBootstrapOrganization(tx: Tx, userId: string): Promise<TelegramProvisioning> {
    const config = env();
    const organizationId = randomUUID();
    const org = await tx.organization.create({
      data: {
        id: organizationId,
        name: config.TELEGRAM_BOOTSTRAP_ORG_NAME,
        type: 'bakery',
        timezone: config.bootstrapTimeZone,
        createdById: userId,
      },
    });
    await switchOrganization(tx, org.id);
    const membership = await createMembershipOnce(
      () =>
        tx.membership.create({
          data: {
            organizationId: org.id,
            userId,
            role: 'admin',
            status: 'active',
          },
        }),
      'you',
    );
    await tx.platformSetting.create({ data: { key: BOOTSTRAP_KEY, value: org.id } });
    await this.audit.record(tx, {
      organizationId: org.id,
      actor: userActor(userId),
      action: 'organization.create',
      entity: 'organization',
      entityId: org.id,
      after: { name: org.name, type: org.type, timezone: org.timezone },
    });
    await this.audit.record(tx, {
      organizationId: org.id,
      actor: userActor(userId),
      action: 'membership.create',
      entity: 'membership',
      entityId: membership.id,
      after: { role: membership.role, status: membership.status, userId },
    });
    return 'created_organization';
  }

  private async reply(message: PrivateMessage): Promise<boolean> {
    const config = env();
    const token = config.TELEGRAM_BOT_TOKEN;
    if (!token) return false;
    const welcome = isHelpCommand(message.text);
    const url = config.TELEGRAM_WEBAPP_URL;
    const text = welcome
      ? [
          'Shohona Bakery',
          '',
          'Open the app to sign in with your Telegram account.',
          'Only Telegram accounts listed on the server become admins. Everyone else gets an ordinary account and waits for an admin to approve them.',
          ...(url ? ['', url] : []),
        ].join('\n')
      : 'This chat does not take orders. Open the Shohona Bakery app from the menu button.';
    const replyMarkup =
      welcome && url
        ? { inline_keyboard: [[{ text: 'Open Shohona Bakery', web_app: { url } }]] }
        : undefined;
    try {
      const response = await fetch(
        `${config.TELEGRAM_API_BASE.replace(/\/$/, '')}/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: message.chatId,
            text,
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) {
        this.logger.warn(`Telegram sendMessage failed with status ${response.status}`);
        return false;
      }
      return true;
    } catch {
      this.logger.warn('Telegram sendMessage could not be delivered');
      return false;
    }
  }
}

const membershipShape = {
  id: true,
  role: true,
  status: true,
  organizationId: true,
  organization: { select: { id: true, name: true, type: true } },
} as const;

interface OpenMembership {
  id: string;
  role: 'admin' | 'employee';
  status: 'pending' | 'active' | 'rejected' | 'removed';
  organizationId: string;
  organization: { id: string; name: string; type: 'bakery' | 'contractor' };
}

function displayName(firstName: string, lastName: string | undefined): string {
  const name = [firstName, lastName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(' ')
    .slice(0, 100);
  return name.length > 0 ? name : 'Telegram user';
}

function localeOf(languageCode: string | undefined): 'en' | 'ko' | 'uz' {
  const base = languageCode?.toLowerCase().split('-')[0];
  if (base === 'ko' || base === 'uz') return base;
  return 'en';
}

function secretsMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readPrivateMessage(body: unknown): PrivateMessage | null {
  if (!body || typeof body !== 'object') return null;
  const message = (body as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return null;
  const chat = (message as { chat?: unknown }).chat;
  if (!chat || typeof chat !== 'object') return null;
  const id = (chat as { id?: unknown }).id;
  const type = (chat as { type?: unknown }).type;
  if (typeof id !== 'number' || !Number.isInteger(id)) return null;
  if (type !== 'private') return null;
  const text = (message as { text?: unknown }).text;
  if (text !== undefined && (typeof text !== 'string' || text.length > 4096)) return null;
  return { chatId: id, text };
}

function isHelpCommand(text: string | undefined): boolean {
  if (!text) return false;
  const first = text.trim().split(/\s+/)[0] ?? '';
  return /^\/(start|help)(?:@[A-Za-z0-9_]+)?$/i.test(first);
}
