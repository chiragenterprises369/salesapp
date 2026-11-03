/**
 * Change #19 wave C (hub) contract tests: payload mapping engine, inbound/outbound schemas, routes, public OpenAPI.
 * Written by HUB-API; run by Kiro Crew (`pnpm --filter @vistar/shared test change19c`).
 */
import { describe, expect, it } from 'vitest';
import { buildPublicOpenApiDocument } from '../api/openapi.js';
import { API_ROUTES, type RouteDef } from '../api/routes.js';
import { ERROR_HTTP_STATUS } from '../errors.js';
import { EVENT_NAMES } from '../events.js';
import { apiKeyScopeOptions, INTEGRATION_CATALOG } from '../integrations.js';
import { applyPayloadMapping, evaluateExpression, listPayloadPaths, parsePath, resolvePath } from '../mapping.js';
import { CHANGE_19C_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '../rbac.js';
import {
  INTEGRATION_CONFIG_SCHEMAS,
  InboundEndpointCreateSchema,
  OutboundEndpointCreateSchema,
  PayloadMappingSchema,
  WebhookRotateSecretSchema,
} from '../schemas/integration.js';
import { INTEGRATION_PROVIDERS } from '../enums.js';
import { OUTBOUND_WEBHOOK_EVENTS, parseSignatureHeader, signaturePayload, webhookAttemptOffsetsSec, WEBHOOK_MAX_ATTEMPTS } from '../webhooks.js';

const indiamartLike = {
  CODE: 200,
  RESPONSE: {
    UNIQUE_QUERY_ID: '2836491048',
    SENDER_NAME: '  Ramesh Kumar Patil ',
    SENDER_MOBILE: '+91-9822012345',
    SENDER_EMAIL: 'Ramesh@Patil.Example',
    SENDER_COMPANY: 'Patil Steel',
    SENDER_CITY: 'Pune',
    QUERY_PRODUCT_NAME: 'MS Angle',
    QUERY_MESSAGE: 'Need 200 kg',
    items: [{ sku: 'A1', qty: '₹1,25,000' }],
  },
};

describe('payload mapping engine', () => {
  it('parses dot, index and bracket paths', () => {
    expect(parsePath('$.data.items[0]["first name"].x')).toEqual(['data', 'items', '0', 'first name', 'x']);
    expect(resolvePath(indiamartLike, 'RESPONSE.items.0.sku')).toBe('A1');
    expect(resolvePath(indiamartLike, 'RESPONSE.missing.deep')).toBeUndefined();
  });

  it('supports fallbacks, joins and constants', () => {
    expect(evaluateExpression({ a: '', b: 'x' }, 'a || b')).toBe('x');
    expect(evaluateExpression({ f: 'Asha', l: 'Rao' }, 'f + l')).toBe('Asha Rao');
    expect(evaluateExpression({}, 'missing || "fallback"')).toBe('fallback');
  });

  it('maps an IndiaMART-like payload with transforms, constants and custom fields', () => {
    const mapping = PayloadMappingSchema.parse({
      fields: [
        { from: 'RESPONSE.SENDER_NAME', to: 'name', transform: 'trim' },
        { from: 'RESPONSE.SENDER_MOBILE', to: 'phone', transform: 'phone_in' },
        { from: 'RESPONSE.SENDER_EMAIL', to: 'email', transform: 'lower' },
        { from: 'RESPONSE.SENDER_COMPANY', to: 'companyName' },
        { from: 'RESPONSE.UNIQUE_QUERY_ID', to: 'sourceRef' },
        { from: 'RESPONSE.items[0].qty', to: 'valueInr', transform: 'number' },
        { from: 'RESPONSE.SENDER_NAME', to: 'custom.first_name', transform: 'first_name' },
      ],
      defaults: { source: 'indiamart', tags: 'indiamart, push', city: 'Mumbai' },
    });
    const { lead, errors } = applyPayloadMapping(indiamartLike, mapping);
    expect(errors).toEqual([]);
    expect(lead).toMatchObject({
      name: 'Ramesh Kumar Patil',
      phone: '+919822012345',
      email: 'ramesh@patil.example',
      companyName: 'Patil Steel',
      sourceRef: '2836491048',
      valueInr: 125000,
      source: 'indiamart',
      tags: ['indiamart', 'push'],
      city: 'Mumbai',
      customFields: { first_name: 'Ramesh' },
    });
  });

  it('reports bad values per field and a missing name', () => {
    const mapping = PayloadMappingSchema.parse({ fields: [{ from: 'p', to: 'phone' }, { from: 'e', to: 'email' }], defaults: { source: 'nope' } });
    const { lead, errors } = applyPayloadMapping({ p: '12', e: 'not-mail' }, mapping);
    expect(lead.phone).toBeUndefined();
    expect(errors.map((e) => e.path).sort()).toEqual(['defaults.source', 'fields.0', 'fields.1', 'name']);
  });

  it('lists leaf paths for the path picker', () => {
    const paths = listPayloadPaths(indiamartLike).map((p) => p.path);
    expect(paths).toContain('RESPONSE.SENDER_MOBILE');
    expect(paths).toContain('RESPONSE.items[0].qty');
  });
});

describe('hub schemas', () => {
  it('inbound sources: reserved keys refused, start_workflow needs a workflow, defaults applied', () => {
    expect(InboundEndpointCreateSchema.safeParse({ name: 'x', sourceKey: 'whatsapp' }).success).toBe(false);
    expect(InboundEndpointCreateSchema.safeParse({ name: 'x', sourceKey: 'site', action: 'start_workflow' }).success).toBe(false);
    const ok = InboundEndpointCreateSchema.parse({ name: 'Site', sourceKey: 'website-form' });
    expect(ok).toMatchObject({ action: 'create_lead', verification: 'hmac', matchBy: ['phone', 'email'], createIfMissing: true });
  });

  it('outbound URLs: https, or http only on localhost', () => {
    const base = { name: 'x', events: ['lead.created'] };
    expect(OutboundEndpointCreateSchema.safeParse({ ...base, url: 'https://erp.example.in/hook' }).success).toBe(true);
    expect(OutboundEndpointCreateSchema.safeParse({ ...base, url: 'http://127.0.0.1:9000/hook' }).success).toBe(true);
    expect(OutboundEndpointCreateSchema.safeParse({ ...base, url: 'http://localhost.evil.example/hook' }).success).toBe(false);
    expect(OutboundEndpointCreateSchema.safeParse({ ...base, url: 'http://erp.example.in/hook' }).success).toBe(false);
  });

  it('prefault bodies parse an empty request', () => {
    expect(WebhookRotateSecretSchema.parse(undefined)).toEqual({ graceHours: 24 });
  });

  it('every provider has a catalog entry and config schemas whose keys match the catalog fields', () => {
    for (const p of INTEGRATION_PROVIDERS) {
      const entry = INTEGRATION_CATALOG[p];
      expect(entry.provider).toBe(p);
      const schemas = INTEGRATION_CONFIG_SCHEMAS[p];
      const keys = new Set([...Object.keys(schemas.config.shape), ...Object.keys(schemas.secrets.shape)]);
      for (const f of entry.fields) expect(keys.has(f.key), `${p}.${f.key}`).toBe(true);
      for (const f of entry.fields.filter((x) => x.secret)) expect(Object.keys(schemas.secrets.shape)).toContain(f.key);
    }
  });

  it('scope options mark what the creator holds', () => {
    const opts = apiKeyScopeOptions(['leads.read']);
    expect(opts.find((o) => o.scope === 'leads.read')?.allowed).toBe(true);
    expect(opts.find((o) => o.scope === 'leads.create')?.allowed).toBe(false);
  });
});

describe('webhook signing helpers', () => {
  it('signs t.rawBody and parses multiple v1 values', () => {
    expect(signaturePayload(1700000000, '{"a":1}')).toBe('1700000000.{"a":1}');
    const parsed = parseSignatureHeader(`t=1700000000,v1=${'a'.repeat(64)},v1=${'b'.repeat(64)}`);
    expect(parsed?.signatures).toHaveLength(2);
  });

  it('retry schedule: 7 attempts at 0, 1 min, 6 min, 36 min, 2.6 h, 8.6 h, 32.6 h', () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(7);
    expect(webhookAttemptOffsetsSec()).toEqual([0, 60, 360, 2160, 9360, 30960, 117360]);
  });

  it('outbound events are domain events', () => {
    for (const e of OUTBOUND_WEBHOOK_EVENTS) expect(EVENT_NAMES).toContain(e);
  });
});

