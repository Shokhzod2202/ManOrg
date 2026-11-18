import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type z } from 'zod';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  RequireOrg,
} from '../common/request-context';
import { ZodBody, ZodQuery } from '../common/zod';
import {
  approvePaymentSchema,
  pairQuery,
  paymentsQuery,
  rangeQuery,
  reallocateSchema,
  rejectPaymentSchema,
  reverseSchema,
  scheduleSchema,
  submitPaymentSchema,
  summaryQuery,
} from './finance.schemas';
import { FinanceService, MAX_PROOF_BYTES } from './finance.service';

/** F-001: money for the bakery admin (all contractors) and the contractor admin (its own). */
@Controller()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('finance/summary')
  @RequireOrg('finance.view')
  summary(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(summaryQuery) q: z.infer<typeof summaryQuery>,
  ) {
    return this.finance.summary(user, org, q);
  }

  @Get('finance/deliveries')
  @RequireOrg('finance.view')
  deliveries(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(rangeQuery) q: z.infer<typeof rangeQuery>,
  ) {
    return this.finance.deliveries(user, org, q);
  }

  @Get('finance/history')
  @RequireOrg('finance.view')
  history(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(rangeQuery) q: z.infer<typeof rangeQuery>,
  ) {
    return this.finance.history(user, org, q);
  }

  @Post('payments')
  @RequireOrg('payments.submit')
  @UseInterceptors(FileInterceptor('proof', { limits: { fileSize: MAX_PROOF_BYTES + 1 } }))
  submit(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(submitPaymentSchema) body: z.infer<typeof submitPaymentSchema>,
    @UploadedFile() proof: Express.Multer.File | undefined,
  ) {
    return this.finance.submit(user, org, body, proof);
  }

  @Get('payments')
  @RequireOrg('payments.view')
  payments(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(paymentsQuery) q: z.infer<typeof paymentsQuery>,
  ) {
    return this.finance.listPayments(user, org, q);
  }

  @Post('payments/:id/cancel')
  @HttpCode(200)
  @RequireOrg('payments.submit')
  cancel(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.finance.cancel(user, org, id);
  }

  @Post('payments/:id/approve')
  @HttpCode(200)
  @RequireOrg('payments.review')
  approve(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(approvePaymentSchema) body: z.infer<typeof approvePaymentSchema>,
  ) {
    return this.finance.approve(user, org, id, body);
  }

  @Post('payments/:id/reject')
  @HttpCode(200)
  @RequireOrg('payments.review')
  reject(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(rejectPaymentSchema) body: z.infer<typeof rejectPaymentSchema>,
  ) {
    return this.finance.reject(user, org, id, body.reason);
  }

  @Put('payments/:id/allocations')
  @RequireOrg('payments.review')
  reallocate(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(reallocateSchema) body: z.infer<typeof reallocateSchema>,
  ) {
    return this.finance.reallocate(user, org, id, body);
  }

  @Post('payments/:id/reverse')
  @HttpCode(200)
  @RequireOrg('payments.review')
  reverse(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(reverseSchema) body: z.infer<typeof reverseSchema>,
  ) {
    return this.finance.reverse(user, org, id, body.reason);
  }

  @Get('settlement-schedules')
  @RequireOrg('settlement.view')
  schedule(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(pairQuery) q: z.infer<typeof pairQuery>,
  ) {
    return this.finance.schedule(user, org, q);
  }

  @Put('contractors/:id/settlement-schedule')
  @RequireOrg('settlement.edit')
  setSchedule(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(scheduleSchema) body: z.infer<typeof scheduleSchema>,
  ) {
    return this.finance.setSchedule(user, org, id, body);
  }

  @Get('settlement-reports/:periodId')
  @RequireOrg('settlement.view')
  report(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('periodId', new ParseUUIDPipe()) id: string,
  ) {
    return this.finance.report(user, org, id);
  }

  @Post('settlement-reports/:periodId/close')
  @HttpCode(200)
  @RequireOrg('settlement.close')
  close(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('periodId', new ParseUUIDPipe()) id: string,
  ) {
    return this.finance.close(user, org, id);
  }
}
