import { API_KEY_PREFIX, ApiKeyCreatedSchema, ApiKeySchema } from '@vistar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * API keys and the public API (change #19 wave C, D-070): api_access plan feature, scopes limited to the creator,
 * shown once, scope checks (403 API_KEY_SCOPE_MISSING), rotation with a grace for the old key, revoke, per-key rate
 * limit (429 + Retry-After), last used at and from, tenant isolation, GET /api/v1/openapi.json.
 * Written by HUB-API, run by Kiro Crew: `pnpm --filter @vistar/api test api-keys.http`.
 */
let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let b: Awaited<ReturnType<Harness['workspace']>>;

beforeAll(async () => {
  h = await createHarness('apikeys');
  a = await h.workspace('a');
  b = await h.workspace('b');
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('plan feature', () => {
  it('free plan (no api_access): create is 403 FEATURE_DISABLED', async () => {
    const res = await h.api().post('/api/v1/api-keys').set(bearer(a.token)).send({ name: 'x', scopes: ['leads.read'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
    await h.prisma.workspace.updateMany({ where: { id: { in: [a.workspaceId, b.workspaceId] } }, data: { plan: 'growth' } });
  });
});

describe('create, use, scopes', () => {
  let readKey = '';
  let readId = '';

  it('creates a key shown once; the list never shows it again', async () => {
    const res = await h.api().post('/api/v1/api-keys').set(bearer(a.token)).send({ name: 'ERP read', scopes: ['leads.read'], rateLimitPerMinute: 10 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const created = ApiKeyCreatedSchema.parse(res.body);
    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.prefix).toBe(created.key.slice(0, API_KEY_PREFIX.length + 4));
    readKey = created.key;
    readId = created.id;
    const list = await h.api().get('/api/v1/api-keys').set(bearer(a.token));
    expect(JSON.stringify(list.body)).not.toContain(readKey);
    expect(ApiKeySchema.array().parse(list.body.items).find((k) => k.id === readId)?.status).toBe('active');
  });

  it('a key works on API key routes, gets 403 API_KEY_SCOPE_MISSING without the scope, 401 on jwt-only routes', async () => {
    expect((await h.api().get('/api/v1/leads').set(bearer(readKey))).status).toBe(200);
    const create = await h.api().post('/api/v1/leads').set(bearer(readKey)).send({ name: 'Via key' });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe('API_KEY_SCOPE_MISSING');
    expect((await h.api().get('/api/v1/integrations').set(bearer(readKey))).status).toBe(401);
    // lastUsedAt / lastUsedIp are written after the response (fire and forget): poll briefly
    let row = await h.prisma.apiKey.findUniqueOrThrow({ where: { id: readId } });
    for (let i = 0; i < 20 && !row.lastUsedAt; i++) {
      await new Promise((r) => setTimeout(r, 100));
      row = await h.prisma.apiKey.findUniqueOrThrow({ where: { id: readId } });
    }
    expect(row.lastUsedAt).not.toBeNull();
    expect(row.lastUsedIp).toBeTruthy();
  });

  it('scopes the creator lacks are refused; the picker marks them', async () => {
    const mgr = await h.member(a.workspaceId, 'company_admin', 'keys-admin2');
    const scopes = await h.api().get('/api/v1/api-keys/scopes').set(bearer(mgr.token));
    expect(scopes.status).toBe(200);
    expect(scopes.body.items.every((s: { allowed: boolean }) => s.allowed)).toBe(true);
    // a custom role with apikeys.manage and leads.read only
    const role = await h.api().post('/api/v1/roles').set(bearer(a.token)).send({ name: `Key maker ${h.sfx}`, kind: 'employee', dataScope: 'all', permissions: ['apikeys.manage', 'leads.read'] });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const maker = await h.member(a.workspaceId, 'employee', 'keys-maker');
    await h.prisma.user.update({ where: { id: maker.userId }, data: { roleId: role.body.id as string } });
    const login = await h.api().post('/api/v1/auth/login').send({ email: `test-apikeys-keys-maker-${h.sfx}@example.test`, password: h.password });
    const token = login.body.accessToken as string;
    const denied = await h.api().post('/api/v1/api-keys').set(bearer(token)).send({ name: 'too much', scopes: ['leads.read', 'leads.create'] });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('API_KEY_SCOPE_NOT_ALLOWED');
    const picker = await h.api().get('/api/v1/api-keys/scopes').set(bearer(token));
    expect(picker.body.items.find((s: { scope: string }) => s.scope === 'leads.create').allowed).toBe(false);
  });

  it('rate limit per key: 429 with Retry-After above the limit', async () => {
    let last = 200;
    let retryAfter: string | undefined;
    for (let i = 0; i < 25 && last !== 429; i++) {
      const res = await h.api().get('/api/v1/leads').set(bearer(readKey));
      last = res.status;
      retryAfter = res.headers['retry-after'] as string | undefined;
    }
    expect(last).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('tenant isolation: the key only sees its workspace; B cannot manage A\'s keys', async () => {
    expect((await h.api().delete(`/api/v1/api-keys/${readId}`).set(bearer(b.token))).status).toBe(404);
    const other = await h.api().post('/api/v1/api-keys').set(bearer(b.token)).send({ name: 'B key', scopes: ['leads.read', 'leads.create'] });
    const bKey = other.body.key as string;
    const lead = await h.api().post('/api/v1/leads').set(bearer(a.token)).send({ name: 'A only lead' });
    expect((await h.api().get(`/api/v1/leads/${lead.body.id}`).set(bearer(bKey))).status).toBe(404);
  });
});

describe('rotate and revoke', () => {
  it('rotation: new key works, old key works during the grace; grace 0 ends it at once; revoke kills both', async () => {
    const created = await h.api().post('/api/v1/api-keys').set(bearer(a.token)).send({ name: 'Rotating', scopes: ['leads.read'] });
    const oldKey = created.body.key as string;
    const id = created.body.id as string;
    const rotated = await h.api().post(`/api/v1/api-keys/${id}/rotate`).set(bearer(a.token)).send({ graceMinutes: 5 });
    expect(rotated.status, JSON.stringify(rotated.body)).toBe(200);
    const newKey = rotated.body.key as string;
    expect(newKey).not.toBe(oldKey);
    expect(rotated.body.previousKeyExpiresAt).toBeTruthy();
    expect((await h.api().get('/api/v1/leads').set(bearer(newKey))).status).toBe(200);
    expect((await h.api().get('/api/v1/leads').set(bearer(oldKey))).status).toBe(200);
    const again = await h.api().post(`/api/v1/api-keys/${id}/rotate`).set(bearer(a.token)).send({ graceMinutes: 0 });
    const third = again.body.key as string;
    expect((await h.api().get('/api/v1/leads').set(bearer(newKey))).status).toBe(401);
    expect((await h.api().get('/api/v1/leads').set(bearer(third))).status).toBe(200);
    expect((await h.api().delete(`/api/v1/api-keys/${id}`).set(bearer(a.token))).status).toBe(200);
    expect((await h.api().get('/api/v1/leads').set(bearer(third))).status).toBe(401);
    expect((await h.api().post(`/api/v1/api-keys/${id}/rotate`).set(bearer(a.token)).send({})).status).toBe(409);
  });

  it('PATCH renames and changes the limit; the audit log records key actions', async () => {
    const created = await h.api().post('/api/v1/api-keys').set(bearer(a.token)).send({ name: 'Renamed', scopes: ['tasks.read'] });
    const res = await h.api().patch(`/api/v1/api-keys/${created.body.id}`).set(bearer(a.token)).send({ name: 'Renamed key', rateLimitPerMinute: 500 });
    expect(res.body).toMatchObject({ name: 'Renamed key', rateLimitPerMinute: 500 });
    const actions = (await h.prisma.auditLog.findMany({ where: { workspaceId: a.workspaceId, entityType: 'api_key' }, select: { action: true } })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['apikey.create', 'apikey.rotate', 'apikey.revoke', 'apikey.update']));
  });
});

describe('public API reference', () => {
  it('GET /api/v1/openapi.json is public and lists the API key routes only', async () => {
    const res = await h.api().get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toContain('/api/v1/leads');
    expect(Object.keys(res.body.paths)).not.toContain('/api/v1/api-keys');
    expect(JSON.stringify(res.body)).not.toContain('/api/super');
  });
});
