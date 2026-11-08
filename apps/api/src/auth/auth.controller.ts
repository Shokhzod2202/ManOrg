import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/request-context';
import { ZodBody } from '../common/zod';
import {
  type LoginInput,
  loginSchema,
  type RefreshInput,
  refreshSchema,
  type RegisterInput,
  registerSchema,
} from './auth.schemas';
import { AuthService } from './auth.service';

/** Rate-limited per client (spec section 12). */
@Public()
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@ZodBody(registerSchema) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  login(@ZodBody(loginSchema) body: LoginInput) {
    return this.auth.login(body);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@ZodBody(refreshSchema) body: RefreshInput) {
    return this.auth.refresh(body);
  }
}
