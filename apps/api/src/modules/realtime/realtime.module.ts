import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { AuthStateModule } from '../auth/state/auth-state.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { TeamFloorModule } from '../team-floor/team-floor.module.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { SocketAuthService } from './socket-auth.service.js';

/**
 * OWNER: realtime-integrations (change #19: realtime stream). Socket.IO gateway (/realtime), rooms,
 * event-bus fan-out with data scope, presence over the socket. The stream's feature modules (presence,
 * attendance, conversations, Team Floor) are registered here so app.module.ts stays untouched;
 * CallsModule is registered by the app module.
 */
@Module({
  imports: [AuthModule, AuthStateModule, PresenceModule, AttendanceModule, ConversationsModule, TeamFloorModule],
  providers: [SocketAuthService, RealtimeGateway],
  exports: [PresenceModule],
})
export class RealtimeModule {}
