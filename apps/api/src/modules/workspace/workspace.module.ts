import { Module } from '@nestjs/common';
import { AuthStateModule } from '../auth/state/auth-state.module.js';
import { RolesService } from './roles.service.js';
import { SettingsService } from './settings.service.js';
import { UsersService } from './users.service.js';
import { WorkspaceService } from './workspace.service.js';

/**
 * OWNER: backend-core. Tenants: workspace profile, users, roles, user settings.
 * Every query goes through prisma.forTenant(auth.workspaceId).
 */
@Module({
  imports: [AuthStateModule],
  providers: [WorkspaceService, SettingsService, UsersService, RolesService],
  exports: [WorkspaceService, SettingsService, UsersService, RolesService],
})
export class WorkspaceModule {}
