import { Controller, Get, Put } from '@nestjs/common';
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
import { type UpdateBotAccessInput, updateBotAccessSchema } from '../permissions/bot-access';
import {
  type UpdateEmployeeAccessInput,
  updateEmployeeAccessSchema,
} from '../permissions/employee-access';
import { type LocationInput, locationSchema, SettingsService } from './settings.service';

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
    // Decided 2026-11-26: these switches can let the bot change who is an admin, so only the owner
    // changes them.
    if (!org.owner) throw Errors.forbidden('Only the owner can change the bot permissions.');
    return this.settings.update(user, org, 'botAccess', version, body);
  }

  /** Spec section 9: any member reads it (the phone registers the geofence); admins change it. */
  @Get('location')
  @RequireOrg()
  getLocation(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    return this.settings.location(user, org);
  }

  @Put('location')
  @RequireOrg('location.manage')
  updateLocation(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @IfMatchVersion() version: number,
    @ZodBody(locationSchema) body: LocationInput,
  ) {
    return this.settings.updateLocation(user, org, version, body);
  }
}
