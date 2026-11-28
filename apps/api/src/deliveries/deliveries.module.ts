import { Module } from '@nestjs/common';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DueNextService } from './due-next.service';
import { WallLinksController } from './wall-links.controller';
import { WallLinksService } from './wall-links.service';

@Module({
  controllers: [DeliveriesController, WallLinksController],
  providers: [DeliveriesService, DueNextService, WallLinksService],
  exports: [DueNextService, DeliveriesService],
})
export class DeliveriesModule {}
