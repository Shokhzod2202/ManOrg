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
  outputQuerySchema,
  type OutputRangeInput,
  outputRangeSchema,
  type PutOutputInput,
  putOutputSchema,
  type UpdateTeamInput,
  updateTeamSchema,
} from './output.schemas';
import { OutputService } from './output.service';

function providerOnly(org: OrgContext): void {
  if (org.organizationType !== 'provider') throw Errors.forbidden();
}

@Controller()
export class OutputController {
  constructor(private readonly output: OutputService) {}

  @Get('teams')
  @RequireOrg('teams.manage')
  listTeams(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.output.listTeams(user, org);
  }

  @Post('teams')
  @RequireOrg('teams.manage')
  createTeam(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(createTeamSchema) body: CreateTeamInput,
  ) {
    return this.output.createTeam(user, org, body);
  }

  @Patch('teams/:id')
  @RequireOrg('teams.manage')
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
  @RequireOrg('teams.manage')
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
    providerOnly(org);
    return this.output.getOutput(user, org, query);
  }

  @Get('dashboard/shift-output')
  @RequireOrg()
  shiftOutput(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(dayQuerySchema) query: z.infer<typeof dayQuerySchema>,
  ) {
    providerOnly(org);
    return this.output.shiftOutput(user, org, query.date);
  }
}
