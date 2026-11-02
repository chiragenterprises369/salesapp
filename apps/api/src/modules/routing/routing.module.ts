import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module.js';
import { RoutingController } from './routing.controller.js';
import { RoutingService } from './routing.service.js';

/** OWNER: backend-core (CRM-API, change #19 wave B). Lead routing rules; RoutingService.assign is used by lead create, import and capture forms. */
@Module({
  imports: [CalendarModule],
  controllers: [RoutingController],
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
