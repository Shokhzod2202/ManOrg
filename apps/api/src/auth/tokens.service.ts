import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { env } from '../config/env';
import { type Tx } from '../database/prisma-client';
import { Errors } from '../common/errors';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

interface AccessPayload {
  sub: string;
  typ: 'access';
}

/**
 * Short-lived access tokens (JWT) plus opaque refresh tokens that rotate on every use.
 * A refresh token that was already used revokes its whole family (stolen-token detection).
 */
@Injectable()
export class TokensService {
  constructor(private readonly jwt: JwtService) {}

  async verifyAccess(token: string): Promise<{ userId: string }> {
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: env().JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
      });
      if (payload.typ !== 'access' || typeof payload.sub !== 'string') throw new Error('bad type');
      return { userId: payload.sub };
    } catch {
      throw Errors.unauthenticated('Your session has expired. Sign in again.');
    }
  }

  async issuePair(tx: Tx, userId: string, familyId: string = randomUUID()): Promise<TokenPair> {
    const ttl = env().ACCESS_TOKEN_TTL_SECONDS;
    const accessToken = await this.jwt.signAsync(
      { sub: userId, typ: 'access' } satisfies AccessPayload,
      {
        secret: env().JWT_ACCESS_SECRET,
        algorithm: 'HS256',
        expiresIn: ttl,
      },
    );
    const refreshToken = `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
    await tx.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: this.hashRefresh(refreshToken),
        expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: ttl };
  }

  /**
   * Revokes the presented token and returns a new pair in the same family. Returns null when the
   * token is unknown, expired or already used; a reused token also revokes its whole family, and
   * that revocation must commit, so this returns instead of throwing.
   */
  async rotate(tx: Tx, refreshToken: string): Promise<{ userId: string; pair: TokenPair } | null> {
    const row = await tx.refreshToken.findUnique({
      where: { tokenHash: this.hashRefresh(refreshToken) },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    // Conditional revoke: of two parallel refreshes with one token, only one can win.
    const revoked = await tx.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      await tx.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return null;
    }
    const pair = await this.issuePair(tx, row.userId, row.familyId);
    const next = await tx.refreshToken.findUniqueOrThrow({
      where: { tokenHash: this.hashRefresh(pair.refreshToken) },
      select: { id: true },
    });
    await tx.refreshToken.update({ where: { id: row.id }, data: { replacedBy: next.id } });
    return { userId: row.userId, pair };
  }

  private hashRefresh(token: string): string {
    return createHmac('sha256', env().JWT_REFRESH_SECRET).update(token).digest('hex');
  }
}
