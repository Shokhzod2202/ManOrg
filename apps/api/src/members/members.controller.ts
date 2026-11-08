import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
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
  type CreateMemberInput,
  createMemberSchema,
  type ListMembersInput,
  listMembersSchema,
  type UpdateMemberInput,
  updateMemberSchema,
} from './members.schemas';
import { MembersService } from './members.service';

@Controller('members')
@RequireOrg('members.manage')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodQuery(listMembersSchema) query: ListMembersInput,
  ) {
    return this.members.list(user, org, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(createMemberSchema) body: CreateMemberInput,
  ) {
    return this.members.create(user, org, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @IfMatchVersion() version: number,
    @ZodBody(updateMemberSchema) body: UpdateMemberInput,
  ) {
    return this.members.update(user, org, id, version, body);
  }
}
