import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { userActor, AuditService } from '../audit/audit.service';
import { translate } from '../common/i18n';
import { Errors } from '../common/errors';
import { env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../mail/mail.service';
import { hashPassword } from './password';

/** A reset link works this long, and once. */
export const RESET_MINUTES = 30;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Decided 2026-11-29: "Forgot password". The person asks with their email; if an account uses it,
 * a one-time link is emailed. Opening it and choosing a new password proves they own the email.
 * The answer to the request is the same whether or not the email is known.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly config = env();

  constructor(
    private readonly db: DatabaseService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async request(email: string): Promise<void> {
    const user = await this.db.run({ organizationId: null, userId: null }, (tx) =>
      tx.user.findUnique({
        where: { email },
        select: { id: true, name: true, email: true, locale: true, deletedAt: true },
      }),
    );
    if (!user || user.deletedAt || !user.email) return;
    const token = randomBytes(32).toString('base64url');
    await this.db.run({ organizationId: null, userId: user.id }, async (tx) => {
      // A new link replaces any earlier one that was not used.
      await tx.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: hash(token),
          expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000),
        },
      });
      await this.audit.record(tx, {
        organizationId: null,
        actor: userActor(user.id),
        action: 'user.password_reset_requested',
        entity: 'user',
        entityId: user.id,
      });
    });
    const link = `${this.config.WEB_APP_URL}/reset-password?token=${token}`;
    try {
      await this.mail.send({
        to: user.email,
        subject: translate('Reset your Haydar Systems password', user.locale),
        text: translate(
          'Hello {name},\n\nSomeone asked to reset the password of your Haydar Systems account. To choose a new password, open this link within {minutes} minutes:\n\n{link}\n\nIf it was not you, ignore this email: your password stays the same.',
          user.locale,
          { name: user.name, minutes: String(RESET_MINUTES), link },
        ),
      });
    } catch (error) {
      // The request still answers the same; the person can ask again.
      this.logger.error(`Password reset email failed: ${(error as Error).message}`);
    }
  }

  async confirm(token: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    const row = await this.db.run({ organizationId: null, userId: null }, (tx) =>
      tx.passwordReset.findUnique({ where: { tokenHash: hash(token) } }),
    );
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw Errors.badRequest(
        'RESET_LINK_INVALID',
        'This reset link has expired or was already used. Ask for a new one.',
      );
    }
    const user = await this.db.run({ organizationId: null, userId: row.userId }, async (tx) => {
      // Used once: a second request with the same link finds it used.
      const claimed = await tx.passwordReset.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw Errors.badRequest(
          'RESET_LINK_INVALID',
          'This reset link has expired or was already used. Ask for a new one.',
        );
      }
      const updated = await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash },
        select: { email: true, name: true, locale: true },
      });
      // Every session ends: whoever knew the old password is signed out.
      await tx.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        organizationId: null,
        actor: userActor(row.userId),
        action: 'user.password_reset',
        entity: 'user',
        entityId: row.userId,
        after: { passwordChanged: true },
      });
      return updated;
    });
    if (user.email) {
      await this.mail
        .send({
          to: user.email,
          subject: translate('Your Haydar Systems password was changed', user.locale),
          text: translate(
            'Hello {name},\n\nThe password of your Haydar Systems account was just changed with a reset link, and you were signed out everywhere. If it was not you, reset your password again and tell your admin.',
            user.locale,
            { name: user.name },
          ),
        })
        .catch(() => undefined);
    }
  }
}
