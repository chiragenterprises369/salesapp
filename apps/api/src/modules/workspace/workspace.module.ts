import { Module } from '@nestjs/common';
import { AuthStateModule } from '../auth/state/auth-state.module.js';
import { BrandingService } from './branding.service.js';
import { DomainsService } from './domains.service.js';
import { PublicWorkspaceController } from './public.controller.js';
import { MeController } from './me.controller.js';
import { RolesService } from './roles.service.js';
import { SettingsService } from './settings.service.js';
import { TeamController } from './team.controller.js';
import { TeamsService } from './teams.service.js';
import { UsersService } from './users.service.js';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';

/**
 * OWNER: backend-core. Tenants: workspace profile, business hours, branding and component style, custom domains,
 * public workspace resolution, support access,
 * users, teams, roles (system + custom, lock-out guard), my settings/profile/status.
 * Every query goes through prisma.forTenant(auth.workspaceId).
 */
@Module({
  imports: [AuthStateModule],
  controllers: [WorkspaceController, TeamController, MeController, PublicWorkspaceController],
  providers: [WorkspaceService, SettingsService, UsersService, TeamsService, RolesService, BrandingService, DomainsService],
  exports: [WorkspaceService, SettingsService, UsersService, RolesService, BrandingService, DomainsService],
})
export class WorkspaceModule {}
