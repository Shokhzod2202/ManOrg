import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/request-context';
import { ZodBody } from '../common/zod';
import {
  type LoginInput,
  loginSchema,
  type PasswordResetConfirmInput,
  passwordResetConfirmSchema,
  type PasswordResetRequestInput,
  passwordResetRequestSchema,
  type RefreshInput,
  refreshSchema,
  type RegisterInput,
  registerSchema,
} from './auth.schemas';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';

/**
 * Sign-in and registration are rate-limited per client (spec section 12). Refresh and sign-out get
 * a higher limit: every page load refreshes, and a whole bakery may share one network address.
 */
const SESSION_LIMIT = 300;

@Public()
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly resets: PasswordResetService,
  ) {}

  /**
   * Decided 2026-11-29: "Forgot password". Always 202 with the same answer, so it never tells
   * whether an account uses the email. Rate-limited like sign-in.
   */
  @Post('password-reset')
  @HttpCode(202)
  async requestReset(
    @ZodBody(passwordResetRequestSchema) body: PasswordResetRequestInput,
  ): Promise<{ sent: true }> {
    await this.resets.request(body.email);
    return { sent: true };
  }

  /** Sets the new password with the emailed one-time link; every session then ends. */
  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmReset(
    @ZodBody(passwordResetConfirmSchema) body: PasswordResetConfirmInput,
  ): Promise<void> {
    await this.resets.confirm(body.token, body.password);
  }

  @Post('register')
  register(@ZodBody(registerSchema) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  login(@ZodBody(loginSchema) body: LoginInput) {
    return this.auth.login(body);
  }

  /** Sign-out: revokes the refresh token's session. Always 204, so it reveals nothing. */
  @Post('logout')
  @HttpCode(204)
  @Throttle({ default: { limit: SESSION_LIMIT, ttl: 60_000 } })
  async logout(@ZodBody(refreshSchema) body: RefreshInput): Promise<void> {
    await this.auth.logout(body);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: SESSION_LIMIT, ttl: 60_000 } })
  refresh(@ZodBody(refreshSchema) body: RefreshInput) {
    return this.auth.refresh(body);
  }
}
