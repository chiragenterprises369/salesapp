import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { ApiError } from '@vistar/shared';
import type { NextFunction, Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { AppException } from '../../common/errors/app-exception.js';
import { KvStore } from '../../modules/auth/state/kv.store.js';
import { getProdEnv } from './prod-env.js';
import { currentRequest } from './request-context.js';

/** Counter store: Redis INCR with a TTL (KvStore falls back to memory without Redis). */
export interface CounterStore {
  incr(key: string, ttlSec: number): Promise<number>;
}

export type RateBucket = 'auth' | 'public' | 'files' | 'hooks';

/** Credential endpoints (login, sign-up, OAuth, invites, password reset, e-mail verification, Super Admin login and 2FA). */
const AUTH_CREDENTIAL = /^\/api\/(v1\/auth\/(login|signup|google|invite|invites|password|forgot|reset|verify|email)|v1\/invites\/lookup|super\/auth\/(login|verify|2fa|totp|password))/;

/** The per-IP bucket of a request path, or null for routes without a per-IP limit here. */
export function bucketOf(path: string): RateBucket | null {
  if (AUTH_CREDENTIAL.test(path)) return 'auth';
  if (path.startsWith('/api/hooks/')) return 'hooks';
  if (path.startsWith('/api/files/p/') || path.startsWith('/api/files/d/')) return 'files';
  if (path.startsWith('/api/v1/public/') || path.startsWith('/api/oauth/') || path === '/api/v1/openapi.json' || path === '/api/tls/ask') return 'public';
  return null;
}

export function limitOf(bucket: RateBucket): number {
  const env = getProdEnv();
  switch (bucket) {
    case 'auth':
      return env.RATE_LIMIT_AUTH_PER_MIN;
    case 'public':
      return env.RATE_LIMIT_PUBLIC_PER_MIN;
    case 'files':
      return env.RATE_LIMIT_PUBLIC_PER_MIN * 10;
    case 'hooks':
      return env.RATE_LIMIT_HOOKS_PER_MIN;
  }
}

const WINDOW_SEC = 60;
const windowOf = (now: number) => Math.floor(now / (WINDOW_SEC * 1000));
const retryAfter = (now: number) => Math.max(1, WINDOW_SEC - Math.floor((now % (WINDOW_SEC * 1000)) / 1000));

function tooMany(res: Response, req: Request, limit: number, now: number, message: string): void {
  res.setHeader('Retry-After', String(retryAfter(now)));
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', '0');
  res.status(429).json({ error: { code: 'RATE_LIMITED', message, requestId: req.id } } satisfies ApiError);
}

/**
 * Per-IP fixed-window limits (per minute, shared by all API instances through Redis) for credential, public,
 * file and webhook routes. Runs before the guards; uses `req.ip` (set TRUST_PROXY behind Caddy). When the store
 * fails the request passes (availability first; the in-process throttler still applies).
 */
export function ipRateLimit(store: CounterStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const path = (req.originalUrl ?? req.url).split('?')[0] ?? '';
    const bucket = bucketOf(path);
    if (!bucket || req.method === 'OPTIONS') return next();
    const now = Date.now();
    const limit = limitOf(bucket);
    const ip = req.ip ?? 'unknown';
    store
      .incr(`rl:ip:${bucket}:${ip}:${windowOf(now)}`, WINDOW_SEC + 5)
      .then((used) => {
        if (used > limit) return tooMany(res, req, limit, now, 'Too many requests. Wait a minute and try again');
        res.setHeader('X-RateLimit-Limit', String(limit));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - used)));
        next();
      })
      .catch(() => next());
  };
}

/**
 * Per-user limit on every authenticated route (after the guards, so the caller is known): signed-in users and
 * Super Admins. API keys keep their own per-key limit in the auth guard. Also stores the caller in the request
 * context for the logs.
 */
@Injectable()
export class UserRateLimitInterceptor implements NestInterceptor {
  constructor(private readonly kv: KvStore) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const store = currentRequest();
    if (store && req.auth) {
      store.userId = req.auth.userId;
      store.workspaceId = req.auth.workspaceId;
    }
    const who = req.auth?.via === 'jwt' && req.auth.userId ? `u:${req.auth.userId}` : req.platformAuth ? `a:${req.platformAuth.adminId}` : null;
    if (!who || process.env.NODE_ENV === 'test') return next.handle();
    const limit = getProdEnv().RATE_LIMIT_USER_PER_MIN;
    const now = Date.now();
    const used = await this.kv.incr(`rl:user:${who}:${windowOf(now)}`, WINDOW_SEC + 5).catch(() => 0);
    if (used > limit) {
      res.setHeader('Retry-After', String(retryAfter(now)));
      throw new AppException('RATE_LIMITED', 'Too many requests from this account. Wait a minute and try again');
    }
    return next.handle();
  }
}
