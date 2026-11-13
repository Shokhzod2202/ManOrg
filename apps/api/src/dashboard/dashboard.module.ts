import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { OutputModule } from '../output/output.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [ShiftsModule, OutputModule, DeliveriesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
