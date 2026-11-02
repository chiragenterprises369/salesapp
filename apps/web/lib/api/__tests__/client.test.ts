import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api-error';
import { api, configureApiClient, errorFromResponse, refreshAccessToken, resetApiClientForTests, superApi, toQueryString } from '../client';
import { getAccessTokenFor, setAccessToken } from '../tokens';

/**
 * HTTP client unit tests: response parsing with the route's zod schema, the error envelope mapped to
 * ApiRequestError, the single in-flight refresh, retry after AUTH_TOKEN_EXPIRED, sign-out when the
 * refresh token was reused or revoked, request ids, timeouts and audiences.
 */

const ORIGIN = 'http://localhost:4000';
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const envelope = (code: string, message: string, extra: Record<string, unknown> = {}) => ({ error: { code, message, ...extra } });

const OPTIONS = { items: [{ id: '0190f5a0-0000-7000-8000-000000000001', name: 'Priya Sharma', role: 'manager', status: 'idle', avatar: null }] };

type Call = { url: string; init: RequestInit };
let calls: Call[];
let handler: (url: string, init: RequestInit) => Promise<Response> | Response;

beforeEach(() => {
  resetApiClientForTests();
  calls = [];
  handler = () => json(500, {});
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

describe('requests', () => {
  it('builds the URL from API_ROUTES, sends the bearer token, a request id and cookies', async () => {
    setAccessToken('workspace', 'tok-1', 900);
    handler = () => json(200, OPTIONS);
    const res = await api.call('userOptions', { query: { q: 'pri' } });
    expect(res.items[0]!.name).toBe('Priya Sharma');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/v1/users/options?q=pri`);
    expect(header(calls[0]!, 'authorization')).toBe('Bearer tok-1');
    expect(header(calls[0]!, 'x-request-id')).toMatch(/^[0-9a-f-]{32,36}$/);
    expect(calls[0]!.init.credentials).toBe('include');
  });

  it('fills path params and serialises arrays comma-separated, skipping empty values', async () => {
    expect(toQueryString({ stageId: ['a', 'b'], q: '', ownerId: undefined, perColumn: 20, flag: true })).toBe('?stageId=a%2Cb&perColumn=20&flag=true');
    setAccessToken('workspace', 'tok', 900);
    handler = () => json(200, { items: [], nextCursor: null });
    await api.call('boardColumnPage', { params: { id: 'p1', stageId: 's1' }, query: { cursor: 'c', tag: ['hot'] } });
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/v1/pipelines/p1/board/columns/s1?cursor=c&tag=hot`);
  });

  it('public routes go out without a token', async () => {
    handler = () => json(200, { workspaceName: 'Shakti Industries', email: null, roleName: 'Employee' });
    await api.call('inviteLookup', { query: { token: 'x'.repeat(20) } });
    expect(header(calls[0]!, 'authorization')).toBeNull();
  });

  it('parses responses with the route schema and applies defaults', async () => {
    setAccessToken('workspace', 'tok', 900);
    handler = () => json(200, { theme: {}, notifications: {} });
    const s = await api.call('mySettingsGet');
    expect(s.motionIntensity).toBe('full');
    expect(s.notifications.emailDigest).toBe('daily');
  });

  it('rejects a response that does not match the contract', async () => {
    setAccessToken('workspace', 'tok', 900);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    handler = () => json(200, { items: [{ id: 'not-a-uuid' }] }, { 'x-request-id': 'req-9' });
    const err = await api.call('userOptions').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).code).toBe('INTERNAL_ERROR');
    expect((err as ApiRequestError).requestId).toBe('req-9');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps a route on its own audience', async () => {
    await expect(api.call('superMe')).rejects.toThrow(/platform audience/);
    await expect(superApi.call('authMe')).rejects.toThrow(/workspace audience/);
    expect(calls).toHaveLength(0);
  });

  it('the platform client calls /api/super with the platform token', async () => {
    setAccessToken('platform', 'ptok', 600);
    handler = () => json(200, { items: [] });
    await superApi.call('superPackList');
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/super/packs`);
    expect(header(calls[0]!, 'authorization')).toBe('Bearer ptok');
  });
});

describe('error mapping', () => {
  it('maps the envelope to ApiRequestError with code, message, details, status and request id', async () => {
    setAccessToken('workspace', 'tok', 900);
    handler = () =>
      json(409, envelope('LEAD_DUPLICATE', 'A lead with this phone already exists', { details: [{ path: 'phone', message: 'Already used' }], requestId: 'req-1' }));
    const err = (await api.call('leadCreate', { body: { name: 'A' } as never }).catch((e: unknown) => e)) as ApiRequestError;
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe('LEAD_DUPLICATE');
    expect(err.message).toBe('A lead with this phone already exists');
    expect(err.details).toEqual([{ path: 'phone', message: 'Already used' }]);
    expect(err.status).toBe(409);
    expect(err.requestId).toBe('req-1');
  });

  it('falls back to the HTTP status for non-JSON errors', async () => {
    const e1 = await errorFromResponse(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'x-request-id': 'r2' } }));
    expect([e1.code, e1.status, e1.requestId]).toEqual(['SERVICE_UNAVAILABLE', 502, 'r2']);
    const e2 = await errorFromResponse(new Response('', { status: 404 }));
    expect(e2.code).toBe('NOT_FOUND');
    const e3 = await errorFromResponse(new Response('', { status: 500 }));
    expect(e3.code).toBe('INTERNAL_ERROR');
  });

  it('keeps codes this build does not know yet', async () => {
    const e = await errorFromResponse(json(422, envelope('SOMETHING_NEW', 'New rule')));
    expect([e.code, e.message]).toEqual(['SOMETHING_NEW', 'New rule']);
  });

  it('turns network failures into SERVICE_UNAVAILABLE with status 0', async () => {
    setAccessToken('workspace', 'tok', 900);
    handler = () => {
      throw new TypeError('Failed to fetch');
    };
    const err = (await api.call('userOptions').catch((e: unknown) => e)) as ApiRequestError;
    expect([err.code, err.status, err.timeout]).toEqual(['SERVICE_UNAVAILABLE', 0, false]);
  });

  it('times out slow requests', async () => {
    setAccessToken('workspace', 'tok', 900);
    handler = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    const err = (await api.call('userOptions', { timeoutMs: 20 }).catch((e: unknown) => e)) as ApiRequestError;
    expect(err).toBeInstanceOf(ApiRequestError);
    expect([err.code, err.timeout]).toEqual(['SERVICE_UNAVAILABLE', true]);
  });

  it('passes caller aborts through as AbortError', async () => {
    setAccessToken('workspace', 'tok', 900);
    handler = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    const ctrl = new AbortController();
    const p = api.call('userOptions', { signal: ctrl.signal }).catch((e: unknown) => e);
    ctrl.abort();
    const err = (await p) as Error;
    expect(err).not.toBeInstanceOf(ApiRequestError);
    expect(err.name).toBe('AbortError');
  });
});

describe('refresh', () => {
  const refreshOk = (token: string) => json(200, { accessToken: token, expiresIn: 900 });

  it('refreshes once and retries after AUTH_TOKEN_EXPIRED', async () => {
    setAccessToken('workspace', 'old', 900);
    handler = (url, init) => {
      if (url.endsWith('/auth/refresh')) return refreshOk('new');
      const auth = new Headers(init.headers).get('authorization');
      return auth === 'Bearer new' ? json(200, OPTIONS) : json(401, envelope('AUTH_TOKEN_EXPIRED', 'Your session expired. Sign in again'));
    };
    const res = await api.call('userOptions');
    expect(res.items).toHaveLength(1);
    expect(calls.map((c) => c.url.replace(ORIGIN, ''))).toEqual(['/api/v1/users/options', '/api/v1/auth/refresh', '/api/v1/users/options']);
    expect(calls[1]!.init.method).toBe('POST');
    expect(calls[1]!.init.credentials).toBe('include');
    expect(getAccessTokenFor('workspace')).toBe('new');
  });

  it('runs ONE refresh for many parallel requests without a token', async () => {
    let refreshes = 0;
    handler = async (url) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return refreshOk('shared');
      }
      return json(200, OPTIONS);
    };
    await Promise.all([api.call('userOptions'), api.call('userOptions'), api.call('userOptions'), refreshAccessToken('workspace')]);
    expect(refreshes).toBe(1);
    expect(calls.filter((c) => !c.url.endsWith('/auth/refresh')).every((c) => header(c, 'authorization') === 'Bearer shared')).toBe(true);
  });

  it('refreshes ahead of expiry', async () => {
    setAccessToken('workspace', 'almost', 10);
    handler = (url) => (url.endsWith('/auth/refresh') ? refreshOk('fresh') : json(200, OPTIONS));
    await api.call('userOptions');
    expect(calls[0]!.url).toContain('/auth/refresh');
    expect(header(calls[1]!, 'authorization')).toBe('Bearer fresh');
  });

  it('signs out when the refresh token was reused or revoked', async () => {
    const ended = vi.fn();
    configureApiClient({ onSessionEnded: ended });
    setAccessToken('workspace', 'old', 900);
    handler = (url) =>
      url.endsWith('/auth/refresh')
        ? json(401, envelope('AUTH_TOKEN_INVALID', 'Your session ended. Sign in again'))
        : json(401, envelope('AUTH_TOKEN_EXPIRED', 'Your session expired. Sign in again'));
    const err = (await api.call('userOptions').catch((e: unknown) => e)) as ApiRequestError;
    expect(err.code).toBe('AUTH_TOKEN_INVALID');
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith('workspace', { code: 'AUTH_TOKEN_INVALID', message: 'Your session ended. Sign in again' });
    expect(getAccessTokenFor('workspace')).toBeNull();
    // No retry loop: one request, one refresh.
    expect(calls).toHaveLength(2);
  });

  it('signs out on AUTH_TOKEN_INVALID from a normal request without refreshing', async () => {
    const ended = vi.fn();
    configureApiClient({ onSessionEnded: ended });
    setAccessToken('workspace', 'revoked', 900);
    handler = () => json(401, envelope('AUTH_TOKEN_INVALID', 'Your session ended. Sign in again'));
    await expect(api.call('userOptions')).rejects.toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it('does not call refresh when no session hint exists (signed out)', async () => {
    configureApiClient({ canRefresh: () => false });
    await expect(api.call('userOptions')).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
    expect(calls).toHaveLength(0);
  });

  it('keeps the session on a network failure during refresh', async () => {
    const ended = vi.fn();
    configureApiClient({ onSessionEnded: ended });
    handler = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(refreshAccessToken('workspace')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(ended).not.toHaveBeenCalled();
  });

  it('platform refresh stores the token and hands the admin to the session layer', async () => {
    const onPlatform = vi.fn();
    configureApiClient({ onPlatformRefresh: onPlatform });
    const admin = {
      id: '0190f5a0-0000-7000-8000-600000000001',
      email: 'owner@vistar.example',
      name: 'Owner',
      permissions: [],
      mfaEnabled: true,
      ipAllowlist: [],
      isActive: true,
      lastLoginAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    handler = () => json(200, { accessToken: 'p2', expiresIn: 600, admin, idleTimeoutSec: 1800 });
    await refreshAccessToken('platform');
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/super/auth/refresh`);
    expect(getAccessTokenFor('platform')).toBe('p2');
    expect(onPlatform).toHaveBeenCalledWith(expect.objectContaining({ admin: expect.objectContaining({ email: 'owner@vistar.example' }) }));
  });

  it('a non-refreshable (impersonation) token ends the session when it expires', async () => {
    const ended = vi.fn();
    configureApiClient({ onSessionEnded: ended });
    setAccessToken('workspace', 'imp', -1, { refreshable: false });
    await expect(api.call('userOptions')).rejects.toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });
});
