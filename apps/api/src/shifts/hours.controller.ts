import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  RequireOrg,
} from '../common/request-context';
import { ZodBody, ZodQuery } from '../common/zod';
import {
  type CancelAdvanceInput,
  cancelAdvanceSchema,
  type CreateAdvanceInput,
  createAdvanceSchema,
  type HourlyRateInput,
  hourlyRateSchema,
  type HoursQuery,
  hoursQuerySchema,
} from './hours.schemas';
import { HoursService } from './hours.service';

/** Decided 2026-11-30: worked hours from punch cards, and salary advances ("avans"). */
@Controller()
export class HoursController {
  constructor(private readonly hours: HoursService) {}

  /** One month: each person's worked hours per day and in total, and their advances. */
  @Get('work-hours')
  @RequireOrg('hours.read')
  month(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(hoursQuerySchema) query: HoursQuery,
  ) {
    return this.hours.month(user, org, query);
  }

  @Post('salary-advances')
  @RequireOrg('advances.manage')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(createAdvanceSchema) body: CreateAdvanceInput,
  ) {
    return this.hours.createAdvance(user, org, body);
  }

  @Post('salary-advances/:id/cancel')
  @HttpCode(200)
  @RequireOrg('advances.manage')
  cancel(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(cancelAdvanceSchema) body: CancelAdvanceInput,
  ) {
    return this.hours.cancelAdvance(user, org, id, body);
  }

  /** Decided 2026-11-26: everyone's current hourly cost. Owners only (403 for other admins). */
  @Get('hourly-rates')
  @RequireOrg('advances.manage')
  rates(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.hours.rates(user, org);
  }

  @Put('employees/:id/hourly-rate')
  @RequireOrg('advances.manage')
  setRate(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(hourlyRateSchema) body: HourlyRateInput,
  ) {
    return this.hours.setRate(user, org, id, body.hourlyRate);
  }
}
