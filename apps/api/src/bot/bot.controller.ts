import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  RequireOrg,
} from '../common/request-context';
import { ZodBody } from '../common/zod';
import { BotService } from './bot.service';

const sendSchema = z.strictObject({
  conversationId: z.uuid().optional(),
  text: z.string().trim().min(1, 'Write a message.').max(4000),
});
const confirmSchema = z.strictObject({ second: z.boolean().default(false) });

/** The Bot screen (spec section 10): provider admins only. */
@Controller('bot')
@RequireOrg('bot.use')
export class BotController {
  constructor(private readonly bot: BotService) {}

  @Get()
  async status(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return { ...this.bot.status(), usage: await this.bot.usage(user, org) };
  }

  @Get('conversations')
  list(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.bot.list(user, org);
  }

  @Get('conversations/:id')
  get(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.bot.get(user, org, id);
  }

  @Post('messages')
  @HttpCode(200)
  send(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(sendSchema) body: z.infer<typeof sendSchema>,
  ) {
    return this.bot.send(user, org, body);
  }

  @Post('proposals/:id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(confirmSchema) body: z.infer<typeof confirmSchema>,
  ) {
    return this.bot.confirm(user, org, id, body.second);
  }

  @Post('proposals/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.bot.cancel(user, org, id);
  }
}
