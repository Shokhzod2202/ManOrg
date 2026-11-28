import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
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
import { WallLinksService } from './wall-links.service';

const nameSchema = z.strictObject({
  name: z.string().trim().min(1, 'Give the link a name.').max(60),
});

/** Decided 2026-11-28: private wall-screen links. */
@Controller()
export class WallLinksController {
  constructor(private readonly links: WallLinksService) {}

  @Get('wall-links')
  @RequireOrg('wall.manage')
  list(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.links.list(user, org);
  }

  @Post('wall-links')
  @RequireOrg('wall.manage')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(nameSchema) body: z.infer<typeof nameSchema>,
  ) {
    return this.links.create(user, org, body.name);
  }

  @Patch('wall-links/:id')
  @RequireOrg('wall.manage')
  rename(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(nameSchema) body: z.infer<typeof nameSchema>,
  ) {
    return this.links.rename(user, org, id, body.name);
  }

  @Delete('wall-links/:id')
  @HttpCode(204)
  @RequireOrg('wall.manage')
  async revoke(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.links.revoke(user, org, id);
  }

  /** The screen behind a link: no account needed. */
  @Get('public/wall/:orgId/:secret')
  @Public()
  screen(@Param('orgId') orgId: string, @Param('secret') secret: string) {
    return this.links.screen(orgId, secret);
  }
}
