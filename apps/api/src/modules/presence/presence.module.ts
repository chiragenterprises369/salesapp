import { Module } from '@nestjs/common';
import { OfficeMarkersService } from './office-markers.service.js';
import { PresenceController } from './presence.controller.js';
import { PresenceService } from './presence.service.js';
import { PresenceStore } from './presence.store.js';

/** OWNER: realtime stream (change #19). Server-authoritative live status (D-062) and office zones (SPEC 29.11). */
@Module({
  controllers: [PresenceController],
  providers: [PresenceStore, OfficeMarkersService, PresenceService],
  exports: [PresenceService, PresenceStore, OfficeMarkersService],
})
export class PresenceModule {}
