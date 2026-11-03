import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { API_KEY_DEFAULT_RATE_LIMIT_PER_MIN, API_KEY_SCOPES, type Permission, type PlatformPermission, type RouteAuth } from '@vistar/shared';
import type { Request, Response } from 'express';
import { AUTH_MODE_KEY, PERMISSION_KEY, type AuthContext } from '../../../common/auth/auth-context.js';
import { AppException } from '../../../common/errors/app-exception.js';
import { getEnv } from '../../../config/env.js';
import { hashToken } from '../../../infra/crypto/secrets.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { API_KEY_PREFIX, bearerToken } from '../auth.constants.js';
import { authContextFromClaims } from '../session.service.js';
import { AccountStatusService } from '../state/account-status.service.js';
import { KvStore } from '../state/kv.store.js';
import { WorkspaceService } from '../../workspace/workspace.service.js';
import { SuperAuthService } from '../super/super-auth.service.js';
import { TokenService } from '../token.service.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const API_KEY_SCOPE_SET = new Set<string>(API_KEY_SCOPES);
const API_KEY_TOUCH_INTERVAL_MS = 60_000;
/** change #19 wave C: plan feature api_access is cached this long per workspace. */
const API_ACCESS_CACHE_SEC = 60;

const unauthenticated = () => new AppException('AUTH_UNAUTHENTICATED', 'Sign in to continue');
const disabledWorkspace = () => new AppException('AUTH_ACCOUNT_DISABLED', 'This workspace is suspended. Contact Vistar support');

