import { Injectable } from '@nestjs/common';
import type { ImpersonationInfo, MeResponse } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RolesService } from '../workspace/roles.service.js';
import { SettingsService } from '../workspace/settings.service.js';
import { UsersService } from '../workspace/users.service.js';
import { WorkspaceService } from '../workspace/workspace.service.js';

/** Builds GET /auth/me (also embedded in login/signup/invite responses). */
@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly users: UsersService,
    private readonly roles: RolesService,
    private readonly workspaces: WorkspaceService,
    private readonly settings: SettingsService,
  ) {}

  async build(auth: AuthContext): Promise<MeResponse> {
    if (!auth.userId) throw new AppException('FORBIDDEN', 'API keys have no user profile');
    const user = await this.users.get(auth.workspaceId, auth.userId);
    const [role, workspace, settings, visible, impersonation] = await Promise.all([
      this.roles.get(auth.workspaceId, user.roleId),
      this.workspaces.get(auth.workspaceId),
      this.settings.getUserSettings(auth.workspaceId, auth.userId),
      auth.dataScope === 'team' ? this.scope.visibleUserIds(auth) : Promise.resolve([]),
      this.impersonation(auth),
    ]);
    return {
      user,
      role,
      workspace,
      permissions: auth.permissions,
      teamMemberIds: auth.dataScope === 'team' ? (visible ?? []) : [],
      settings,
      impersonation,
    };
  }

  private async impersonation(auth: AuthContext): Promise<ImpersonationInfo | null> {
    const imp = auth.impersonation;
    if (!imp) return null;
    const session = await this.prisma
      .forTenant(auth.workspaceId)
      .impersonationSession.findFirst({ where: { id: imp.sessionId }, select: { reason: true, expiresAt: true, adminId: true } });
    if (!session) return null;
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: session.adminId }, select: { name: true } });
    return {
      sessionId: imp.sessionId,
      adminName: admin?.name ?? 'Vistar support',
      reason: session.reason,
      readOnly: imp.readOnly,
      contentAccess: imp.contentAccess,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
}
