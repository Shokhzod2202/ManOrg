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
import {
  type UpdateEmployeeAccessInput,
  updateEmployeeAccessSchema,
} from '../permissions/employee-access';
import { EmployeeAccessService } from './employee-access.service';

@Controller('organization/employee-access')
@RequireOrg('employeeAccess.manage')
export class EmployeeAccessController {
  constructor(private readonly employeeAccess: EmployeeAccessService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.employeeAccess.get(user, org);
  }

  @Put()
  update(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @IfMatchVersion() version: number,
    @ZodBody(updateEmployeeAccessSchema) body: UpdateEmployeeAccessInput,
  ) {
    return this.employeeAccess.update(user, org, version, body);
  }
}
