import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { API_ROUTES, type RouteDef } from '@vistar/shared';
import { ROUTE_DEF_KEY } from '../../../common/auth/auth-context.js';
import { securityPolicy } from '../../config-registry/snapshot.js';

const reflector = new Reflector();

// ---- change #20: config. Login limits come from Super Admin > Config > Security policy (read per request).
const login = () => securityPolicy().loginRateLimitPerMinute;
const superLogin = () => securityPolicy().superLoginRateLimitPerMinute;
const fixed = (n: number) => () => n;

/** Per-IP limits per minute for credential and token endpoints. Everything else gets the default. */
const STRICT_LIMITS = new Map<RouteDef, () => number>([
  [API_ROUTES.authLogin, login],
  [API_ROUTES.authSignup, login],
  [API_ROUTES.authGoogle, login],
  [API_ROUTES.inviteAccept, login],
  [API_ROUTES.authPasswordReset, login],
  [API_ROUTES.authEmailVerify, login],
  [API_ROUTES.authPasswordForgot, fixed(5)],
  [API_ROUTES.myEmailVerificationSend, fixed(3)],
  [API_ROUTES.superLogin, superLogin],
  [API_ROUTES.superVerify, superLogin],
  [API_ROUTES.authRefresh, fixed(30)],
  [API_ROUTES.superRefresh, fixed(30)],
  [API_ROUTES.inviteLookup, fixed(30)],
  [API_ROUTES.authPasswordResetLookup, fixed(30)],
]);

function strictLimit(ctx: ExecutionContext): number | undefined {
  const def = reflector.get<RouteDef | undefined>(ROUTE_DEF_KEY, ctx.getHandler());
  return def ? STRICT_LIMITS.get(def)?.() : undefined;
}

/**
 * Two throttlers keyed by client IP (Express `req.ip`, so set TRUST_PROXY behind a load balancer):
 * `default` = the strict limits above (credential endpoints only, so a 429 there carries the plain
 * `Retry-After` header), `global` 600/min for every route. Storage is in-process memory (per API instance).
 */
export const THROTTLER_OPTIONS: ThrottlerModuleOptions = {
  errorMessage: 'Too many requests. Wait a minute and try again',
  throttlers: [
    { name: 'default', ttl: 60_000, limit: (ctx) => strictLimit(ctx) ?? 0, skipIf: (ctx) => strictLimit(ctx) === undefined },
    { name: 'global', ttl: 60_000, limit: 600 },
  ],
};

/** ThrottlerGuard for HTTP only (WebSocket/queue contexts have no Express request). */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(ctx: ExecutionContext): Promise<boolean> {
    return ctx.getType() !== 'http';
  }
}
