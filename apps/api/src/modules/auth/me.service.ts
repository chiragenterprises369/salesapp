import { Injectable } from '@nestjs/common';
import { LabelOverridesSchema, resolveLabels, SETTING_KEYS, type ActivePack, type ImpersonationInfo, type MeResponse, type ResolvedLabels } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { activeEntitledPacks } from '../packs/pack-entitlement.js';
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
    const [role, workspace, settings, visible, impersonation, labels, packs] = await Promise.all([
      this.roles.get(auth.workspaceId, user.roleId),
      this.workspaces.get(auth.workspaceId),
      this.settings.getUserSettings(auth.workspaceId, auth.userId),
      auth.dataScope === 'team' ? this.scope.visibleUserIds(auth) : Promise.resolve([]),
      this.impersonation(auth),
      this.labels(auth.workspaceId),
      this.activePacks(auth.workspaceId),
    ]);
    return {
      user,
      role,
      workspace,
      permissions: auth.permissions,
      teamMemberIds: auth.dataScope === 'team' ? (visible ?? []) : [],
      settings,
      impersonation,
      labels,
      packs,
    };
  }

  /** Workspace label overrides (Setting ui.labels) merged over the defaults. */
  private async labels(workspaceId: string): Promise<ResolvedLabels> {
    const row = await this.prisma
      .forTenant(workspaceId)
      .setting.findFirst({ where: { scope: 'workspace', scopeId: workspaceId, key: SETTING_KEYS.workspace.labels }, select: { value: true } });
    const parsed = LabelOverridesSchema.safeParse(row?.value ?? {});
    return resolveLabels(parsed.success ? parsed.data : {});
  }

  /** Active packs whose entitlement is active (core, plan or grant). Revoked packs keep their data but are hidden. */
  private activePacks(workspaceId: string): Promise<ActivePack[]> {
    return activeEntitledPacks(this.prisma, workspaceId);
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
