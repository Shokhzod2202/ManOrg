import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  OptionalCurrentOrg,
  OptionalOrg,
  type OrgContext,
} from '../common/request-context';
import { ZodBody, ZodQuery } from '../common/zod';
import {
  type CreateOrganizationInput,
  createOrganizationSchema,
  type SearchOrganizationsInput,
  searchOrganizationsSchema,
} from './organizations.schemas';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  search(
    @CurrentUser() user: AuthUser,
    @ZodQuery(searchOrganizationsSchema) query: SearchOrganizationsInput,
  ) {
    return this.organizations.search(user, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @ZodBody(createOrganizationSchema) body: CreateOrganizationInput,
  ) {
    return this.organizations.create(user, body);
  }

  @Post(':id/applications')
  @OptionalOrg('organization.apply')
  apply(
    @CurrentUser() user: AuthUser,
    @OptionalCurrentOrg() org: OrgContext | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.organizations.apply(user, org, id);
  }
}
