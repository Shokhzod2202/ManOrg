import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { TimesheetService } from './timesheet.service';

@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService, TimesheetService],
  exports: [TimesheetService, ShiftsService],
})
export class ShiftsModule {}
