import { Module } from '@nestjs/common';
import { AuthStateModule } from '../auth/state/auth-state.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { WhatsappModule } from '../whatsapp/whatsapp.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { AdminNotifier } from './admin-notifier.js';
import { ApiKeysService } from './api-keys.service.js';
import { HooksController } from './hooks.controller.js';
import { InboundService } from './inbound.service.js';
import { OutboundDispatcher } from './outbound.service.js';
import { ApiKeysController, PublicApiController, WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

/**
 * OWNER: backend-core (HUB-API, change #19 wave C; was a realtime-integrations placeholder). Inbound sources (HMAC or
 * token, Idempotency-Key, mapping, capture, actions), outbound subscriptions (signed deliveries, BullMQ retries,
 * dead-letter, auto-disable), the delivery log with replay and test send, API keys (scopes, rotation grace, rate
 * limit in the auth guard), the public OpenAPI document, and every /api/hooks/* receiver (HooksController).
 */
@Module({
  imports: [IntegrationsModule, WhatsappModule, NotificationsModule, WorkspaceModule, AuthStateModule],
  controllers: [HooksController, WebhooksController, ApiKeysController, PublicApiController],
  providers: [AdminNotifier, InboundService, OutboundDispatcher, WebhooksService, ApiKeysService],
  exports: [OutboundDispatcher, ApiKeysService],
})
export class WebhooksModule {}
