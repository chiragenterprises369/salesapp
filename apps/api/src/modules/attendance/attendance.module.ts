import { Module } from '@nestjs/common';
import { PresenceModule } from '../presence/presence.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

/** OWNER: realtime stream (change #19). Attendance, GPS tracking and consent for field staff (D-063). */
@Module({
  imports: [PresenceModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
