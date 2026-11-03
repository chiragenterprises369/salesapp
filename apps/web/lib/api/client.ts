import {
  API_ROUTES,
  AuthTokensSchema,
  PlanLimitErrorSchema,
  routePath,
  SuperSessionSchema,
  type ApiRouteId,
  type AuthTokens,
  type ErrorCode,
  type FieldError,
  type PlanLimitError,
  type RouteBody,
  type RouteDef,
  type RouteParams,
  type RouteQuery,
  type RouteResponse,
  type SuperSession,
} from '@vistar/shared';
import { ApiRequestError } from '../api-error';
import { API_ORIGIN, REQUEST_TIMEOUT_MS, TOKEN_REFRESH_SKEW_MS, TRANSFER_TIMEOUT_MS } from './config';
import { clearAccessToken, getAccessTokenFor, getStoredToken, isTokenFresh, setAccessToken, type Audience } from './tokens';

/**
 * Typed HTTP client over API_ROUTES (method, path, auth mode and zod response schema come from the
 * shared contract, so the web cannot drift from the API).
 *
 * - Two clients: `api` (workspace audience, /api/v1) and `superApi` (platform audience, /api/super).
 *   A route of the other audience throws before any request is made.
 * - Access token in memory (lib/api/tokens) as `Authorization: Bearer`; refresh tokens are the
 *   httpOnly cookies `vistar_rt` / `vistar_srt` (every request uses `credentials: 'include'`).
 * - Refresh: ONE in-flight refresh per audience in the tab, serialised across tabs with the Web
 *   Locks API. The API rotates the refresh cookie on every use and treats a concurrent second use
 *   as token theft (revokes the whole family), so refreshes must never overlap.
 * - A request answered with AUTH_TOKEN_EXPIRED (or with no token yet) refreshes once and retries once.
 *   A failed refresh (reused, revoked, expired, disabled) ends the session: the token is cleared and
 *   the session layer signs out (`configureApiClient({ onSessionEnded })`).
 * - Every request sends `x-request-id` (the API logs it and echoes it in errors); errors become
 *   ApiRequestError with the envelope's code, message, field details, status and request id.
 * - Timeouts: 20 s by default, 120 s for uploads and downloads. Caller aborts (TanStack Query
 *   cancellation) are passed through as AbortError.
 */

export interface SessionEndReason {
  code: ErrorCode;
  message: string;
}

interface ClientHooks {
  /** The refresh cookie is gone, reused, revoked or expired, or the account was disabled. */
  onSessionEnded?: (audience: Audience, reason: SessionEndReason) => void;
  /** Workspace token rotated (the session layer reloads /auth/me when the role changed). */
  onWorkspaceRefresh?: (tokens: AuthTokens) => void;
  /** Platform session rotated (carries the admin profile). */
  onPlatformRefresh?: (session: SuperSession) => void;
  /** Whether a refresh cookie may exist for this audience (avoids 401 noise when signed out). */
  canRefresh?: (audience: Audience) => boolean;
}

let hooks: ClientHooks = {};

export function configureApiClient(next: ClientHooks): void {
  hooks = { ...hooks, ...next };
}

/** Error codes that mean "this session is over; sign in again". */
const SESSION_END_CODES = new Set<string>(['AUTH_UNAUTHENTICATED', 'AUTH_TOKEN_INVALID', 'AUTH_TOKEN_EXPIRED', 'AUTH_ACCOUNT_DISABLED']);

const STATUS_FALLBACK: Array<[number, ErrorCode, string]> = [
  [400, 'VALIDATION_FAILED', 'Some fields are invalid. Check them and try again.'],
  [401, 'AUTH_UNAUTHENTICATED', 'Sign in to continue.'],
  [402, 'PLAN_LIMIT_REACHED', 'Your plan limit is reached. Upgrade the plan to add more.'],
  [403, 'FORBIDDEN', 'You do not have permission to do this.'],
  [404, 'NOT_FOUND', 'This item was not found. It may have been deleted.'],
  [409, 'CONFLICT', 'Someone changed this at the same time. Reload and try again.'],
  [413, 'PAYLOAD_TOO_LARGE', 'The file or request is too large.'],
  [429, 'RATE_LIMITED', 'Too many requests. Wait a minute and try again.'],
];

