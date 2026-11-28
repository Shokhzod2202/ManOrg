import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IfMatchVersion } from '../common/if-match';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  RequireOrg,
} from '../common/request-context';
import { ZodBody } from '../common/zod';
import {
  type CreateRecurringInput,
  createRecurringSchema,
  RecurringTasksService,
  type UpdateRecurringInput,
  updateRecurringSchema,
} from './recurring-tasks.service';

/** Phase 3 repeating tasks: rules that make an ordinary task on each due day. */
@Controller('recurring-tasks')
export class RecurringTasksController {
  constructor(private readonly recurring: RecurringTasksService) {}

  @Get()
  @RequireOrg('tasks.manage')
  list(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.recurring.list(user, org);
  }

  @Post()
  @RequireOrg('tasks.manage')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(createRecurringSchema) body: CreateRecurringInput,
  ) {
    return this.recurring.create(user, org, body);
  }

  @Patch(':id')
  @RequireOrg('tasks.manage')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @IfMatchVersion() version: number,
    @ZodBody(updateRecurringSchema) body: UpdateRecurringInput,
  ) {
    return this.recurring.update(user, org, id, version, body);
  }
}
