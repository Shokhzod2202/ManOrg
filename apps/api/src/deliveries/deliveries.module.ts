import { Module } from '@nestjs/common';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DueNextService } from './due-next.service';

@Module({
  controllers: [DeliveriesController],
  providers: [DeliveriesService, DueNextService],
  exports: [DueNextService],
})
export class DeliveriesModule {}
