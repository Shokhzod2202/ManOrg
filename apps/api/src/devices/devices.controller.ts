import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../common/request-context';
import { ZodBody } from '../common/zod';
import { DevicesService } from './devices.service';

const deviceSchema = z.strictObject({
  token: z.string().min(10).max(300),
  platform: z.enum(['ios', 'android']),
});
const removeSchema = z.strictObject({ token: z.string().min(10).max(300) });

@Controller('me')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** Called by the web app only inside the Haydar phone app, to hand the app its own session. */
  @Post('device-session')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  session(@CurrentUser() user: AuthUser) {
    return this.devices.deviceSession(user);
  }

  @Post('devices')
  @HttpCode(204)
  async register(
    @CurrentUser() user: AuthUser,
    @ZodBody(deviceSchema) body: z.infer<typeof deviceSchema>,
  ) {
    await this.devices.register(user, body);
  }

  @Post('devices/remove')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @ZodBody(removeSchema) body: z.infer<typeof removeSchema>,
  ) {
    await this.devices.remove(user, body.token);
  }
}
