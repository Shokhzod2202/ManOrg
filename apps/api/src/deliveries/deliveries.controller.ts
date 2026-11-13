import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { Errors } from '../common/errors';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  RequireOrg,
} from '../common/request-context';
import { isoDate } from '../common/time';
import { ZodBody, ZodQuery } from '../common/zod';
import {
  type ApproxTimeInput,
  approxTimeSchema,
  decisionSchema,
  type DeliveryChangeInput,
  deliveryChangeSchema,
  type ListDeliveriesInput,
  listDeliveriesSchema,
  type SaveDeliveryInput,
  saveDeliverySchema,
} from './deliveries.schemas';
import { DeliveriesService } from './deliveries.service';
import { DueNextService } from './due-next.service';

const contractorQuery = z.object({ contractor_id: z.uuid().optional() });

function dateParam(date: string): string {
  if (!isoDate.safeParse(date).success) throw Errors.validation({ date: ['Use YYYY-MM-DD.'] });
  return date;
}

@Controller()
export class DeliveriesController {
  constructor(
    private readonly deliveries: DeliveriesService,
    private readonly dueNext: DueNextService,
  ) {}

  @Get('contractors')
  @RequireOrg('deliveries.record')
  contractors(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.deliveries.contractors(user, org);
  }

  @Put('contractors/:id/approx-time')
  @RequireOrg('deliveries.record')
  setApproxTime(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(approxTimeSchema) body: ApproxTimeInput,
  ) {
    return this.deliveries.setApproxTime(user, org, id, body);
  }

  @Get('deliveries')
  @RequireOrg('deliveries.read')
  list(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(listDeliveriesSchema) query: ListDeliveriesInput,
  ) {
    return this.deliveries.list(user, org, query);
  }

  @Get('deliveries/:id')
  @RequireOrg('deliveries.read')
  get(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.deliveries.get(user, org, id);
  }

  @Get('deliveries/:contractorId/:date')
  @RequireOrg('deliveries.record')
  getForDay(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('contractorId', new ParseUUIDPipe()) contractorId: string,
    @Param('date') date: string,
  ) {
    return this.deliveries.getForDay(user, org, contractorId, dateParam(date));
  }

  @Put('deliveries/:contractorId/:date')
  @RequireOrg('deliveries.record')
  save(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('contractorId', new ParseUUIDPipe()) contractorId: string,
    @Param('date') date: string,
    @ZodBody(saveDeliverySchema) body: SaveDeliveryInput,
  ) {
    return this.deliveries.save(user, org, contractorId, dateParam(date), body);
  }

  @Post('deliveries/:id/complete')
  @HttpCode(200)
  @RequireOrg('deliveries.record')
  complete(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.deliveries.complete(user, org, id);
  }

  @Post('deliveries/:id/confirm')
  @HttpCode(200)
  @RequireOrg('deliveries.confirm')
  confirm(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.deliveries.confirm(user, org, id);
  }

  @Post('deliveries/:id/change-requests')
  @RequireOrg('deliveries.requestChange')
  requestChange(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(deliveryChangeSchema) body: DeliveryChangeInput,
  ) {
    return this.deliveries.requestChange(user, org, id, body);
  }

  @Post('deliveries/:id/change-requests/:requestId/decision')
  @HttpCode(200)
  @RequireOrg('deliveries.decideChange')
  decide(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @ZodBody(decisionSchema) body: z.infer<typeof decisionSchema>,
  ) {
    return this.deliveries.decideChange(user, org, id, requestId, body.decision === 'approve');
  }

  @Get('orders/due-next')
  @RequireOrg('orders.readDueNext')
  dueNextOrders(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(contractorQuery) query: z.infer<typeof contractorQuery>,
  ) {
    return this.dueNext.dueNext(user, org, query.contractor_id);
  }

  @Get('employees/:id/orders/due-next')
  @RequireOrg('orders.readDueNext')
  employeeDueNext(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.dueNext.forEmployee(user, org, id);
  }
}
