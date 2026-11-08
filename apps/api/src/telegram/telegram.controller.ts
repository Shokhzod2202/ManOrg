import { Body, Controller, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/request-context';
import { ZodBody } from '../common/zod';
import { TelegramService } from './telegram.service';
import { type TelegramLoginInput, telegramLoginSchema } from './telegram.schemas';

/** Mini App sign-in. Rate-limited with the other sign-in routes. There is no dev bypass. */
@Public()
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class TelegramAuthController {
  constructor(private readonly telegram: TelegramService) {}

  @Post('telegram')
  @HttpCode(200)
  login(@ZodBody(telegramLoginSchema) body: TelegramLoginInput) {
    return this.telegram.login(body.initData);
  }
}

/**
 * Legacy public path is /api/telegram/webhook. The proxy forwards that URL to
 * /api/v1/telegram/webhook. Authentication is the secret header, not a bearer token.
 */
@Public()
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private readonly telegram: TelegramService) {}

  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | string[] | undefined,
    @Body() body: unknown,
  ) {
    const header = Array.isArray(secret) ? secret[0] : secret;
    return this.telegram.handleWebhook(header, body);
  }
}
