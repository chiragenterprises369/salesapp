import { Module } from '@nestjs/common';
import { PresenceModule } from '../presence/presence.module.js';
import { CallsController } from './calls.controller.js';
import { CallsService } from './calls.service.js';

/** OWNER: realtime-integrations. SIM calls from the Android app (D-057), call log, call list. */
@Module({
  imports: [PresenceModule],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
