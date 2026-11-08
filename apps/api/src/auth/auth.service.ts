import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { DatabaseService } from '../database/database.service';
import { type LoginInput, type RefreshInput, type RegisterInput } from './auth.schemas';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { type TokenPair, TokensService } from './tokens.service';

export interface AuthResult {
  user: { id: string; name: string; email: string };
  tokens: TokenPair;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  /** ACC-2: an ordinary account with no organization and no permissions. */
  async register(input: RegisterInput): Promise<AuthResult> {
    const id = randomUUID();
    const passwordHash = await hashPassword(input.password);
    return this.db.run({ organizationId: null, userId: id }, async (tx) => {
      const taken = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (taken) throw Errors.conflict('EMAIL_TAKEN', 'An account with this email already exists.');
      const user = await tx.user.create({
        data: { id, name: input.name, email: input.email, passwordHash },
        select: { id: true, name: true, email: true },
      });
      await this.audit.record(tx, {
        organizationId: null,
        actor: userActor(user.id),
        action: 'user.register',
        entity: 'user',
        entityId: user.id,
        after: user,
      });
      return { user, tokens: await this.tokens.issuePair(tx, user.id) };
    });
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.db.run({ organizationId: null, userId: null }, (tx) =>
      tx.user.findUnique({ where: { email: input.email } }),
    );
    const ok =
      user && !user.deletedAt
        ? await verifyPassword(user.passwordHash, input.password)
        : await verifyAgainstDummy(input.password);
    if (!user || !ok) throw Errors.unauthenticated('Email or password is incorrect.');
    return this.db.run({ organizationId: null, userId: user.id }, async (tx) => ({
      user: { id: user.id, name: user.name, email: user.email },
      tokens: await this.tokens.issuePair(tx, user.id),
    }));
  }

  async refresh(input: RefreshInput): Promise<{ tokens: TokenPair }> {
    const result = await this.db.run({ organizationId: null, userId: null }, async (tx) => {
      const rotated = await this.tokens.rotate(tx, input.refreshToken);
      if (!rotated) return null;
      const user = await tx.user.findUnique({ where: { id: rotated.userId } });
      return user && !user.deletedAt ? rotated : null;
    });
    if (!result) throw Errors.unauthenticated('Sign in again.');
    return { tokens: result.pair };
  }
}
