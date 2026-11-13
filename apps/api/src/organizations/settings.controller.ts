import { Controller, Get, Put } from '@nestjs/common';
import { IfMatchVersion } from '../common/if-match';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  RequireOrg,
} from '../common/request-context';
import { ZodBody } from '../common/zod';
import { type UpdateBotAccessInput, updateBotAccessSchema } from '../permissions/bot-access';
import {
  type UpdateEmployeeAccessInput,
  updateEmployeeAccessSchema,
} from '../permissions/employee-access';
import { SettingsService } from './settings.service';

/**
 * The organization admin's permission settings. Both are changed only by a person by default:
 * the bot may change Employee access only when Bot permissions allow it, and never Bot permissions.
 */
@Controller('organization')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('employee-access')
  @RequireOrg('employeeAccess.manage')
  getEmployeeAccess(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.settings.get(user, org, 'employeeAccess');
  }

  @Put('employee-access')
  @RequireOrg('employeeAccess.manage')
  updateEmployeeAccess(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @IfMatchVersion() version: number,
    @ZodBody(updateEmployeeAccessSchema) body: UpdateEmployeeAccessInput,
  ) {
    return this.settings.update(user, org, 'employeeAccess', version, body);
  }

  @Get('bot-access')
  @RequireOrg('botAccess.manage')
  getBotAccess(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.settings.get(user, org, 'botAccess');
  }

  @Put('bot-access')
  @RequireOrg('botAccess.manage')
  updateBotAccess(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @IfMatchVersion() version: number,
    @ZodBody(updateBotAccessSchema) body: UpdateBotAccessInput,
  ) {
    return this.settings.update(user, org, 'botAccess', version, body);
  }
}
