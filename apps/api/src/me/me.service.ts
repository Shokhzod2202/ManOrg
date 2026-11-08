import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { hashPassword, verifyPassword } from '../auth/password';
import { Errors } from '../common/errors';
import { type AuthUser } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { type UpdateMeInput } from './me.schemas';

@Injectable()
export class MeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
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
      if (input.currentPassword !== undefined) {
        if (!(await verifyPassword(current.passwordHash, input.currentPassword))) {
          throw Errors.validation({ currentPassword: ['Your current password is incorrect.'] });
        }
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
          ...(newHash ? { passwordHash: newHash } : {}),
        },
      });
      if (newHash) {
        // A new password signs out every other session.
        await tx.refreshToken.updateMany({
          where: { userId: user.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        organizationId: null,
        actor: userActor(user.userId),
        action: 'user.update',
        entity: 'user',
        entityId: user.userId,
        before: { name: current.name, email: current.email, locale: current.locale },
        after: {
          name: updated.name,
          email: updated.email,
          locale: updated.locale,
          ...(newHash ? { passwordChanged: true } : {}),
        },
      });
      return this.load(tx, user.userId);
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
      locale: user.locale,
      memberships: user.memberships.map((m) => ({
        id: m.id,
        role: m.role,
        status: m.status,
        organization: m.organization,
      })),
    };
  }
}
