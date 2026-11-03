import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { WhatsappSender } from './whatsapp-sender.service.js';
import { WhatsappService } from './whatsapp.service.js';

/**
 * OWNER: backend-core (HUB-API, change #19 wave C; was a realtime-integrations placeholder). WhatsApp Cloud API
 * receiver: verify challenge, signed messages into the Inbox conversations (24 h window, consent, lead for unknown
 * numbers, message.received) and delivery statuses. The HTTP routes are in WebhooksModule's HooksController.
 * Change #20 (PROD-HUB): WhatsappSender sends text, templates and media through the Cloud API (mock in development)
 * for ConversationsService.send and document delivery.
 */
@Module({
  imports: [IntegrationsModule, NotificationsModule],
  providers: [WhatsappService, WhatsappSender],
  exports: [WhatsappService, WhatsappSender],
})
export class WhatsappModule {}
