import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  Public,
  RequireOrg,
} from '../common/request-context';
import { ZodBody } from '../common/zod';
import { DatabaseService } from '../database/database.service';
import { AgentKeysService } from './agent-keys.service';

const createSchema = z.strictObject({
  name: z.string().trim().min(1, 'Give the key a name.').max(60),
  access: z.enum(['read', 'write']),
});

/** The API description outside bots read to learn the endpoints (packages/contracts). */
const OPENAPI = resolve(__dirname, '../../../../packages/contracts/openapi.yaml');
let openapiText: string | null = null;

/** Decided 2026-11-29: API keys for outside bots, and what a bot needs to get started. */
@Controller()
export class AgentKeysController {
  constructor(
    private readonly keys: AgentKeysService,
    private readonly db: DatabaseService,
  ) {}

  @Get('agent-keys')
  @RequireOrg('agentKeys.manage')
  list(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.keys.list(user, org);
  }

  @Post('agent-keys')
  @RequireOrg('agentKeys.manage')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(createSchema) body: z.infer<typeof createSchema>,
  ) {
    return this.keys.create(user, org, body);
  }

  @Delete('agent-keys/:id')
  @RequireOrg('agentKeys.manage')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.keys.revoke(user, org, id);
  }

  /** A bot's first call: which organization and key it is, and the rules it works under. */
  @Get('agent/whoami')
  @RequireOrg()
  async whoami(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    const organization = await this.db.run(
      { organizationId: org.organizationId, userId: user.userId },
      (tx) =>
        tx.organization.findUniqueOrThrow({
          where: { id: org.organizationId },
          select: { id: true, name: true },
        }),
    );
    return {
      organization,
      key: user.agentKey ? { name: user.agentKey.name, access: user.agentKey.access } : null,
      rules: [
        'The X-Organization-Id header is optional with an API key: the key belongs to one organization.',
        'Read keys may use GET only. Write keys may also use POST, PUT and PATCH.',
        'Nothing can be deleted with an API key.',
        'Edits of existing records need the If-Match header with the version you read (the ETag).',
        'Every change is recorded in the audit log as the bot, on behalf of the owner.',
      ],
      openapi: '/api/v1/openapi.yaml',
    };
  }

  /** Public: the API description, so a bot can learn every endpoint and body. */
  @Get('openapi.yaml')
  @Public()
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  openapi() {
    openapiText ??= readFileSync(OPENAPI, 'utf8');
    return openapiText;
  }
}
