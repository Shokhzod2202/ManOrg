import { Injectable } from '@nestjs/common';
import { actorFor, AuditService } from '../audit/audit.service';
import { TokensService } from '../auth/tokens.service';
import { type AuthUser } from '../common/request-context';
import { DatabaseService } from '../database/database.service';

/** The Haydar phone app: its own session, and the push token it registers. */
@Injectable()
export class DevicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  /**
   * A separate session for the phone app's background work (the arrival check runs while the
   * app is closed). It is its own refresh-token family, so signing out on the phone ends it.
   */
  deviceSession(user: AuthUser) {
    return this.db.run({ organizationId: null, userId: user.userId }, async (tx) => {
      const pair = await this.tokens.issuePair(tx, user.userId);
      await this.audit.record(tx, {
        organizationId: null,
        actor: actorFor(user),
        action: 'device.session',
        entity: 'user',
        entityId: user.userId,
      });
      return { refreshToken: pair.refreshToken, expiresIn: pair.expiresIn };
    });
  }

  /** A push token belongs to the person who registered it last on that phone. */
  register(user: AuthUser, input: { token: string; platform: 'ios' | 'android' }) {
    return this.db.run({ organizationId: null, userId: user.userId }, async (tx) => {
      await tx.deviceToken.upsert({
        where: { token: input.token },
        create: { userId: user.userId, token: input.token, platform: input.platform },
        update: { userId: user.userId, platform: input.platform },
      });
    });
  }

  remove(user: AuthUser, token: string) {
    return this.db.run({ organizationId: null, userId: user.userId }, (tx) =>
      tx.deviceToken.deleteMany({ where: { token, userId: user.userId } }),
    );
  }
}
