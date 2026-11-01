import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TaskOverdueScheduler } from './task-overdue.scheduler.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

/**
 * OWNER: backend-core. Tasks and follow-ups, snooze, overdue detection (emits task.overdue + attention.raised).
 * ScheduleModule.forRoot() is registered once in AppModule (D-040).
 */
@Module({
  imports: [LeadsModule, NotificationsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskOverdueScheduler],
  exports: [TasksService],
})
export class TasksModule {}
