import { Controller, Get } from '@nestjs/common';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  RequireOrg,
} from '../common/request-context';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('today')
  @RequireOrg('organization.readAll')
  today(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.dashboard.today(user, org);
  }

  @Get('home')
  @RequireOrg('punch.self')
  home(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.dashboard.home(user, org);
  }
}
