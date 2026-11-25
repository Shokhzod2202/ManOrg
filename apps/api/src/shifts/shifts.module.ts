import { Module } from '@nestjs/common';
import { HoursController } from './hours.controller';
import { HoursService } from './hours.service';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { TimesheetService } from './timesheet.service';

@Module({
  controllers: [ShiftsController, HoursController],
  providers: [ShiftsService, TimesheetService, HoursService],
  exports: [TimesheetService, ShiftsService],
})
export class ShiftsModule {}
