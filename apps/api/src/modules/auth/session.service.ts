import { Injectable, Logger } from '@nestjs/common';
import { AuthSessionSchema, type AuthTokens, type DataScope, type RoleKind, type WorkspaceClaims, type WorkspaceStatus } from '@vistar/shared';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { hashToken, randomToken } from '../../infra/crypto/secrets.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { validPermissions } from '../workspace/mappers.js';
import { clientIp, REFRESH_COOKIE, REFRESH_TTL_SEC, refreshCookieOptions, userAgent, WORKSPACE_REFRESH_PATH } from './auth.constants.js';
import { MeService } from './me.service.js';
import { AccountStatusService } from './state/account-status.service.js';
import { TokenService } from './token.service.js';

export type AuthSession = z.infer<typeof AuthSessionSchema>;

/** Fields needed to decide whether a user may sign in and to mint their claims. */
export const AUTH_USER_SELECT = {
  id: true,
  workspaceId: true,
  email: true,
  name: true,
  isActive: true,
  deletedAt: true,
  passwordHash: true,
  googleSub: true,
  roleId: true,
  role: { select: { kind: true, dataScope: true, permissions: true } },
  workspace: { select: { status: true, deletedAt: true } },
} as const;

export interface AuthUser {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  isActive: boolean;
  deletedAt: Date | null;
  passwordHash: string | null;
  googleSub: string | null;
  roleId: string;
  role: { kind: RoleKind; dataScope: DataScope; permissions: string[] };
  workspace: { status: WorkspaceStatus; deletedAt: Date | null };
}

export function authContextFromClaims(claims: Omit<WorkspaceClaims, 'aud'>, impersonation: AuthContext['impersonation'] = null): AuthContext {
  return {
    audience: 'workspace',
    userId: claims.sub,
    workspaceId: claims.wid,
    roleId: claims.rid,
    kind: claims.kind,
    dataScope: claims.scope,
    permissions: claims.perms,
    sessionId: claims.sid,
    via: 'jwt',
    apiKeyId: null,
    impersonation,
  };
}

const sessionEnded = () => new AppException('AUTH_TOKEN_INVALID', 'Your session ended. Sign in again');

/**
 * Workspace sessions: opaque refresh token (SHA-256 hash stored in Session) in the httpOnly
 * `vistar_rt` cookie, rotated on every refresh. Presenting an already-rotated or revoked token
 * revokes the whole family (token theft signal) and its live access tokens.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  readonly refreshTtlSec = REFRESH_TTL_SEC();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly state: AccountStatusService,
    private readonly me: MeService,
    private readonly audit: AuditService,
  ) {}

  /** Throws AUTH_ACCOUNT_DISABLED for inactive users and suspended/deleted workspaces. */
  assertCanSignIn(user: Pick<AuthUser, 'isActive' | 'deletedAt' | 'workspace'>): void {
    if (!user.isActive || user.deletedAt) {
      throw new AppException('AUTH_ACCOUNT_DISABLED', 'Your account is deactivated. Ask your company admin to restore access');
    }
    if (user.workspace.deletedAt || user.workspace.status === 'suspended' || user.workspace.status === 'deleted') {
      throw new AppException('AUTH_ACCOUNT_DISABLED', 'This workspace is suspended. Contact Vistar support');
    }
  }

  claimsFor(user: AuthUser, familyId: string): Omit<WorkspaceClaims, 'aud'> {
    return {
      sub: user.id,
      wid: user.workspaceId,
      rid: user.roleId,
      kind: user.role.kind,
      scope: user.role.dataScope,
      perms: validPermissions(user.role.permissions),
      sid: familyId,
    };
  }

  /** New session family after a successful login/signup/invite accept. Sets the refresh cookie. */
  async start(user: AuthUser, req: Request, res: Response): Promise<AuthSession> {
    const familyId = randomUUID();
    const refreshToken = randomToken(32);
    await this.prisma.forTenant(user.workspaceId).session.create({
      data: {
        workspaceId: user.workspaceId,
        userId: user.id,
        familyId,
        tokenHash: hashToken(refreshToken),
        ip: clientIp(req),
        userAgent: userAgent(req),
        expiresAt: new Date(Date.now() + this.refreshTtlSec * 1000),
      },
    });
    this.setCookie(res, refreshToken);
    const claims = this.claimsFor(user, familyId);
    const { token, expiresIn } = this.tokens.signWorkspaceAccess(claims);
    const me = await this.me.build(authContextFromClaims(claims));
    return { accessToken: token, expiresIn, me };
  }

  async refresh(req: Request, res: Response): Promise<AuthTokens> {
    const raw = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
    if (typeof raw !== 'string' || !raw) throw new AppException('AUTH_UNAUTHENTICATED', 'Sign in to continue');

    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!session) {
      this.clearCookie(res);
      throw sessionEnded();
    }
    if (session.revokedAt) {
      // A rotated token presented again is a theft signal; a logged-out one simply ended.
      if (session.replacedById) await this.onReuse(session);
      else await this.state.markFamilyRevoked(session.familyId);
      this.clearCookie(res);
      throw sessionEnded();
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.revokeFamily(session.workspaceId, session.familyId);
      this.clearCookie(res);
      throw new AppException('AUTH_TOKEN_EXPIRED', 'Your session expired. Sign in again');
    }

    const user = await this.prisma.forTenant(session.workspaceId).user.findFirst({ where: { id: session.userId }, select: AUTH_USER_SELECT });
    try {
      if (!user) throw sessionEnded();
      this.assertCanSignIn(user);
    } catch (err) {
      await this.revokeFamily(session.workspaceId, session.familyId);
      this.clearCookie(res);
      throw err;
    }

    const nextToken = randomToken(32);
    const now = new Date();
    const rotated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.session.create({
        data: {
          workspaceId: session.workspaceId,
          userId: session.userId,
          familyId: session.familyId,
          tokenHash: hashToken(nextToken),
          ip: clientIp(req),
          userAgent: userAgent(req),
          expiresAt: new Date(now.getTime() + this.refreshTtlSec * 1000),
        },
      });
      // Conditional update: a concurrent refresh with the same token loses the race.
      const { count } = await tx.session.updateMany({
        where: { id: session.id, workspaceId: session.workspaceId, revokedAt: null },
        data: { revokedAt: now, replacedById: next.id },
      });
      if (count !== 1) throw new Error('refresh-race');
      return true;
    }).catch((err: Error) => {
      if (err.message === 'refresh-race') return false;
      throw err;
    });
    if (!rotated) {
      await this.onReuse(session);
      this.clearCookie(res);
      throw sessionEnded();
    }

    this.setCookie(res, nextToken);
    const { token, expiresIn } = this.tokens.signWorkspaceAccess(this.claimsFor(user, session.familyId));
    return { accessToken: token, expiresIn };
  }

  async revokeFamily(workspaceId: string, familyId: string): Promise<void> {
    await this.prisma.forTenant(workspaceId).session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.state.markFamilyRevoked(familyId);
  }

  setCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(WORKSPACE_REFRESH_PATH, this.refreshTtlSec));
  }

  clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(WORKSPACE_REFRESH_PATH));
  }

  private async onReuse(session: { workspaceId: string; familyId: string; userId: string }): Promise<void> {
    await this.revokeFamily(session.workspaceId, session.familyId);
    this.logger.warn(`Refresh token reuse: session family ${session.familyId} revoked`);
    await this.audit.system(session.workspaceId, {
      action: 'session.reuse_detected',
      entityType: 'session',
      entityId: session.familyId,
      diff: { userId: session.userId },
    });
  }
}
