import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from '../common/errors';
import { AgentKeysService, isAgentKey } from '../agents/agent-keys.service';
import { type AppRequest, IS_PUBLIC, ORG_REQUIREMENT } from '../common/request-context';
import { TokensService } from './tokens.service';

/** Global: every route needs a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly agents: AgentKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match?.[1]) throw Errors.unauthenticated();
    // Decided 2026-11-29: outside bots sign in with an owner-made API key instead of a session.
    if (isAgentKey(match[1])) {
      const orgRoute = Boolean(
        this.reflector.getAllAndOverride(ORG_REQUIREMENT, [
          context.getHandler(),
          context.getClass(),
        ]),
      );
      req.user = await this.agents.authenticate(match[1], req.method, orgRoute);
      return true;
    }
    req.user = await this.tokens.verifyAccess(match[1]);
    return true;
  }
}
