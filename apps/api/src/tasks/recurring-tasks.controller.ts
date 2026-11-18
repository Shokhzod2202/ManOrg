import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Errors } from '../common/errors';
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

function providerOnly(org: OrgContext): void {
  if (org.organizationType !== 'provider') throw Errors.forbidden();
}

/** Phase 3 repeating tasks: rules that make an ordinary task on each due day. */
@Controller('recurring-tasks')
export class RecurringTasksController {
  constructor(private readonly recurring: RecurringTasksService) {}

  @Get()
  @RequireOrg('tasks.manage')
  list(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    providerOnly(org);
    return this.recurring.list(user, org);
  }

  @Post()
  @RequireOrg('tasks.manage')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(createRecurringSchema) body: CreateRecurringInput,
  ) {
    providerOnly(org);
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
    providerOnly(org);
    return this.recurring.update(user, org, id, version, body);
  }
}
