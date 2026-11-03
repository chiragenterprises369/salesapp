import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { WhatsappService } from './whatsapp.service.js';

/**
 * OWNER: backend-core (HUB-API, change #19 wave C; was a realtime-integrations placeholder). WhatsApp Cloud API
 * receiver: verify challenge, signed messages into the Inbox conversations (24 h window, consent, lead for unknown
 * numbers, message.received) and delivery statuses. The HTTP routes are in WebhooksModule's HooksController.
 * Sending through the Cloud API from ConversationsService.send is a follow-up (messages are still marked sent locally).
 */
@Module({
  imports: [IntegrationsModule, NotificationsModule],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