describe('route contract (change #19 wave C: hub)', () => {
  const routes = Object.entries(API_ROUTES) as Array<[string, RouteDef]>;
  const hub = ['integrationCatalog', 'integrationGet', 'integrationSync', 'integrationRotateToken', 'integrationOAuthStart', 'integrationOAuthCallback', 'indiamartPush', 'whatsappWorkspaceVerify', 'whatsappWorkspaceWebhook', 'webhookEndpointGet', 'webhookCapture', 'webhookTestSend', 'apiKeyScopes', 'apiKeyUpdate', 'publicOpenApi'];

  it('new routes are backend-core phase 19 with known permissions', () => {
    for (const id of hub) {
      const r = (API_ROUTES as Record<string, RouteDef>)[id];
      expect(r, id).toBeDefined();
      expect(r!.owner, id).toBe('backend-core');
      expect(r!.phase, id).toBe(19);
      if (r!.permission) expect(PERMISSIONS as readonly string[], id).toContain(r!.permission);
    }
  });

  it('the literal hook paths do not collide with the generic inbound route', () => {
    const keys = routes.map(([, r]) => `${r.method} ${r.absolute ? r.path : `/api/v1${r.path}`}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('read routes need .read, managers can read, viewers cannot', () => {
    expect(API_ROUTES.integrationList.permission).toBe('integrations.read');
    expect(API_ROUTES.webhookDeliveryList.permission).toBe('webhooks.read');
    for (const p of CHANGE_19C_PERMISSIONS) {
      expect(DEFAULT_ROLE_PERMISSIONS.manager).toContain(p);
      expect(DEFAULT_ROLE_PERMISSIONS.company_admin).toContain(p);
      expect(DEFAULT_ROLE_PERMISSIONS.viewer).not.toContain(p);
    }
  });

  it('new error codes have statuses', () => {
    expect(ERROR_HTTP_STATUS.WEBHOOK_URL_BLOCKED).toBe(422);
    expect(ERROR_HTTP_STATUS.IDEMPOTENCY_CONFLICT).toBe(409);
    expect(ERROR_HTTP_STATUS.API_KEY_SCOPE_NOT_ALLOWED).toBe(403);
  });

  it('public OpenAPI has the API key routes only, with apiKey security', () => {
    const doc = buildPublicOpenApiDocument({ serverUrl: 'http://localhost:4001' });
    const paths = Object.keys(doc.paths ?? {});
    expect(paths).toContain('/api/v1/leads');
    expect(paths).toContain('/api/hooks/{workspaceId}/{sourceKey}');
    expect(paths).not.toContain('/api/v1/integrations');
    expect(paths.some((p) => p.startsWith('/api/super'))).toBe(false);
    const leadCreate = (doc.paths?.['/api/v1/leads'] as Record<string, { security?: unknown[] }>).post;
    expect(leadCreate?.security).toEqual([{ apiKey: [] }]);
    expect(Object.keys(doc.components?.securitySchemes ?? {})).not.toContain('bearerPlatform');
  });
});
