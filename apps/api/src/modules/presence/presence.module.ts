import { Module } from '@nestjs/common';
import { PresenceController } from './presence.controller.js';
import { PresenceService } from './presence.service.js';
import { PresenceStore } from './presence.store.js';

/** OWNER: realtime stream (change #19). Server-authoritative live status (D-062). */
@Module({
  controllers: [PresenceController],
  providers: [PresenceStore, PresenceService],
  exports: [PresenceService, PresenceStore],
})
export class PresenceModule {}
