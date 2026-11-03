import { describe, expect, it } from 'vitest';
import { flattenLeaves, formatPath, getAtPath, parsePath, parseSample, suggestMapping } from '../json-paths';
import { curlFor, deref, exampleFor, groupByTag, listOperations, permissionFrom, searchOperations, shellQuote, tagLabel, typeLabel, type OpenApiDocument } from '../openapi';
import { scopesForHubEvent, sourceKeyFrom, upcomingRetryDelays, urlProblem } from '../rules';
import { inboundCurl, inboundNode } from '../snippets';

const INDIAMART = {
  CODE: 200,
  RESPONSE: [
    { UNIQUE_QUERY_ID: '2873465', SENDER_NAME: ' Asha Patil ', SENDER_MOBILE: '+91-9876543210', SENDER_EMAIL: 'ASHA@EXAMPLE.IN', SENDER_CITY: 'Pune', QUERY_PRODUCT_NAME: 'Steel racks', QUERY_MESSAGE: 'Need 40 racks' },
  ],
  meta: { 'user.id': 7 },
};

describe('json paths', () => {
  it('formats and parses dot paths with indexes and quoted keys', () => {
    expect(formatPath(['RESPONSE', 0, 'SENDER_MOBILE'])).toBe('RESPONSE.0.SENDER_MOBILE');
    expect(formatPath(['meta', 'user.id'])).toBe('meta["user.id"]');
    expect(parsePath('RESPONSE.0.SENDER_MOBILE')).toEqual(['RESPONSE', 0, 'SENDER_MOBILE']);
    expect(parsePath('meta["user.id"]')).toEqual(['meta', 'user.id']);
    expect(parsePath('a[2].b')).toEqual(['a', 2, 'b']);
    expect(parsePath('a["x')).toBeNull();
  });

  it('reads values at a path and reports missing steps as undefined', () => {
    expect(getAtPath(INDIAMART, 'RESPONSE.0.SENDER_CITY')).toBe('Pune');
    expect(getAtPath(INDIAMART, 'meta["user.id"]')).toBe(7);
    expect(getAtPath(INDIAMART, 'RESPONSE.3.SENDER_CITY')).toBeUndefined();
    expect(getAtPath(INDIAMART, 'CODE.x')).toBeUndefined();
  });

  it('lists leaves and guesses a first mapping by key names', () => {
    const leaves = flattenLeaves(INDIAMART);
    expect(leaves.map((l) => l.path)).toContain('RESPONSE.0.SENDER_MOBILE');
    const rows = suggestMapping(leaves, ['none', 'trim', 'lower', 'phone_in', 'number']);
    expect(rows).toEqual(
      expect.arrayContaining([
        { from: 'RESPONSE.0.SENDER_MOBILE', to: 'phone', transform: 'phone_in' },
        { from: 'RESPONSE.0.SENDER_EMAIL', to: 'email', transform: 'lower' },
        { from: 'RESPONSE.0.SENDER_NAME', to: 'name', transform: 'trim' },
        { from: 'RESPONSE.0.UNIQUE_QUERY_ID', to: 'sourceRef', transform: 'none' },
      ]),
    );
    // A transform the API does not offer falls back to none.
    expect(suggestMapping(leaves, ['none']).every((r) => r.transform === 'none')).toBe(true);
  });

  it('explains invalid JSON with a line number', () => {
    const r = parseSample('{\n  "a": 1,\n  oops\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not valid JSON/);
    expect(parseSample('  ').ok).toBe(false);
    expect(parseSample('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });
});

const DOC: OpenApiDocument = {
  openapi: '3.1.0',
  info: { title: 'Vistar API', version: '1.0.0' },
  servers: [{ url: 'https://api.vistar.example' }],
  components: {
    schemas: {
      Lead: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 120 }, phone: { type: ['string', 'null'] } } },
    },
  },
  paths: {
    '/api/v1/leads': {
      get: { operationId: 'leadList', summary: 'List leads', tags: ['leads'], description: 'Requires permission `leads.read`. Owner: backend-core. Phase 2.', security: [{ bearerJwt: [] }, { apiKey: [] }], parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Lead' } } } } } } } } },
      post: { operationId: 'leadCreate', summary: 'Create a lead', tags: ['leads'], security: [{ apiKey: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'phone'], properties: { name: { type: 'string' }, phone: { type: 'string' }, source: { type: 'string', enum: ['api', 'website'] } } } } } }, responses: { '201': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Lead' } } } } } },
    },
    '/api/v1/api-keys/{id}': { delete: { operationId: 'apiKeyRevoke', summary: "Revoke a key's access", tags: ['api-keys'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } } },
  },
};

describe('openapi reference', () => {
  const ops = listOperations(DOC);

  it('lists operations with permission, security and cleaned description', () => {
    expect(ops.map((o) => o.id)).toEqual(['leadList', 'leadCreate', 'apiKeyRevoke']);
    const list = ops[0]!;
    expect(list.permission).toBe('leads.read');
    expect(list.description).toBe('');
    expect(list.security).toEqual(['bearerJwt', 'apiKey']);
    expect(permissionFrom('nothing')).toBeNull();
  });

  it('groups by tag with readable labels and searches every word', () => {
    expect(groupByTag(DOC, ops).map((g) => g.label)).toEqual(['API keys', 'Leads']);
    expect(tagLabel('team-floor')).toBe('Team floor');
    expect(searchOperations(ops, 'leads create').map((o) => o.id)).toEqual(['leadCreate']);
    expect(searchOperations(ops, 'LEADS.READ').map((o) => o.id)).toEqual(['leadList']);
    expect(searchOperations(ops, '')).toHaveLength(3);
  });

  it('resolves refs and labels types', () => {
    expect(deref(DOC, { $ref: '#/components/schemas/Lead' }).required).toEqual(['id', 'name']);
    expect(typeLabel(DOC, { type: ['string', 'null'] })).toBe('string or null');
    expect(typeLabel(DOC, { type: 'array', items: { $ref: '#/components/schemas/Lead' } })).toBe('array of Lead');
    expect(typeLabel(DOC, { type: 'string', format: 'uuid' })).toBe('string (uuid)');
  });

  it('builds example bodies and a curl with the key from the environment', () => {
    expect(exampleFor(DOC, ops[1]!.requestBody!.schema)).toEqual({ name: 'string', phone: 'string', source: 'api' });
    const curl = curlFor(DOC, ops[1]!, 'https://api.vistar.example');
    expect(curl).toContain(`curl -X POST 'https://api.vistar.example/api/v1/leads'`);
    expect(curl).toContain('Authorization: Bearer $VISTAR_API_KEY');
    expect(curl).toContain(`"phone": "string"`);
    expect(curlFor(DOC, ops[2]!, 'https://api.vistar.example/')).toContain(`'https://api.vistar.example/api/v1/api-keys/<id>'`);
  });

  it('quotes shell values safely', () => {
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });
});

describe('signing snippets', () => {
  it('never contain a secret and sign t.body', () => {
    const url = 'https://api.vistar.example/api/hooks/ws1/website';
    const curl = inboundCurl(url, { name: "O'Brien" });
    expect(curl).toContain('$VISTAR_WEBHOOK_SECRET');
    expect(curl).toContain(`printf '%s.%s' "$T" "$BODY"`);
    expect(curl).toContain(`BODY='{"name":"O'\\''Brien"}'`);
    const node = inboundNode(url);
    expect(node).toContain('process.env.VISTAR_WEBHOOK_SECRET');
    expect(node).toContain("createHmac('sha256', secret)");
  });
});

describe('hub rules', () => {
  it('maps hub events to cache scopes', () => {
    expect(scopesForHubEvent('webhook.delivery_updated')).toEqual(['webhooks']);
    expect(scopesForHubEvent('webhook.endpoint_updated')).toEqual(['webhooks']);
    expect(scopesForHubEvent('integration.updated')).toEqual(['integrations']);
    expect(scopesForHubEvent('lead.created')).toEqual(['webhooks']);
    expect(scopesForHubEvent('deal.moved')).toEqual([]);
  });

  it('accepts https and localhost http only', () => {
    expect(urlProblem('https://erp.example.in/hooks')).toBeNull();
    expect(urlProblem('http://localhost:8080/hook')).toBeNull();
    expect(urlProblem('http://127.0.0.1:9000/x')).toBeNull();
    expect(urlProblem('http://10.0.0.5/hook')).toMatch(/https/);
    expect(urlProblem('ftp://example.in')).toMatch(/https/);
    expect(urlProblem('example.in/hook')).toMatch(/full URL/);
    expect(urlProblem('  ')).toMatch(/Enter the URL/);
  });

  it('makes URL keys from names', () => {
    expect(sourceKeyFrom('Website form (Pune)')).toBe('website-form-pune');
    expect(sourceKeyFrom('  Facebook Lead Ads!! ')).toBe('facebook-lead-ads');
    expect(sourceKeyFrom('x'.repeat(60))).toHaveLength(40);
  });

  it('lists the retries still to come', () => {
    const delays = [60, 300, 1800, 7200, 21_600, 86_400];
    expect(upcomingRetryDelays(delays, 1, 7, true)).toEqual([60, 300, 1800, 7200, 21_600, 86_400]);
    expect(upcomingRetryDelays(delays, 3, 7, true)).toEqual([1800, 7200, 21_600, 86_400]);
    expect(upcomingRetryDelays(delays, 7, 7, true)).toEqual([]);
    expect(upcomingRetryDelays(delays, 2, 7, false)).toEqual([]);
  });
});
