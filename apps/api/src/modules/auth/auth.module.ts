import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { AuthController, InviteController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './guards/auth.guard.js';
import { HttpThrottlerGuard, THROTTLER_OPTIONS } from './guards/throttle.js';
import { InviteService } from './invite.service.js';
import { MeService } from './me.service.js';
import { SessionService } from './session.service.js';
import { AuthStateModule } from './state/auth-state.module.js';
import { SuperAuthController } from './super/super-auth.controller.js';
import { SuperAuthService } from './super/super-auth.service.js';
import { TokenService } from './token.service.js';
import { WorkspaceProvisioner } from './workspace-provisioner.js';

/**
 * OWNER: backend-core. Workspace auth (email/password, Google, invites, refresh rotation),
 * Super Admin auth (password + mandatory TOTP, platform sessions), and the global guards:
 * rate limiting (HttpThrottlerGuard) then authentication/RBAC (AuthGuard), in that order.
 * Secrets are passed per call (workspace vs platform), so JwtModule has no default secret.
 */
@Module({
  imports: [JwtModule.register({}), ThrottlerModule.forRoot(THROTTLER_OPTIONS), AuthStateModule, WorkspaceModule],
  controllers: [AuthController, InviteController, SuperAuthController],
  providers: [
    TokenService,
    SessionService,
    MeService,
    AuthService,
    InviteService,
    WorkspaceProvisioner,
    SuperAuthService,
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenService, MeService],
})
export class AuthModule {}