function fallbackFor(status: number): [ErrorCode, string] {
  const hit = STATUS_FALLBACK.find(([s]) => s === status);
  if (hit) return [hit[1], hit[2]];
  if (status === 502 || status === 503 || status === 504) return ['SERVICE_UNAVAILABLE', 'Vistar is not available right now. Try again in a minute.'];
  return ['INTERNAL_ERROR', 'Something went wrong on our side. Try again.'];
}

export const NETWORK_ERROR_MESSAGE = 'Vistar could not reach the server. Check your connection and try again.';
export const TIMEOUT_ERROR_MESSAGE = 'The server took too long to answer. Try again.';

/** `error.planLimit` of 402 PLAN_LIMIT_REACHED responses (ApiRequestError itself stays as it is). */
const planLimits = new WeakMap<ApiRequestError, PlanLimitError>();

/** Which limit stopped a create (metric, limit, used, plan, upgrade plan and URL), or null. */
export function planLimitOf(e: unknown): PlanLimitError | null {
  return e instanceof ApiRequestError ? (planLimits.get(e) ?? null) : null;
}

/** Map a non-2xx response to ApiRequestError (tolerates codes this build does not know yet). */
export async function errorFromResponse(res: Response): Promise<ApiRequestError> {
  const headerId = res.headers.get('x-request-id');
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const env = (body as { error?: { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown; planLimit?: unknown } } | null)?.error;
  if (env && typeof env.code === 'string' && typeof env.message === 'string') {
    const details: FieldError[] = Array.isArray(env.details)
      ? env.details.filter((d): d is FieldError => !!d && typeof d.path === 'string' && typeof d.message === 'string')
      : [];
    const err = new ApiRequestError(env.code as ErrorCode, env.message, details, {
      status: res.status,
      requestId: typeof env.requestId === 'string' ? env.requestId : headerId,
    });
    if (env.planLimit !== undefined) {
      const limit = PlanLimitErrorSchema.safeParse(env.planLimit);
      if (limit.success) planLimits.set(err, limit.data);
    }
    return err;
  }
  const [code, message] = fallbackFor(res.status);
  return new ApiRequestError(code, message, [], { status: res.status, requestId: headerId });
}

export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Non-secure contexts (http on a LAN address) have no randomUUID.
  const b = new Uint8Array(16);
  c?.getRandomValues?.(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Query object -> "?a=1&b=x,y" (arrays comma-separated, as `queryArray` on the API expects). */
export function toQueryString(query: unknown): string {
  if (!query || typeof query !== 'object') return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      const items = v.filter((x) => x !== undefined && x !== null && x !== '');
      if (items.length) sp.set(k, items.map(String).join(','));
    } else if (v instanceof Date) sp.set(k, v.toISOString());
    else if (typeof v === 'object') sp.set(k, JSON.stringify(v));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
  if (outer?.aborted) throw outer.reason ?? new DOMException('The request was cancelled', 'AbortError');
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort(outer?.reason);
  outer?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (timedOut) throw new ApiRequestError('SERVICE_UNAVAILABLE', TIMEOUT_ERROR_MESSAGE, [], { status: 0, timeout: true });
    if (outer?.aborted) throw e;
    throw new ApiRequestError('SERVICE_UNAVAILABLE', NETWORK_ERROR_MESSAGE, [], { status: 0 });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

// ------------------------------------------------------------------ refresh (single flight)

const inflight: Partial<Record<Audience, Promise<void>>> = {};

async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') return fn();
  return locks.request(name, { mode: 'exclusive' }, fn) as Promise<T>;
}

function endSession(audience: Audience, err: { code: ErrorCode; message: string }): void {
  clearAccessToken(audience);
  hooks.onSessionEnded?.(audience, { code: err.code, message: err.message });
}

async function doRefresh(audience: Audience): Promise<void> {
  const def: RouteDef = audience === 'workspace' ? API_ROUTES.authRefresh : API_ROUTES.superRefresh;
  const res = await fetchWithTimeout(
    API_ORIGIN + routePath(def),
    { method: 'POST', credentials: 'include', headers: { 'x-request-id': newRequestId(), accept: 'application/json' } },
    REQUEST_TIMEOUT_MS,
  );
  if (!res.ok) {
    const err = await errorFromResponse(res);
    if (SESSION_END_CODES.has(err.code) || err.code === 'FORBIDDEN') endSession(audience, err);
    throw err;
  }
  const json: unknown = await res.json().catch(() => null);
  if (audience === 'workspace') {
    const tokens = AuthTokensSchema.parse(json);
    setAccessToken('workspace', tokens.accessToken, tokens.expiresIn);
    hooks.onWorkspaceRefresh?.(tokens);
  } else {
    const session = SuperSessionSchema.parse(json);
    setAccessToken('platform', session.accessToken, session.expiresIn);
    hooks.onPlatformRefresh?.(session);
  }
}

