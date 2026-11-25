import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type AuthUser, CurrentUser } from '../common/request-context';
import { ZodBody } from '../common/zod';
import { type UpdateMeInput, updateMeSchema } from './me.schemas';
import { MAX_AVATAR_BYTES, MeService } from './me.service';

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

  /** Decided 2026-11-25: each person can set a profile picture. */
  @Post('avatar')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } }))
  setAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.me.setAvatar(user, file);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.me.removeAvatar(user);
  }

  /** Ends every session on every device, this one too. */
  @Post('sign-out-everywhere')
  @HttpCode(204)
  async signOutEverywhere(@CurrentUser() user: AuthUser): Promise<void> {
    await this.me.signOutEverywhere(user);
  }
}
