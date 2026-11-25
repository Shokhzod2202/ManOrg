import { Injectable } from '@nestjs/common';
import { actorFor, AuditService } from '../audit/audit.service';
import { hashPassword, verifyPassword } from '../auth/password';
import { Errors } from '../common/errors';
import { type AuthUser } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { CONTENT_TYPES, newKey, sniffImage } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import { type UpdateMeInput } from './me.schemas';

/** Profile pictures: up to 5 MB, like product pictures. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

@Injectable()
export class MeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  get(user: AuthUser) {
    return this.db.run({ organizationId: null, userId: user.userId }, (tx) =>
      this.load(tx, user.userId),
    );
  }

  async update(user: AuthUser, input: UpdateMeInput) {
    const newHash = input.password ? await hashPassword(input.password) : undefined;
    return this.db.run({ organizationId: null, userId: user.userId }, async (tx) => {
      const current = await tx.user.findUnique({ where: { id: user.userId } });
      if (!current || current.deletedAt) throw Errors.unauthenticated();
      // The current password guards a new email or password, when the account has one.
      const changesLogin =
        (input.email !== undefined && input.email !== current.email) ||
        input.password !== undefined;
      if (changesLogin && current.passwordHash) {
        if (input.currentPassword === undefined) {
          throw Errors.validation({
            currentPassword: ['Enter your current password to change your email or password.'],
          });
        }
        if (!(await verifyPassword(current.passwordHash, input.currentPassword))) {
          throw Errors.validation({ currentPassword: ['Your current password is incorrect.'] });
        }
      }
      if (input.password !== undefined && !current.email && !input.email) {
        throw Errors.validation({
          email: ['Add an email first: you sign in with it and the password.'],
        });
      }
      if (input.email && input.email !== current.email) {
        const taken = await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        if (taken)
          throw Errors.conflict('EMAIL_TAKEN', 'An account with this email already exists.');
      }
      const updated = await tx.user.update({
        where: { id: user.userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.preferences !== undefined
            ? { preferences: { ...readPreferences(current.preferences), ...input.preferences } }
            : {}),
          ...(newHash ? { passwordHash: newHash } : {}),
        },
      });
      if (newHash && current.passwordHash) {
        // A changed password signs out every session; this device signs in again with it.
        await tx.refreshToken.updateMany({
          where: { userId: user.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        organizationId: null,
        actor: actorFor(user),
        action: 'user.update',
        entity: 'user',
        entityId: user.userId,
        before: {
          name: current.name,
          email: current.email,
          locale: current.locale,
          preferences: current.preferences,
        },
        after: {
          name: updated.name,
          email: updated.email,
          ...(updated.email !== current.email ? { emailChanged: true } : {}),
          locale: updated.locale,
          preferences: updated.preferences,
          ...(newHash ? { passwordChanged: true } : {}),
        },
      });
      return this.load(tx, user.userId);
    });
  }

  /** A profile picture: JPEG, PNG or WebP up to 5 MB, checked by its content. */
  async setAvatar(user: AuthUser, file: Express.Multer.File | undefined) {
    if (!file) throw Errors.validation({ file: ['Attach a picture.'] });
    if (file.size > MAX_AVATAR_BYTES)
      throw Errors.validation({ file: ['Use a picture of at most 5 MB.'] });
    const ext = sniffImage(file.buffer);
    if (!ext) throw Errors.validation({ file: ['Use a JPEG, PNG or WebP picture.'] });
    const key = newKey(user.userId, 'avatar', ext);
    await this.storage.put(key, file.buffer, CONTENT_TYPES[ext]);
    return this.changeAvatar(user, key);
  }

  removeAvatar(user: AuthUser) {
    return this.changeAvatar(user, null);
  }

  private changeAvatar(user: AuthUser, key: string | null) {
    return this.db.run({ organizationId: null, userId: user.userId }, async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { avatarKey: true },
      });
      await tx.user.update({ where: { id: user.userId }, data: { avatarKey: key } });
      await this.audit.record(tx, {
        organizationId: null,
        actor: actorFor(user),
        action: 'user.avatar',
        entity: 'user',
        entityId: user.userId,
        before: { avatar: before.avatarKey !== null },
        after: { avatar: key !== null },
      });
      return this.load(tx, user.userId);
    });
  }

  /** Ends every session of this person on every device, this one included. */
  signOutEverywhere(user: AuthUser) {
    return this.db.run({ organizationId: null, userId: user.userId }, async (tx) => {
      const ended = await tx.refreshToken.updateMany({
        where: { userId: user.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.deviceToken.deleteMany({ where: { userId: user.userId } });
      await this.audit.record(tx, {
        organizationId: null,
        actor: actorFor(user),
        action: 'user.sign_out_everywhere',
        entity: 'user',
        entityId: user.userId,
        after: { sessionsEnded: ended.count },
      });
    });
  }

  private async load(tx: Tx, userId: string) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: { in: ['pending', 'active', 'rejected'] } },
          orderBy: { createdAt: 'desc' },
          include: { organization: { select: { id: true, name: true, type: true } } },
        },
      },
    });
    if (!user || user.deletedAt) throw Errors.unauthenticated();
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      hasPassword: user.passwordHash !== null,
      avatarUrl: user.avatarKey ? await this.storage.signedUrl(user.avatarKey) : null,
      locale: user.locale,
      preferences: readPreferences(user.preferences),
      memberships: user.memberships.map((m) => ({
        id: m.id,
        role: m.role,
        status: m.status,
        owner: m.owner,
        worksShifts: m.role === 'employee' || m.worksShifts,
        displayName: m.displayName,
        title: m.title,
        organization: m.organization,
      })),
    };
  }
}

/** Stored preferences with defaults: the orders view starts as the product list. */
function readPreferences(stored: unknown): {
  ordersView: 'list' | 'matrix' | 'products';
  arrivalPrompt: boolean;
  productSort: 'custom' | 'name' | 'type';
} {
  const p = (stored ?? {}) as {
    ordersView?: unknown;
    arrivalPrompt?: unknown;
    productSort?: unknown;
  };
  return {
    ordersView:
      p.ordersView === 'list' || p.ordersView === 'matrix' || p.ordersView === 'products'
        ? p.ordersView
        : 'products',
    arrivalPrompt: p.arrivalPrompt !== false,
    // Decided 2026-11-30: how product lists are sorted: the admin's custom order (default), A to
    // Z, or by product type.
    productSort: p.productSort === 'name' || p.productSort === 'type' ? p.productSort : 'custom',
  };
}
