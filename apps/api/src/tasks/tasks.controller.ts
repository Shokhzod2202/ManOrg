import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { Errors } from '../common/errors';
import { IfMatchVersion } from '../common/if-match';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  RequireOrg,
} from '../common/request-context';
import { ZodBody, ZodQuery } from '../common/zod';
import { IngredientOrdersService } from './ingredient-orders.service';
import {
  type CreateIngredientOrderInput,
  createIngredientOrderSchema,
  type CreateTaskInput,
  createTaskSchema,
  listIngredientOrdersSchema,
  type ListTasksInput,
  listTasksSchema,
  type UpdateTaskInput,
  updateTaskSchema,
} from './tasks.schemas';
import { MAX_TASK_PHOTO_BYTES, TasksService } from './tasks.service';

function providerOnly(org: OrgContext): void {
  if (org.organizationType !== 'provider') throw Errors.forbidden();
}

const completeFields = z.object({ captureToken: z.string().min(10).max(200).optional() });

@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly ingredientOrders: IngredientOrdersService,
  ) {}

  @Post('tasks')
  @RequireOrg('tasks.manage')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(createTaskSchema) body: CreateTaskInput,
  ) {
    return this.tasks.create(user, org, body);
  }

  @Get('tasks')
  @RequireOrg()
  list(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(listTasksSchema) query: ListTasksInput,
  ) {
    providerOnly(org);
    return this.tasks.list(user, org, query);
  }

  @Get('tasks/:id')
  @RequireOrg()
  get(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    providerOnly(org);
    return this.tasks.get(user, org, id);
  }

  @Patch('tasks/:id')
  @RequireOrg('tasks.manage')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @IfMatchVersion() version: number,
    @ZodBody(updateTaskSchema) body: UpdateTaskInput,
  ) {
    return this.tasks.update(user, org, id, version, body);
  }

  @Post('tasks/:id/capture-token')
  @RequireOrg('tasks.complete')
  captureToken(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.tasks.captureToken(user, org, id);
  }

  @Post('tasks/:id/complete')
  @HttpCode(200)
  @RequireOrg('tasks.complete')
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: MAX_TASK_PHOTO_BYTES, files: 1 } }),
  )
  complete(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() fields: unknown,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ) {
    const parsed = completeFields.safeParse(fields ?? {});
    if (!parsed.success) throw Errors.validation({ captureToken: ['Invalid capture token.'] });
    return this.tasks.complete(user, org, id, parsed.data.captureToken, photo);
  }

  @Post('ingredient-orders')
  @RequireOrg('ingredients.order')
  orderIngredient(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(createIngredientOrderSchema) body: CreateIngredientOrderInput,
  ) {
    return this.ingredientOrders.create(user, org, body);
  }

  @Get('ingredient-orders')
  @RequireOrg()
  listIngredientOrders(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(listIngredientOrdersSchema) query: z.infer<typeof listIngredientOrdersSchema>,
  ) {
    providerOnly(org);
    return this.ingredientOrders.list(user, org, query.status);
  }

  @Post('ingredient-orders/:id/fulfil')
  @HttpCode(200)
  @RequireOrg('ingredients.fulfil')
  fulfil(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.ingredientOrders.advance(user, org, id, 'fulfil');
  }

  @Post('ingredient-orders/:id/check')
  @HttpCode(200)
  @RequireOrg('ingredients.fulfil')
  check(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.ingredientOrders.advance(user, org, id, 'check');
  }
}