/**
 * Rotate the refresh cookie and get a new access token. Concurrent callers share one request;
 * other tabs wait for the cross-tab lock and then refresh with the newest cookie.
 */
export function refreshAccessToken(audience: Audience): Promise<void> {
  const running = inflight[audience];
  if (running) return running;
  const run = withLock(`vistar.refresh.${audience}`, () => doRefresh(audience)).finally(() => {
    inflight[audience] = undefined;
  });
  inflight[audience] = run;
  return run;
}

async function ensureToken(audience: Audience): Promise<void> {
  const stored = getStoredToken(audience);
  if (stored && isTokenFresh(audience, TOKEN_REFRESH_SKEW_MS)) return;
  if (stored && !stored.refreshable) {
    // Impersonation token: no refresh cookie. Use it until it expires, then the session is over.
    if (stored.expiresAt > Date.now()) return;
    const err = new ApiRequestError('AUTH_TOKEN_EXPIRED', 'The support session ended', [], { status: 401 });
    endSession(audience, err);
    throw err;
  }
  if (!stored && hooks.canRefresh && !hooks.canRefresh(audience)) {
    throw new ApiRequestError('AUTH_UNAUTHENTICATED', 'Sign in to continue', [], { status: 401 });
  }
  await refreshAccessToken(audience);
}

// ------------------------------------------------------------------ requests

/**
 * A valid access token for the realtime socket handshake (refreshes first when it is about to
 * expire). Null when there is no session for the audience.
 */
export async function getFreshAccessToken(audience: Audience): Promise<string | null> {
  try {
    await ensureToken(audience);
  } catch {
    return null;
  }
  return getAccessTokenFor(audience);
}

const isPublic = (def: RouteDef) => def.auth === 'public' || def.auth === 'super_public' || def.auth === 'webhook';
const isPlatformRoute = (def: RouteDef) => def.auth === 'super' || def.auth === 'super_public';

interface SendOptions {
  params?: Record<string, string>;
  query?: unknown;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  timeoutMs?: number;
}

type IfNever<T, A, B> = [T] extends [never] ? A : B;
/** Query values as callers hold them (booleans and numbers are serialised; `z.stringbool()` inputs are strings). */
type LooseQuery<T> = T extends object ? { [P in keyof T]?: T[P] | string | number | boolean | readonly string[] | null } : T;

/** Options for `call(id, opts)`: params/body are required exactly when the route has them. */
export type CallOptions<K extends ApiRouteId> = { signal?: AbortSignal; timeoutMs?: number } & IfNever<
  RouteParams<K>,
  { params?: undefined },
  { params: RouteParams<K> }
> &
  IfNever<RouteQuery<K>, { query?: undefined }, { query?: LooseQuery<RouteQuery<K>> }> &
  IfNever<RouteBody<K>, { body?: undefined }, { body: RouteBody<K> }>;

type OptsArg<K extends ApiRouteId> = IfNever<RouteParams<K>, IfNever<RouteBody<K>, [opts?: CallOptions<K>], [opts: CallOptions<K>]>, [opts: CallOptions<K>]>;

export interface ApiClient {
  readonly audience: Audience;
  /** JSON request; the response is parsed with the route's zod schema (defaults applied). */
  call<K extends ApiRouteId>(id: K, ...args: OptsArg<K>): Promise<RouteResponse<K>>;
  /** Multipart upload (e.g. lead import); JSON response parsed like `call`. */
  upload<K extends ApiRouteId>(id: K, formData: FormData, opts?: Omit<SendOptions, 'body' | 'formData'>): Promise<RouteResponse<K>>;
  /** File download (e.g. lead export). */
  download<K extends ApiRouteId>(id: K, opts?: Omit<SendOptions, 'body' | 'formData'>): Promise<{ blob: Blob; filename: string | null }>;
}

