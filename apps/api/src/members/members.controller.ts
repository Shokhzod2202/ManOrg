import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
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
  type HandOverInput,
  handOverSchema,
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

  /**
   * Decided 2026-11-28: take a person out of shifts, teams, tasks, ingredient ordering and the
   * products they log, or hand all of it to another employee (toUserId). History never changes.
   */
  @Post(':id/hand-over')
  @HttpCode(200)
  handOver(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(handOverSchema) body: HandOverInput,
  ) {
    return this.members.handOver(user, org, id, body);
  }

  /** Decided 2026-11-30: undo a removal within 3 days. */
  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.members.restore(user, org, id);
  }

  /** Decided 2026-11-27: an owner makes another member an owner too. */
  @Post(':id/owner')
  @HttpCode(200)
  shareOwnership(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.members.shareOwnership(user, org, id);
  }

  /**
   * An owner stops being an owner (themselves; at least one owner stays), or, within 3 days, the
   * owner who made someone an owner undoes it (decided 2026-11-30).
   */
  @Delete(':id/owner')
  leaveOwnership(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.members.leaveOwnership(user, org, id);
  }
}
