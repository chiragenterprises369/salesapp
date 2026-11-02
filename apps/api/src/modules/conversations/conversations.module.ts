import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

/** OWNER: realtime stream (change #19). WhatsApp inbox read API and local send (no provider yet). */
@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
