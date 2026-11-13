import { Module } from '@nestjs/common';
import { ShiftsModule } from '../shifts/shifts.module';
import { OutputController } from './output.controller';
import { OutputService } from './output.service';

@Module({
  imports: [ShiftsModule],
  controllers: [OutputController],
  providers: [OutputService],
})
export class OutputModule {}
