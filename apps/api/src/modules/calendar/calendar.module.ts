import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AvailabilityService } from './availability.service.js';
import { CalendarController } from './calendar.controller.js';
import { MeetingRemindersScheduler } from './meeting-reminders.scheduler.js';
import { MeetingsService } from './meetings.service.js';

/** OWNER: backend-core (CRM-API, change #19 wave B). Meetings, recurrence, reminders, time off, availability. */
@Module({
  imports: [NotificationsModule],
  controllers: [CalendarController],
  providers: [MeetingsService, AvailabilityService, MeetingRemindersScheduler],
  exports: [MeetingsService, AvailabilityService],
})
export class CalendarModule {}
