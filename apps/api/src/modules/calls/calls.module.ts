import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { CallsController } from './calls.controller.js';
import { CallsService } from './calls.service.js';

/**
 * OWNER: realtime-integrations. SIM calls from the Android app (D-057), call log, call list; click-to-call
 * through the telephony integration (change #20, PROD-HUB: IntegrationsModule provides TelephonyService).
 */
@Module({
  imports: [PresenceModule, IntegrationsModule],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
