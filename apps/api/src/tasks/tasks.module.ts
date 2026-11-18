import { Module } from '@nestjs/common';
import { IngredientOrdersService } from './ingredient-orders.service';
import { RecurringTasksController } from './recurring-tasks.controller';
import { RecurringTasksService } from './recurring-tasks.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController, RecurringTasksController],
  providers: [TasksService, IngredientOrdersService, RecurringTasksService],
  exports: [IngredientOrdersService, TasksService, RecurringTasksService],
})
export class TasksModule {}
