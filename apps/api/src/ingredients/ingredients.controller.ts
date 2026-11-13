import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
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
  type CreateIngredientInput,
  createIngredientSchema,
  type SetResponsibleInput,
  setResponsibleSchema,
  type SetPriceInput,
  setPriceSchema,
  type UpdateIngredientInput,
  updateIngredientSchema,
} from './ingredients.schemas';
import { IngredientsService } from './ingredients.service';

@Controller('ingredients')
export class IngredientsController {
  constructor(private readonly ingredients: IngredientsService) {}

  /** Everyone who may order ingredients sees the list (ING-4, ING-5). */
  @Get()
  @RequireOrg('ingredients.order')
  list(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.ingredients.list(user, org);
  }

  @Get(':id')
  @RequireOrg('ingredients.order')
  get(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.ingredients.get(user, org, id);
  }

  @Post()
  @RequireOrg('ingredients.manage')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(createIngredientSchema) body: CreateIngredientInput,
  ) {
    return this.ingredients.create(user, org, body);
  }

  @Patch(':id')
  @RequireOrg('ingredients.manage')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @IfMatchVersion() version: number,
    @ZodBody(updateIngredientSchema) body: UpdateIngredientInput,
  ) {
    return this.ingredients.update(user, org, id, version, body);
  }

  @Put(':id/price')
  @RequireOrg('ingredients.manage')
  setPrice(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(setPriceSchema) body: SetPriceInput,
  ) {
    return this.ingredients.setPrice(user, org, id, body);
  }

  @Get(':id/prices')
  @RequireOrg('ingredients.readPrices')
  prices(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.ingredients.prices(user, org, id);
  }

  @Put(':id/responsible')
  @RequireOrg('ingredients.assignResponsibility')
  setResponsible(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(setResponsibleSchema) body: SetResponsibleInput,
  ) {
    return this.ingredients.setResponsible(user, org, id, body);
  }
}
