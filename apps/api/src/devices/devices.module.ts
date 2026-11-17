import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { PushService } from './push.service';

@Module({
  imports: [AuthModule],
  controllers: [DevicesController],
  providers: [DevicesService, PushService],
  exports: [PushService],
})
export class DevicesModule {}
