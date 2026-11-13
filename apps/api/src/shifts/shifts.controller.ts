import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { Errors } from '../common/errors';
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
  type AddPunchInput,
  addPunchSchema,
  type ChangeRequestInput,
  changeRequestSchema,
  type DecisionInput,
  decisionSchema,
  type EditPunchInput,
  editPunchSchema,
  listChangeRequestsSchema,
  type PunchInput,
  punchSchema,
  type RangeInput,
  rangeSchema,
  type SetShiftsInput,
  setShiftsSchema,
} from './shifts.schemas';
import { ShiftsService } from './shifts.service';

const employeeQuery = z.object({ employee_id: z.uuid().optional() });
const idempotencyKey = z.string().min(8).max(100).optional();

/** Shifts and punch cards belong to provider organizations; contractor admins have none. */
function providerOnly(org: OrgContext): void {
  if (org.organizationType !== 'provider') throw Errors.forbidden();
}

@Controller()
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('shifts')
  @RequireOrg()
  listPlans(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(employeeQuery) query: z.infer<typeof employeeQuery>,
  ) {
    providerOnly(org);
    return this.shifts.listPlans(user, org, query.employee_id);
  }

  @Put('shifts')
  @RequireOrg('shifts.set')
  setPlan(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(setShiftsSchema) body: SetShiftsInput,
  ) {
    return this.shifts.setPlan(user, org, body);
  }

  @Get('punch/card')
  @RequireOrg('punch.self')
  card(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.shifts.card(user, org);
  }

  @Post('punch')
  @HttpCode(200)
  @RequireOrg('punch.self')
  punch(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(punchSchema) body: PunchInput,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const parsed = idempotencyKey.safeParse(key);
    if (!parsed.success)
      throw Errors.badRequest(
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key must be 8 to 100 characters.',
      );
    return this.shifts.punch(user, org, body, parsed.data);
  }

  @Get('punch')
  @RequireOrg()
  history(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(rangeSchema) query: RangeInput,
  ) {
    providerOnly(org);
    return this.shifts.history(user, org, query);
  }

  @Patch('punch/:id')
  @RequireOrg('punch.edit')
  editPunch(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @IfMatchVersion() version: number,
    @ZodBody(editPunchSchema) body: EditPunchInput,
  ) {
    return this.shifts.editPunch(user, org, id, version, body);
  }

  @Post('punch-events')
  @RequireOrg('punch.edit')
  addPunch(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(addPunchSchema) body: AddPunchInput,
  ) {
    return this.shifts.addPunch(user, org, body);
  }

  @Post('punch-change-requests')
  @RequireOrg('punch.requestChange')
  requestChange(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(changeRequestSchema) body: ChangeRequestInput,
  ) {
    return this.shifts.requestChange(user, org, body);
  }

  @Get('punch-change-requests')
  @RequireOrg()
  listRequests(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(listChangeRequestsSchema) query: z.infer<typeof listChangeRequestsSchema>,
  ) {
    providerOnly(org);
    return this.shifts.listRequests(user, org, query.status);
  }

  @Post('punch-change-requests/:id/decision')
  @HttpCode(200)
  @RequireOrg('punch.edit')
  decide(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(decisionSchema) body: DecisionInput,
  ) {
    return this.shifts.decide(user, org, id, body);
  }

  @Get('dashboard/shifts')
  @RequireOrg('shifts.read')
  dashboard(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(rangeSchema) query: RangeInput,
  ) {
    return this.shifts.dashboard(user, org, query, false);
  }

  @Get('dashboard/me')
  @RequireOrg()
  myDashboard(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(rangeSchema) query: RangeInput,
  ) {
    providerOnly(org);
    return this.shifts.dashboard(user, org, query, true);
  }
}
