import { Controller, Delete, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Public } from '../common/request-context';
import { ZodBody } from '../common/zod';
import { TelegramService } from './telegram.service';

/** Telegram's update, reduced to what the bot reads; other fields are dropped. */
const updateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      text: z.string().max(4096).optional(),
      chat: z.object({ id: z.number().int(), type: z.string() }),
      from: z.object({ username: z.string().max(64).optional() }).optional(),
    })
    .optional(),
});

@Controller()
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  /** Whether this account receives notifications in Telegram. */
  @Get('me/telegram')
  status(@CurrentUser() user: AuthUser) {
    return this.telegram.status(user);
  }

  /** A one-time link that opens the bot and connects this account (valid 15 minutes). */
  @Post('me/telegram/link')
  link(@CurrentUser() user: AuthUser) {
    return this.telegram.createLink(user);
  }

  @Delete('me/telegram')
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthUser): Promise<void> {
    await this.telegram.disconnect(user);
  }

  /**
   * Updates pushed by Telegram. Checked against the secret header, never a user token; the body
   * is Telegram's own format and only `message.text` and `message.chat` are read.
   */
  @Public()
  @Post('telegram/webhook')
  @HttpCode(200)
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @ZodBody(updateSchema) update: z.infer<typeof updateSchema>,
  ): Promise<{ ok: true }> {
    this.telegram.verifyWebhook(secret);
    await this.telegram.handleUpdate(update);
    return { ok: true };
  }
}
