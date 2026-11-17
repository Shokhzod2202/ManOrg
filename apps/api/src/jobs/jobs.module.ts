import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { TelegramModule } from '../telegram/telegram.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [TasksModule, TelegramModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
