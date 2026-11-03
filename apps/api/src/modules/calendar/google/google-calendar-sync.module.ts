import { Module } from '@nestjs/common';
import { AuthStateModule } from '../../auth/state/auth-state.module.js';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { GoogleCalendarSyncService } from './google-calendar-sync.service.js';

/**
 * OWNER: PROD-HUB (change #20). Google Calendar sync of meetings. A module of its own because CalendarModule is
 * imported by the routing module that IntegrationsModule depends on (importing the hub there would be a cycle):
 * it listens to meeting events instead of being called by MeetingsService.
 */
@Module({
  imports: [IntegrationsModule, AuthStateModule],
  providers: [GoogleCalendarSyncService],
  exports: [GoogleCalendarSyncService],
})
export class GoogleCalendarSyncModule {}
