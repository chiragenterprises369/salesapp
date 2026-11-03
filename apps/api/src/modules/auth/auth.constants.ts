import { API_BASE_PATH, REFRESH_COOKIE, SUPER_REFRESH_COOKIE, SUPER_SESSION } from '@vistar/shared';
import type { CookieOptions, Request } from 'express';
import { getEnv } from '../../config/env.js';
import { securityPolicy } from '../config-registry/snapshot.js';

/** Parse "15m", "30d", "3600" (seconds), "500ms" into whole seconds. */
export function parseTtlSec(value: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(value.trim());
  if (!m) throw new Error(`Invalid TTL "${value}" (use e.g. 15m, 30d)`);
  const n = Number(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  if (unit === 'ms') return Math.max(1, Math.ceil(n / 1000));
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
  return n * mult[unit]!;
}

// ---- change #20: config. Lifetimes from Super Admin > Config > Security policy (env JWT_*_TTL as the fallback).
export const ACCESS_TTL_SEC = (): number => securityPolicy().accessTokenTtlSec;
export const REFRESH_TTL_SEC = (): number => securityPolicy().refreshTokenTtlSec;
/** Super Admin idle and absolute session limits (security policy; defaults SUPER_SESSION). */
export const SUPER_IDLE_TIMEOUT_SEC = (): number => Math.round(securityPolicy().superIdleTimeoutMs / 1000);
export const SUPER_ABSOLUTE_TIMEOUT_SEC = (): number => Math.round(securityPolicy().superAbsoluteTimeoutMs / 1000);

/** Audience of the short-lived Super Admin 2FA challenge token (never accepted as an access token). */
export const CHALLENGE_AUDIENCE = 'vistar:platform:challenge';
export const CHALLENGE_TTL_SEC = 300;
export const CHALLENGE_MAX_ATTEMPTS = 5;

/** Public API key prefix (Authorization: Bearer vst_live_...); defined in the shared contract. */
export { API_KEY_PREFIX } from '@vistar/shared';

export const WORKSPACE_REFRESH_PATH = `${API_BASE_PATH}/auth`;
export const SUPER_REFRESH_PATH = '/api/super/auth';
export { REFRESH_COOKIE, SUPER_REFRESH_COOKIE, SUPER_SESSION };

export function refreshCookieOptions(path: string, maxAgeSec?: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: getEnv().NODE_ENV === 'production',
    path,
    ...(maxAgeSec !== undefined ? { maxAge: maxAgeSec * 1000 } : {}),
  };
}

/** Client IP as seen by Express (respects TRUST_PROXY). IPv4-mapped IPv6 is unwrapped. */
export function clientIp(req: Request | null | undefined): string | null {
  const ip = req?.ip ?? req?.socket?.remoteAddress ?? null;
  if (!ip) return null;
  return ip.startsWith('::ffff:') && ip.includes('.') ? ip.slice(7) : ip;
}

export function userAgent(req: Request | null | undefined): string | null {
  const ua = req?.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 300) : null;
}

/** Bearer token from the Authorization header, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1]! : null;
}
