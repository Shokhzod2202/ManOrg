import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { IfMatchVersion } from '../common/if-match';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  RequireOrg,
} from '../common/request-context';
import { ZodBody, ZodQuery } from '../common/zod';
import {
  type ChangeRequestInput,
  changeListSchema,
  changeRequestSchema,
  type ListOrdersInput,
  listOrdersSchema,
  type PlaceOrderInput,
  placeOrderSchema,
  providerQuerySchema,
  type SetLinesInput,
  setLinesSchema,
  totalsQuerySchema,
} from './orders.schemas';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('providers')
  @RequireOrg('orders.place')
  providers(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.orders.providers(user, org);
  }

  @Get('catalog')
  @RequireOrg('orders.place')
  catalog(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(providerQuerySchema) query: z.infer<typeof providerQuerySchema>,
  ) {
    return this.orders.catalog(user, org, query.provider_id);
  }

  @Get('orders/default-date')
  @RequireOrg('orders.place')
  defaultDate(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(providerQuerySchema) query: z.infer<typeof providerQuerySchema>,
  ) {
    return this.orders.defaultDate(user, org, query.provider_id);
  }

  @Post('orders')
  @RequireOrg('orders.place')
  place(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(placeOrderSchema) body: PlaceOrderInput,
  ) {
    return this.orders.place(user, org, body);
  }

  @Get('orders')
  @RequireOrg('orders.readHistory')
  list(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(listOrdersSchema) query: ListOrdersInput,
  ) {
    return this.orders.list(user, org, query);
  }

  @Get('orders/totals')
  @RequireOrg('orders.readHistory')
  totals(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(totalsQuerySchema) query: z.infer<typeof totalsQuerySchema>,
  ) {
    return this.orders.totals(user, org, query.delivery_date);
  }

  @Get('orders/:id')
  @RequireOrg('orders.readHistory')
  get(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.get(user, org, id);
  }

  @Put('orders/:id/lines')
  @RequireOrg('orders.edit')
  setLines(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @IfMatchVersion() version: number,
    @ZodBody(setLinesSchema) body: SetLinesInput,
  ) {
    return this.orders.setLines(user, org, id, version, body);
  }

  @Post('orders/:id/change-requests')
  @RequireOrg('orders.place')
  requestChange(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(changeRequestSchema) body: ChangeRequestInput,
  ) {
    return this.orders.requestChange(user, org, id, body);
  }

  @Get('order-change-requests')
  @RequireOrg()
  listChangeRequests(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(changeListSchema) query: z.infer<typeof changeListSchema>,
  ) {
    return this.orders.listChangeRequests(user, org, query.status);
  }

  @Post('order-change-items/:id/accept')
  @HttpCode(200)
  @RequireOrg()
  accept(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.decideItem(user, org, id, true);
  }

  @Post('order-change-items/:id/reject')
  @HttpCode(200)
  @RequireOrg()
  reject(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.decideItem(user, org, id, false);
  }
}
