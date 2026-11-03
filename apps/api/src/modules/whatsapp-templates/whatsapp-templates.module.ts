import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { WhatsappTemplatesController } from './whatsapp-templates.controller.js';
import { WhatsappTemplatesService } from './whatsapp-templates.service.js';

/**
 * OWNER: backend-core (CONFIG-API stream, change #20). WhatsApp message templates: drafts, Meta submit and sync
 * through the workspace's WhatsApp Cloud integration (mock in development). Implements POST /templates/sync too.
 */
@Module({
  imports: [IntegrationsModule],
  controllers: [WhatsappTemplatesController],
  providers: [WhatsappTemplatesService],
  exports: [WhatsappTemplatesService],
})
export class WhatsappTemplatesModule {}
