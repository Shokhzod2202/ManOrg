import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { TelegramModule } from '../telegram/telegram.module';
import { DevicesModule } from '../devices/devices.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [TasksModule, TelegramModule, DevicesModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
