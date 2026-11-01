import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { DataScope, Permission, PlatformPermission, RoleKind, RouteAuth } from '@vistar/shared';
import { AppException } from '../errors/app-exception.js';

/**
 * Authenticated WORKSPACE caller (Company + Employee panels, public API keys), set on `req.auth`
 * by backend-core's guard. Every data access MUST be scoped by `workspaceId` from here (never from
 * the body) and filtered by `dataScope`:
 *   own  -> ownerId/assigneeId/userId = userId
 *   team -> ... IN (members of teams managed by userId) + own
 *   all  -> no extra filter
 * Impersonation (Super Admin "View as company"): `impersonation` is set; when readOnly the guard
 * rejects every non-GET request, and message bodies / recordings stay hidden unless contentAccess.
 */
export interface AuthContext {
  audience: 'workspace';
  userId: string | null;
  workspaceId: string;
  roleId: string | null;
  kind: RoleKind | null;
  dataScope: DataScope;
  permissions: Permission[];
  sessionId: string | null;
  via: 'jwt' | 'api_key';
  apiKeyId: string | null;
  impersonation: { sessionId: string; adminId: string; readOnly: boolean; contentAccess: boolean } | null;
}

/** Authenticated Super Admin (platform audience), set on `req.platformAuth`. Never has a workspaceId. */
export interface PlatformAuthContext {
  audience: 'platform';
  adminId: string;
  permissions: PlatformPermission[];
  sessionId: string;
}

export const AUTH_MODE_KEY = 'vistar:authMode';
export const PERMISSION_KEY = 'vistar:permission';
export const ROUTE_DEF_KEY = 'vistar:routeDef';

/** Prefer @ApiRoute, which sets auth mode and permission from the shared contract. */
export const Public = () => SetMetadata(AUTH_MODE_KEY, 'public' satisfies RouteAuth);
export const AuthMode = (mode: RouteAuth) => SetMetadata(AUTH_MODE_KEY, mode);
export const RequirePermission = (permission: Permission | PlatformPermission) => SetMetadata(PERMISSION_KEY, permission);

/** Inject the workspace AuthContext. Throws if absent (e.g. a platform token). */
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
  if (!req.auth) throw new AppException('AUTH_UNAUTHENTICATED', 'Sign in to continue');
  return req.auth;
});

/** Shortcut for the caller's workspace id. */
export const WorkspaceId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
  if (!req.auth) throw new AppException('AUTH_UNAUTHENTICATED', 'Sign in to continue');
  return req.auth.workspaceId;
});

/** Inject the Super Admin context on /api/super routes. */
export const CurrentPlatformAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): PlatformAuthContext => {
  const req = ctx.switchToHttp().getRequest<{ platformAuth?: PlatformAuthContext }>();
  if (!req.platformAuth) throw new AppException('AUTH_UNAUTHENTICATED', 'Sign in to continue');
  return req.platformAuth;
});

declare module 'express' {
  interface Request {
    auth?: AuthContext;
    platformAuth?: PlatformAuthContext;
    id?: string;
  }
}
