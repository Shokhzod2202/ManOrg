import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../common/request-context';
import { ZodQuery } from '../common/zod';
import { NotificationsService } from './notifications.service';

const listQuery = z.object({ unread: z.enum(['true', 'false']).default('false') });

/** The caller's own inbox, across organizations. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @ZodQuery(listQuery) query: z.infer<typeof listQuery>) {
    return this.notifications.list(user, query.unread === 'true');
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.notifications.markRead(user, id);
  }
}
