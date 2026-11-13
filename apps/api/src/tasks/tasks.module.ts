import { Module } from '@nestjs/common';
import { IngredientOrdersService } from './ingredient-orders.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService, IngredientOrdersService],
  exports: [IngredientOrdersService],
})
export class TasksModule {}
