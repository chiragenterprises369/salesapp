import { Module } from '@nestjs/common';
import { AuthStateModule } from '../auth/state/auth-state.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { IndiamartService } from './indiamart.service.js';
import { IntegrationStore } from './integration-store.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { LeadIntakeService } from './lead-intake.service.js';
import { TelephonyService } from './telephony.service.js';

/**
 * OWNER: backend-core (HUB-API, change #19 wave C; was a realtime-integrations placeholder). Integration hub
 * (catalog, connect, test, sync, disconnect, tokens, Google OAuth), provider adapters (IndiaMART pull and push,
 * WhatsApp Cloud API checks, telephony mock and Exotel, SMTP, Google Calendar) behind live and mock modes, the
 * IndiaMART pull cron and lead intake for every machine source. Exports the pieces the webhooks and WhatsApp
 * modules need; the /api/hooks/* receivers live in WebhooksModule (one controller, literal paths first).
 */
@Module({
  imports: [LeadsModule, WorkspaceModule, AuthStateModule, PresenceModule],
  controllers: [IntegrationsController],
  providers: [IntegrationStore, LeadIntakeService, IndiamartService, TelephonyService, IntegrationsService],
  exports: [IntegrationStore, LeadIntakeService, IndiamartService, TelephonyService],
})
export class IntegrationsModule {}