/**
 * Global guard (APP_GUARD). Reads the auth mode / permission set by @ApiRoute (routes without
 * metadata default to `jwt`):
 *   public, webhook, super_public -> pass (webhooks and super login verify themselves)
 *   jwt             -> workspace access token (audience vistar:workspace) -> req.auth
 *   api_key         -> Bearer vst_live_... (SHA-256 lookup, scopes = permissions, scope all) -> req.auth
 *   jwt_or_api_key  -> either, decided by the token prefix
 *   super           -> platform access token (audience vistar:platform) -> req.platformAuth
 * A token of the wrong audience fails with AUTH_TOKEN_INVALID. Read-only impersonation blocks every
 * non-GET request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly devAuth = getEnv().DEV_AUTH;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly state: AccountStatusService,
    private readonly superAuth: SuperAuthService,
    private readonly kv: KvStore,
    private readonly workspaces: WorkspaceService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const mode = this.reflector.getAllAndOverride<RouteAuth | undefined>(AUTH_MODE_KEY, targets) ?? 'jwt';
    if (mode === 'public' || mode === 'webhook' || mode === 'super_public') return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const required = this.reflector.getAllAndOverride<Permission | PlatformPermission | undefined>(PERMISSION_KEY, targets);
    const token = bearerToken(req);

    if (mode === 'super') {
      if (!token) throw unauthenticated();
      const platform = await this.superAuth.authenticate(token, req);
      req.platformAuth = platform;
      if (required && !platform.permissions.includes(required as PlatformPermission)) {
        throw new AppException('FORBIDDEN', 'You do not have permission to do this');
      }
      return true;
    }

    // Wave 1 bridge: with DEV_AUTH=1 (development only) the DevAuthGuard handles x-dev-user requests.
    if (this.devAuth && !token && typeof req.headers['x-dev-user'] === 'string') return true;
    if (!token) throw unauthenticated();

    const isApiKey = token.startsWith(API_KEY_PREFIX);
    let auth: AuthContext;
    if (mode === 'api_key' || (mode === 'jwt_or_api_key' && isApiKey)) {
      if (!isApiKey) throw new AppException('API_KEY_INVALID', 'Use an API key (vst_live_...) for this endpoint');
      auth = await this.authenticateApiKey(token, req, ctx.switchToHttp().getResponse<Response>());
    } else {
      auth = await this.authenticateJwt(token, req);
    }
    req.auth = auth;

    if (required && !auth.permissions.includes(required as Permission)) {
      if (auth.via === 'api_key') throw new AppException('API_KEY_SCOPE_MISSING', `This API key needs the ${required} scope`);
      throw new AppException('FORBIDDEN', 'You do not have permission to do this');
    }
    return true;
  }

  private async authenticateJwt(token: string, req: Request): Promise<AuthContext> {
    const claims = await this.tokens.verifyWorkspaceAccess(token);

    let impersonation: AuthContext['impersonation'] = null;
    if (claims.imp) {
      if (claims.imp.exp * 1000 <= Date.now()) throw new AppException('AUTH_TOKEN_EXPIRED', 'The support session ended');
      const imp = await this.state.impersonation(claims.wid, claims.imp.sid);
      if (!imp || !imp.active || imp.adminId !== claims.imp.adminId) throw new AppException('AUTH_TOKEN_EXPIRED', 'The support session ended');
      const readOnly = claims.imp.readOnly || imp.readOnly;
      if (readOnly && !READ_METHODS.has(req.method.toUpperCase())) throw new AppException('FORBIDDEN', 'Read-only support session');
      impersonation = { sessionId: claims.imp.sid, adminId: claims.imp.adminId, readOnly, contentAccess: imp.contentAccess };
    }

    const snap = await this.state.snapshot(claims.wid, claims.sub, claims.imp ? null : claims.sid);
    if (snap.revoked) throw new AppException('AUTH_TOKEN_INVALID', 'Your session ended. Sign in again');
    if (!snap.user || !snap.user.active) throw new AppException('AUTH_ACCOUNT_DISABLED', 'Your account is deactivated. Ask your company admin to restore access');
    const ws = snap.workspaceStatus;
    // Support (impersonation) may still look at a suspended workspace.
    if (!ws || ws === 'deleted' || (ws === 'suspended' && !impersonation)) throw disabledWorkspace();
    // Role changed since the token was minted: force a refresh so permissions and scope update.
    if (!impersonation && snap.user.roleId !== claims.rid) throw new AppException('AUTH_TOKEN_EXPIRED', 'Your role changed. Refresh your session');

    return authContextFromClaims(claims, impersonation);
  }

  private async apiAccess(workspaceId: string): Promise<boolean> {
    const cacheKey = `apiaccess:${workspaceId}`;
    const cached = await this.kv.get(cacheKey);
    if (cached !== null) return cached === '1';
    const db = this.prisma.forTenant(workspaceId);
    const ws = await db.workspace.findFirst({ select: { plan: true } });
    const enabled = (await this.workspaces.features(db, ws?.plan ?? 'free')).api_access;
    await this.kv.set(cacheKey, enabled ? '1' : '0', API_ACCESS_CACHE_SEC);
    return enabled;
  }

  private async authenticateApiKey(token: string, req: Request, res: Response | undefined): Promise<AuthContext> {
    // Cross-tenant lookup by the SHA-256 of an unguessable key (the key decides the tenant). After a rotation the old
    // key keeps working until previousKeyExpiresAt (change #19 wave C).
    const hash = hashToken(token);
    const select = { id: true, workspaceId: true, scopes: true, lastUsedAt: true, expiresAt: true, revokedAt: true, rateLimitPerMinute: true, previousKeyExpiresAt: true } as const;
    const now = Date.now();
    let key = await this.prisma.apiKey.findUnique({ where: { keyHash: hash }, select });
    if (!key) {
      const old = await this.prisma.apiKey.findUnique({ where: { previousKeyHash: hash }, select });
      if (old?.previousKeyExpiresAt && old.previousKeyExpiresAt.getTime() > now) key = old;
    }
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= now)) throw new AppException('API_KEY_INVALID', 'This API key is invalid, expired or revoked');
    const ws = await this.state.workspaceStatus(key.workspaceId);
    if (!ws || ws === 'deleted' || ws === 'suspended') throw disabledWorkspace();
    if (!(await this.apiAccess(key.workspaceId))) throw new AppException('FEATURE_DISABLED', 'API access is not part of this workspace plan');

    // Per-key rate limit (fixed one-minute window, Redis or memory).
    const limit = key.rateLimitPerMinute ?? API_KEY_DEFAULT_RATE_LIMIT_PER_MIN;
    const used = await this.kv.incr(`rl:apikey:${key.id}:${Math.floor(now / 60_000)}`, 70);
    res?.setHeader('X-RateLimit-Limit', String(limit));
    res?.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - used)));
    if (used > limit) {
      res?.setHeader('Retry-After', String(Math.max(1, 60 - Math.floor((now % 60_000) / 1000))));
      throw new AppException('RATE_LIMITED', `This API key is limited to ${limit} requests a minute`);
    }

    if (!key.lastUsedAt || now - key.lastUsedAt.getTime() > API_KEY_TOUCH_INTERVAL_MS) {
      const threshold = new Date(now - API_KEY_TOUCH_INTERVAL_MS);
      void this.prisma
        .forTenant(key.workspaceId)
        .apiKey.updateMany({ where: { id: key.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: threshold } }] }, data: { lastUsedAt: new Date(now), lastUsedIp: (req.ip ?? '').slice(0, 64) || null } })
        .catch((err: Error) => this.logger.warn(`API key lastUsedAt update failed: ${err.name}`));
    }

    return {
      audience: 'workspace',
      userId: null,
      workspaceId: key.workspaceId,
      roleId: null,
      kind: null,
      dataScope: 'all',
      permissions: key.scopes.filter((s) => API_KEY_SCOPE_SET.has(s)) as Permission[],
      sessionId: null,
      via: 'api_key',
      apiKeyId: key.id,
      impersonation: null,
    };
  }
}
