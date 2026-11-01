import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { AuthController, InviteController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { InviteService } from './invite.service.js';
import { MeService } from './me.service.js';
import { SessionService } from './session.service.js';
import { AuthStateModule } from './state/auth-state.module.js';
import { TokenService } from './token.service.js';
import { WorkspaceProvisioner } from './workspace-provisioner.js';

/**
 * OWNER: backend-core. Workspace auth (email/password, Google, invites, refresh rotation).
 * Secrets are passed per call (workspace vs platform), so JwtModule has no default secret.
 */
@Module({
  imports: [JwtModule.register({}), AuthStateModule, WorkspaceModule],
  controllers: [AuthController, InviteController],
  providers: [TokenService, SessionService, MeService, AuthService, InviteService, WorkspaceProvisioner],
  exports: [TokenService, MeService],
})
export class AuthModule {}
