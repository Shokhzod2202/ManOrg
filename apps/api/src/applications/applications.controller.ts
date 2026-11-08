import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  RequireOrg,
} from '../common/request-context';
import { ApplicationsService } from './applications.service';

@Controller('applications')
@RequireOrg('applications.decide')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.applications.list(user, org);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.applications.decide(user, org, id, 'approve');
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.applications.decide(user, org, id, 'reject');
  }
}
