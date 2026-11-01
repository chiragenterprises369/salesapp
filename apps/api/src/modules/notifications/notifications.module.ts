import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * OWNER: backend-core. In-app notifications (list, read, realtime `notification.created`) and web push subscriptions.
 * Exports NotificationsService.notify() for leads (assignments, imports) and tasks (overdue).
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
