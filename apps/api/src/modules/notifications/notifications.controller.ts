import { Body, Controller, Query } from '@nestjs/common';
import { API_ROUTES, NotificationListQuerySchema, NotificationMarkReadSchema, PushSubscriptionSchema } from '@vistar/shared';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { NotificationsService } from './notifications.service.js';

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @ApiRoute(API_ROUTES.notificationList)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(NotificationListQuerySchema)) query: z.output<typeof NotificationListQuerySchema>,
    @Query('unread') rawUnread: unknown,
  ) {
    // z.coerce.boolean() turns "false" into true; honour the literal string.
    const unread = rawUnread === 'false' || rawUnread === '0' ? false : query.unread;
    return this.notifications.list(auth, { ...query, unread });
  }

  @ApiRoute(API_ROUTES.notificationRead)
  read(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(NotificationMarkReadSchema)) body: z.output<typeof NotificationMarkReadSchema>) {
    return this.notifications.markRead(auth, body.ids);
  }

  @ApiRoute(API_ROUTES.pushSubscribe)
  subscribe(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(PushSubscriptionSchema)) body: z.output<typeof PushSubscriptionSchema>) {
    return this.notifications.subscribe(auth, body);
  }
}
