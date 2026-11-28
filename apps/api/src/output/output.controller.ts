import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
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
  type CreateTeamInput,
  createTeamSchema,
  dayQuerySchema,
  efficiencyQuerySchema,
  outputQuerySchema,
  type OutputRangeInput,
  outputRangeSchema,
  type PutOutputInput,
  putOutputSchema,
  type UpdateTeamInput,
  updateTeamSchema,
} from './output.schemas';
import { OutputService } from './output.service';

@Controller()
export class OutputController {
  constructor(private readonly output: OutputService) {}

  @Get('colleagues')
  @RequireOrg('teams.manage')
  colleagues(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.output.colleagues(user, org);
  }

  @Get('teams')
  @RequireOrg()
  listTeams(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.output.listTeams(user, org);
  }

  @Post('teams')
  @RequireOrg()
  createTeam(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(createTeamSchema) body: CreateTeamInput,
  ) {
    return this.output.createTeam(user, org, body);
  }

  @Patch('teams/:id')
  @RequireOrg()
  updateTeam(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(updateTeamSchema) body: UpdateTeamInput,
  ) {
    return this.output.updateTeam(user, org, id, body);
  }

  @Delete('teams/:id')
  @HttpCode(204)
  @RequireOrg()
  async deleteTeam(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.output.deleteTeam(user, org, id);
  }

  @Put('output/:date')
  @RequireOrg('output.log')
  putOutput(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('date') date: string,
    @ZodQuery(outputQuerySchema) query: z.infer<typeof outputQuerySchema>,
    @ZodBody(putOutputSchema) body: PutOutputInput,
  ) {
    if (!isoDate.safeParse(date).success) throw Errors.validation({ date: ['Use YYYY-MM-DD.'] });
    return this.output.putOutput(user, org, date, body, query.employee_id);
  }

  @Get('output')
  @RequireOrg()
  getOutput(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(outputRangeSchema) query: OutputRangeInput,
  ) {
    return this.output.getOutput(user, org, query);
  }

  /** Decided 2026-11-26: each employee's latest day with output. */
  @Get('dashboard/output-latest')
  @RequireOrg()
  latest(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.output.latest(user, org);
  }

  /** Decided 2026-11-26: one employee's month: what their output brought in (admins). */
  @Get('output/efficiency')
  @RequireOrg('prices.manage')
  efficiency(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(efficiencyQuerySchema) query: z.infer<typeof efficiencyQuerySchema>,
  ) {
    return this.output.efficiency(user, org, query.employee_id, query.month);
  }

  @Get('dashboard/shift-output')
  @RequireOrg()
  shiftOutput(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(dayQuerySchema) query: z.infer<typeof dayQuerySchema>,
  ) {
    return this.output.shiftOutput(user, org, query.date);
  }
}
