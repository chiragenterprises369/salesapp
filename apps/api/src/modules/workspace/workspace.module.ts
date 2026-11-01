import { Module } from '@nestjs/common';
import { AuthStateModule } from '../auth/state/auth-state.module.js';
import { MeController } from './me.controller.js';
import { RolesService } from './roles.service.js';
import { SettingsService } from './settings.service.js';
import { TeamController } from './team.controller.js';
import { TeamsService } from './teams.service.js';
import { UsersService } from './users.service.js';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';

/**
 * OWNER: backend-core. Tenants: workspace profile, business hours, branding, support access,
 * users, teams, roles (system + custom, lock-out guard), my settings/profile/status.
 * Every query goes through prisma.forTenant(auth.workspaceId).
 */
@Module({
  imports: [AuthStateModule],
  controllers: [WorkspaceController, TeamController, MeController],
  providers: [WorkspaceService, SettingsService, UsersService, TeamsService, RolesService],
  exports: [WorkspaceService, SettingsService, UsersService, RolesService],
})
export class WorkspaceModule {}
