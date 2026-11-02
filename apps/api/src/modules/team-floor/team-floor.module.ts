import { Module } from '@nestjs/common';
import { FloorsModule } from '../floors/floors.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { TeamFloorController } from './team-floor.controller.js';
import { TeamFloorService } from './team-floor.service.js';

/** OWNER: realtime stream (change #19). Live Team Floor snapshot from the server presence (SPEC 12, 29.2). */
@Module({
  imports: [PresenceModule, FloorsModule],
  controllers: [TeamFloorController],
  providers: [TeamFloorService],
})
export class TeamFloorModule {}
