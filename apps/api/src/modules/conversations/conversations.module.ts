import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

/** OWNER: realtime stream (change #19). WhatsApp inbox; sending through the Cloud API (change #20, PROD-HUB). */
@Module({
  imports: [WhatsappModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