function parseResponse(def: RouteDef, id: string, json: unknown, res: Response): unknown {
  if (!def.response) return undefined;
  const parsed = def.response.safeParse(json);
  if (parsed.success) return parsed.data;
  const paths = parsed.error.issues.slice(0, 5).map((i) => i.path.join('.') || '(root)');
  console.warn(`[vistar] ${id}: response did not match the contract at ${paths.join(', ')}`);
  throw new ApiRequestError(
    'INTERNAL_ERROR',
    'The server sent an answer this page does not understand. Reload the page; if it keeps happening, contact support.',
    [],
    { status: res.status, requestId: res.headers.get('x-request-id') },
  );
}

/**
 * 402 PLAN_LIMIT_REACHED on any workspace request (creates of users, invites, leads, API keys...): one
 * central toast with the upgrade link, on top of the caller's own error handling. Loaded on demand.
 */
function notifyPlanLimit(err: ApiRequestError): void {
  if (typeof window === 'undefined') return;
  void import('../billing/plan-limit')
    .then((m) => m.showPlanLimitToast(err))
    .catch(() => undefined);
}

export function createApiClient(audience: Audience): ApiClient {
  function routeFor(id: ApiRouteId): RouteDef {
    const def = API_ROUTES[id] as RouteDef | undefined;
    if (!def) throw new Error(`Unknown API route "${id}"`);
    if (isPlatformRoute(def) !== (audience === 'platform')) {
      throw new Error(`Route "${id}" belongs to the ${isPlatformRoute(def) ? 'platform' : 'workspace'} audience; use the matching client`);
    }
    return def;
  }

  async function send(def: RouteDef, opts: SendOptions, retried = false): Promise<Response> {
    const auth = !isPublic(def);
    if (auth) await ensureToken(audience);
    const headers: Record<string, string> = { 'x-request-id': newRequestId(), accept: 'application/json, */*' };
    const token = auth ? getAccessTokenFor(audience) : null;
    if (token) headers.authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (opts.formData) body = opts.formData;
    else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const url = API_ORIGIN + routePath(def, opts.params) + toQueryString(opts.query);
    const res = await fetchWithTimeout(
      url,
      { method: def.method.toUpperCase(), headers, body, credentials: 'include' },
      opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
      opts.signal,
    );
    if (res.ok) return res;

    const err = await errorFromResponse(res);
    if (auth) {
      const stored = getStoredToken(audience);
      const canRetry = !retried && stored?.refreshable !== false;
      if (canRetry && (err.code === 'AUTH_TOKEN_EXPIRED' || err.code === 'AUTH_UNAUTHENTICATED')) {
        await refreshAccessToken(audience);
        return send(def, opts, true);
      }
      if (err.code === 'AUTH_TOKEN_INVALID' || err.code === 'AUTH_ACCOUNT_DISABLED' || err.code === 'AUTH_TOKEN_EXPIRED' || err.code === 'AUTH_UNAUTHENTICATED') {
        endSession(audience, err);
      }
    }
    if (err.code === 'PLAN_LIMIT_REACHED' && audience === 'workspace') notifyPlanLimit(err);
    throw err;
  }

  return {
    audience,
    async call(id, ...args) {
      const def = routeFor(id);
      const opts = (args[0] ?? {}) as SendOptions;
      const res = await send(def, opts);
      if (!def.response || res.status === 204) return undefined as never;
      const json: unknown = await res.json().catch(() => null);
      return parseResponse(def, id, json, res) as never;
    },
    async upload(id, formData, opts = {}) {
      const def = routeFor(id);
      const res = await send(def, { ...opts, formData, timeoutMs: opts.timeoutMs ?? TRANSFER_TIMEOUT_MS });
      const json: unknown = await res.json().catch(() => null);
      return parseResponse(def, id, json, res) as never;
    },
    async download(id, opts = {}) {
      const def = routeFor(id);
      const res = await send(def, { ...opts, timeoutMs: opts.timeoutMs ?? TRANSFER_TIMEOUT_MS });
      const disposition = res.headers.get('content-disposition');
      const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition) : null;
      return { blob: await res.blob(), filename: match?.[1] ? decodeURIComponent(match[1]) : null };
    },
  };
}

/** Workspace audience (Company and Employee panels, /api/v1). */
export const api = createApiClient('workspace');
/** Platform audience (Super Admin, /api/super). */
export const superApi = createApiClient('platform');

/** Tests only. */
export function resetApiClientForTests(): void {
  hooks = {};
  inflight.workspace = undefined;
  inflight.platform = undefined;
  clearAccessToken('workspace');
  clearAccessToken('platform');
}
