import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { API_ROUTES, type RouteDef } from '@vistar/shared';
import { ROUTE_DEF_KEY } from '../../../common/auth/auth-context.js';

const reflector = new Reflector();

/** Per-IP limits per minute for credential and token endpoints. Everything else gets the default. */
const STRICT_LIMITS = new Map<RouteDef, number>([
  [API_ROUTES.authLogin, 10],
  [API_ROUTES.authSignup, 10],
  [API_ROUTES.authGoogle, 10],
  [API_ROUTES.inviteAccept, 10],
  [API_ROUTES.superLogin, 10],
  [API_ROUTES.superVerify, 10],
  [API_ROUTES.authRefresh, 30],
  [API_ROUTES.superRefresh, 30],
  [API_ROUTES.inviteLookup, 30],
]);

function strictLimit(ctx: ExecutionContext): number | undefined {
  const def = reflector.get<RouteDef | undefined>(ROUTE_DEF_KEY, ctx.getHandler());
  return def ? STRICT_LIMITS.get(def) : undefined;
}

/**
 * Two throttlers keyed by client IP (Express `req.ip`, so set TRUST_PROXY behind a load balancer):
 * `default` 600/min for every route, `auth` (strict, see STRICT_LIMITS) for credential endpoints.
 * Storage is in-process memory (per API instance).
 */
export const THROTTLER_OPTIONS: ThrottlerModuleOptions = {
  errorMessage: 'Too many requests. Wait a minute and try again',
  throttlers: [
    { name: 'default', ttl: 60_000, limit: 600 },
    { name: 'auth', ttl: 60_000, limit: (ctx) => strictLimit(ctx) ?? 0, skipIf: (ctx) => strictLimit(ctx) === undefined },
  ],
};

/** ThrottlerGuard for HTTP only (WebSocket/queue contexts have no Express request). */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(ctx: ExecutionContext): Promise<boolean> {
    return ctx.getType() !== 'http';
  }
}
