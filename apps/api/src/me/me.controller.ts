import { Controller, Get, Patch } from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../common/request-context';
import { ZodBody } from '../common/zod';
import { type UpdateMeInput, updateMeSchema } from './me.schemas';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.me.get(user);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @ZodBody(updateMeSchema) body: UpdateMeInput) {
    return this.me.update(user, body);
  }
}
