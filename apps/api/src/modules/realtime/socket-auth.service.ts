import { Injectable } from '@nestjs/common';
import { JWT_AUDIENCE } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { authContextFromClaims } from '../auth/session.service.js';
import { AccountStatusService } from '../auth/state/account-status.service.js';
import { TokenService } from '../auth/token.service.js';
import type { SocketViewer } from './audience.js';

/** Who is on the other end of a socket. */
export type SocketPrincipal =
  | {
      kind: 'workspace';
      auth: AuthContext;
      userId: string;
      workspaceId: string;
      sessionId: string | null;
      teamId: string | null;
      /** Access token expiry (ms): the socket gets `auth.expired` then. */
      expiresAt: number;
      viewer: SocketViewer;
      viewerAt: number;
    }
  | { kind: 'platform'; adminId: string; sessionId: string; expiresAt: number };

/** How long a socket's scope (visible users, permissions) and session state are trusted. */
export const VIEWER_TTL_MS = 60_000;

const decodeAudience = (token: string): string | null => {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { aud?: unknown };
    return typeof payload.aud === 'string' ? payload.aud : null;
  } catch {
    return null;
  }
};

/**
 * Socket handshake authentication, the same checks as the HTTP guard: workspace access token
 * (audience vistar:workspace) with a live session, an active user, a usable workspace and an unchanged
 * role; or a Super Admin token (audience vistar:platform) with a live platform session, which only
 * gets the platform room. Anything else fails with AUTH_TOKEN_INVALID / AUTH_TOKEN_EXPIRED.
 */
@Injectable()
export class SocketAuthService {
  constructor(
    private readonly tokens: TokenService,
    private readonly state: AccountStatusService,
    private readonly scope: ScopeService,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(token: string | null | undefined): Promise<SocketPrincipal> {
    if (!token || typeof token !== 'string') throw new AppException('AUTH_UNAUTHENTICATED', 'Sign in to continue');
    if (decodeAudience(token) === JWT_AUDIENCE.platform) return this.platform(token);
    const claims = await this.tokens.verifyWorkspaceAccess(token);
    if (claims.imp && claims.imp.exp * 1000 <= Date.now()) throw new AppException('AUTH_TOKEN_EXPIRED', 'The support session ended');
    let impersonation: AuthContext['impersonation'] = null;
    if (claims.imp) {
      const imp = await this.state.impersonation(claims.wid, claims.imp.sid);
      if (!imp || !imp.active || imp.adminId !== claims.imp.adminId) throw new AppException('AUTH_TOKEN_EXPIRED', 'The support session ended');
      impersonation = { sessionId: claims.imp.sid, adminId: claims.imp.adminId, readOnly: true, contentAccess: imp.contentAccess };
    }
    const auth = authContextFromClaims(claims, impersonation);
    await this.assertLive(auth, claims.rid);
    const user = await this.prisma.forTenant(auth.workspaceId).user.findFirst({ where: { id: claims.sub, deletedAt: null }, select: { teamId: true } });
    if (!user) throw new AppException('AUTH_ACCOUNT_DISABLED', 'Your account is deactivated');
    const viewer = await this.viewerFor(auth);
    return {
      kind: 'workspace',
      auth,
      userId: claims.sub,
      workspaceId: claims.wid,
      sessionId: claims.imp ? null : claims.sid,
      teamId: user.teamId,
      expiresAt: claims.exp * 1000,
      viewer,
      viewerAt: Date.now(),
    };
  }

  /** Re-check the session and recompute the scope (team membership may have changed). */
  async refresh(p: Extract<SocketPrincipal, { kind: 'workspace' }>): Promise<Extract<SocketPrincipal, { kind: 'workspace' }>> {
    await this.assertLive(p.auth, p.auth.roleId);
    // ScopeService caches per AuthContext object: a fresh object recomputes the team.
    const auth: AuthContext = { ...p.auth };
    return { ...p, auth, viewer: await this.viewerFor(auth), viewerAt: Date.now() };
  }

  private async assertLive(auth: AuthContext, roleId: string | null): Promise<void> {
    const snap = await this.state.snapshot(auth.workspaceId, auth.userId as string, auth.impersonation ? null : auth.sessionId);
    if (snap.revoked) throw new AppException('AUTH_TOKEN_INVALID', 'Your session ended. Sign in again');
    if (!snap.user || !snap.user.active) throw new AppException('AUTH_ACCOUNT_DISABLED', 'Your account is deactivated');
    const ws = snap.workspaceStatus;
    if (!ws || ws === 'deleted' || (ws === 'suspended' && !auth.impersonation)) throw new AppException('AUTH_ACCOUNT_DISABLED', 'This workspace is suspended');
    if (!auth.impersonation && snap.user.roleId !== roleId) throw new AppException('AUTH_TOKEN_EXPIRED', 'Your role changed. Refresh your session');
  }

  private async viewerFor(auth: AuthContext): Promise<SocketViewer> {
    const ids = await this.scope.visibleUserIds(auth);
    return { userId: auth.userId as string, workspaceId: auth.workspaceId, visibleUserIds: ids ? new Set(ids) : null, permissions: new Set(auth.permissions) };
  }

  private async platform(token: string): Promise<SocketPrincipal> {
    const claims = await this.tokens.verifyPlatformAccess(token);
    const session = await this.prisma.platformSession.findFirst({
      where: { familyId: claims.sid, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { adminId: true, admin: { select: { isActive: true } } },
    });
    if (!session || session.adminId !== claims.sub || !session.admin.isActive) throw new AppException('AUTH_TOKEN_INVALID', 'Your session ended. Sign in again');
    return { kind: 'platform', adminId: claims.sub, sessionId: claims.sid, expiresAt: claims.exp * 1000 };
  }
}
