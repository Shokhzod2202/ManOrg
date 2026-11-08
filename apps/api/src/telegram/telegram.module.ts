import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TelegramAuthController, TelegramWebhookController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Module({
  imports: [AuthModule],
  controllers: [TelegramAuthController, TelegramWebhookController],
  providers: [TelegramService],
})
export class TelegramModule {}
