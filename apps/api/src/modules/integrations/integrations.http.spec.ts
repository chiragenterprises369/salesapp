import { IntegrationSchema, IntegrationSyncResultSchema } from '@vistar/shared';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * Integration hub over HTTP (change #19 wave C, D-069) with the dev mock adapters: catalog and list, IndiaMART mock
 * pull (dedupe by UNIQUE_QUERY_ID, 5-minute rule) and push (key), WhatsApp mock (verify challenge, signed message into
 * the Inbox with a lead, status update), SMTP mock test, telephony mock callback, Google not configured, permissions
 * (manager read-only without endpoints, employee 403) and tenant isolation.
 * Written by HUB-API, run by Kiro Crew: `pnpm --filter @vistar/api test integrations.http`.
 */
let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let b: Awaited<ReturnType<Harness['workspace']>>;
let manager: { userId: string; token: string };
let employee: { userId: string; token: string };
const APP_SECRET = 'mock-app-secret-0123456789';

beforeAll(async () => {
  h = await createHarness('hub');
  a = await h.workspace('a');
  b = await h.workspace('b');
  await h.prisma.workspace.update({ where: { id: a.workspaceId }, data: { plan: 'growth' } });
  manager = await h.member(a.workspaceId, 'manager', 'hub-mgr');
  employee = await h.member(a.workspaceId, 'employee', 'hub-emp');
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('catalog and list', () => {
  it('lists five providers; never-connected ones are not_connected with id null', async () => {
    const res = await h.api().get('/api/v1/integrations').set(bearer(a.token));
    expect(res.status).toBe(200);
    const items = IntegrationSchema.array().parse(res.body.items);
    expect(items.map((i) => i.provider).sort()).toEqual(['google_calendar', 'indiamart', 'smtp', 'telephony', 'whatsapp_cloud']);
    expect(items.every((i) => i.status === 'not_connected' && i.id === null)).toBe(true);
    const catalog = await h.api().get('/api/v1/integrations/catalog').set(bearer(a.token));
    expect(catalog.status).toBe(200);
    const indiamart = catalog.body.items.find((p: { provider: string }) => p.provider === 'indiamart');
    expect(indiamart.fields.find((f: { key: string }) => f.key === 'crmKey')).toMatchObject({ secret: true, required: true });
    expect(indiamart.setupSteps.length).toBeGreaterThan(2);
  });

  it('employees get 403; managers read without endpoints and cannot connect', async () => {
    expect((await h.api().get('/api/v1/integrations').set(bearer(employee.token))).status).toBe(403);
    expect((await h.api().get('/api/v1/integrations').set(bearer(manager.token))).status).toBe(200);
    expect((await h.api().post('/api/v1/integrations/smtp/connect').set(bearer(manager.token)).send({ mode: 'mock', config: {} })).status).toBe(403);
  });

  it('unknown providers are 400; Google live without OAuth client is 422 INTEGRATION_NOT_CONFIGURED (when not configured)', async () => {
    expect((await h.api().get('/api/v1/integrations/salesforce').set(bearer(a.token))).status).toBe(400);
    const g = await h.api().post('/api/v1/integrations/google_calendar/oauth/start').set(bearer(a.token));
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      expect(g.status).toBe(422);
      expect(g.body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
    } else {
      expect(g.status).toBe(200);
      expect(g.body.authUrl).toContain('accounts.google.com');
    }
  });

  it('live connect validates per provider and reports the missing secret fields', async () => {
    const res = await h.api().post('/api/v1/integrations/indiamart/connect').set(bearer(a.token)).send({ mode: 'live', config: { pullIntervalMin: 2 }, secrets: {} });
    expect(res.status).toBe(400);
    const paths = (res.body.error.details as Array<{ path: string }>).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['config.pullIntervalMin', 'secrets.crmKey']));
  });
});

describe('IndiaMART (mock)', () => {
  it('connect pulls the last 24 h, creates routed IndiaMART leads; a second pull within 5 minutes is 429', async () => {
    const res = await h.api().post('/api/v1/integrations/indiamart/connect').set(bearer(a.token)).send({ mode: 'mock', config: { pullEnabled: true, pullIntervalMin: 10, pushEnabled: true, tags: ['im'] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const integ = IntegrationSchema.parse(res.body);
    expect(integ).toMatchObject({ status: 'connected', mode: 'mock' });
    expect(integ.endpoints?.pushUrl).toContain(`/api/hooks/${a.workspaceId}/indiamart?key=`);
    const leads = await h.prisma.lead.findMany({ where: { workspaceId: a.workspaceId, source: 'indiamart' } });
    expect(leads.length).toBeGreaterThan(0);
    expect(new Set(leads.map((l) => l.sourceRef)).size).toBe(leads.length);
    expect(leads.every((l) => l.tags.includes('indiamart') && l.tags.includes('im'))).toBe(true);
    const again = await h.api().post('/api/v1/integrations/indiamart/sync').set(bearer(a.token));
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('RATE_LIMITED');
  });

  it('a later pull over an overlapping window skips what was imported', async () => {
    const row = await h.prisma.integration.findFirstOrThrow({ where: { workspaceId: a.workspaceId, provider: 'indiamart' } });
    const state = row.syncState as { lastPullAt: string; lastWindowEnd: string };
    // pretend the last pull was 6 minutes ago (same window end): the overlap re-reads the same mock enquiries
    await h.prisma.integration.update({ where: { id: row.id }, data: { syncState: { ...state, lastPullAt: new Date(Date.now() - 6 * 60_000).toISOString() } } });
    const before = await h.prisma.lead.count({ where: { workspaceId: a.workspaceId, source: 'indiamart' } });
    const res = await h.api().post('/api/v1/integrations/indiamart/sync').set(bearer(a.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = IntegrationSyncResultSchema.parse(res.body);
    // the overlapping 5 minutes come back and are skipped; at most a brand-new mock enquiry (new 10-minute bucket) is added
    expect(out.created + out.skipped).toBe(out.fetched);
    expect(out.created).toBeLessThanOrEqual(1);
    const leads = await h.prisma.lead.findMany({ where: { workspaceId: a.workspaceId, source: 'indiamart' }, select: { sourceRef: true } });
    expect(leads.length).toBe(before + out.created);
    expect(new Set(leads.map((l) => l.sourceRef)).size).toBe(leads.length);
  });

  it('push: wrong key 401, right key creates a lead, the same UNIQUE_QUERY_ID again is a duplicate', async () => {
    const list = await h.api().get('/api/v1/integrations/indiamart').set(bearer(a.token));
    const pushUrl = new URL(list.body.endpoints.pushUrl as string);
    const record = { CODE: 200, STATUS: 'SUCCESS', RESPONSE: { UNIQUE_QUERY_ID: `PUSH${h.sfx}`, QUERY_TYPE: 'W', SENDER_NAME: 'Push Buyer', SENDER_MOBILE: '+91-9876501234', SENDER_CITY: 'Surat', QUERY_PRODUCT_NAME: 'Sheets', QUERY_MESSAGE: 'Need 50' } };
    expect((await h.api().post(`${pushUrl.pathname}?key=wrong`).send(record)).status).toBe(401);
    const ok = await h.api().post(`${pushUrl.pathname}${pushUrl.search}`).send(record);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, duplicate: false });
    const dup = await h.api().post(`${pushUrl.pathname}${pushUrl.search}`).send(record);
    expect(dup.body).toMatchObject({ duplicate: true, leadId: ok.body.leadId });
    const lead = await h.prisma.lead.findUniqueOrThrow({ where: { id: ok.body.leadId as string } });
    expect(lead).toMatchObject({ name: 'Push Buyer', phone: '+919876501234', source: 'indiamart', sourceRef: `PUSH${h.sfx}` });
  });

  it('manager list has no endpoints; the push key never appears for read-only users', async () => {
    const res = await h.api().get('/api/v1/integrations/indiamart').set(bearer(manager.token));
    expect(res.body.endpoints).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/im_[A-Za-z0-9_-]{10,}/);
  });
});

describe('WhatsApp Cloud API (mock)', () => {
  let verifyToken = '';
  it('connect in mock mode returns the callback URL and verify token; the challenge is echoed only with the right token', async () => {
    const res = await h.api().post('/api/v1/integrations/whatsapp_cloud/connect').set(bearer(a.token)).send({ mode: 'mock', config: { phoneNumberId: '1098765432101' }, secrets: { appSecret: APP_SECRET } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    verifyToken = res.body.endpoints.verifyToken as string;
    const path = new URL(res.body.endpoints.webhookUrl as string).pathname;
    expect(path).toBe(`/api/hooks/${a.workspaceId}/whatsapp`);
    const ok = await h.api().get(path).query({ 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': '12345' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('12345');
    expect((await h.api().get(path).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' })).status).toBe(403);
  });

  it('a signed message lands in the Inbox with a WhatsApp lead; a bad signature is 401; statuses move messages forward', async () => {
    const path = `/api/hooks/${a.workspaceId}/whatsapp`;
    const from = `9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const wamid = `wamid.TEST${h.sfx}`;
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1098765432101' }, contacts: [{ wa_id: from, profile: { name: 'Meera WA' } }], messages: [{ from, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Price for 100 units?' } }] } }] }] });
    const sig = `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
    expect((await h.api().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=00').send(body)).status).toBe(401);
    const res = await h.api().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const msg = await h.prisma.message.findFirstOrThrow({ where: { workspaceId: a.workspaceId, providerMessageId: wamid } });
    expect(msg).toMatchObject({ direction: 'inbound', body: 'Price for 100 units?' });
    const conv = await h.prisma.conversation.findUniqueOrThrow({ where: { id: msg.conversationId } });
    expect(conv.lastInboundAt).not.toBeNull();
    expect(conv.unreadCount).toBe(1);
    const lead = await h.prisma.lead.findFirstOrThrow({ where: { workspaceId: a.workspaceId, phone: `+${from}` } });
    expect(lead.source).toBe('whatsapp');
    // Meta retries: the same wamid is stored once
    await h.api().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body);
    expect(await h.prisma.message.count({ where: { workspaceId: a.workspaceId, providerMessageId: wamid } })).toBe(1);
    // a status for an outbound message (simulated provider id)
    const out = await h.prisma.message.create({ data: { workspaceId: a.workspaceId, conversationId: conv.id, direction: 'outbound', type: 'text', body: 'Rs 450 each', status: 'sent', providerMessageId: `wamid.OUT${h.sfx}` } });
    const st = JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1098765432101' }, statuses: [{ id: `wamid.OUT${h.sfx}`, status: 'read', timestamp: '1' }] } }] }] });
    await h.api().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', `sha256=${createHmac('sha256', APP_SECRET).update(st).digest('hex')}`).send(st);
    expect((await h.prisma.message.findUniqueOrThrow({ where: { id: out.id } })).status).toBe('read');
  });
});

describe('SMTP, telephony (mock), disconnect', () => {
  it('SMTP mock test builds the e-mail without sending', async () => {
    const res = await h.api().post('/api/v1/integrations/smtp/connect').set(bearer(a.token)).send({ mode: 'mock', config: { fromEmail: 'sales@example.in' }, test: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const test = await h.api().post('/api/v1/integrations/smtp/test').set(bearer(a.token)).send({ to: 'me@example.in' });
    expect(test.status).toBe(200);
    expect(test.body).toMatchObject({ ok: true });
    expect(test.body.integration.status).toBe('connected');
  });

  it('SMTP live to a private host is refused by the SSRF guard (status error)', async () => {
    const res = await h.api().post('/api/v1/integrations/smtp/connect').set(bearer(a.token)).send({ mode: 'live', config: { host: '10.1.2.3', port: 587, fromEmail: 'sales@example.in' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'error' });
    expect(res.body.lastError).toMatch(/private|reserved/i);
  });

  it('telephony mock callback creates a call matched to a lead', async () => {
    const res = await h.api().post('/api/v1/integrations/telephony/connect').set(bearer(a.token)).send({ mode: 'mock', config: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cb = new URL(res.body.endpoints.callbackUrl as string);
    expect(cb.pathname).toBe(`/api/hooks/${a.workspaceId}/telephony/mock`);
    const lead = await h.api().post('/api/v1/leads').set(bearer(a.token)).send({ name: 'Call me', phone: '+919812345670' });
    const call = await h.api().post(`${cb.pathname}${cb.search}`).send({ callId: `c-${h.sfx}`, direction: 'outbound', status: 'completed', from: '+918047000000', to: '+919812345670', durationSec: 95 });
    expect(call.status, JSON.stringify(call.body)).toBe(200);
    const row = await h.prisma.call.findFirstOrThrow({ where: { workspaceId: a.workspaceId, providerCallId: `c-${h.sfx}` } });
    expect(row).toMatchObject({ provider: 'mock', status: 'completed', durationSec: 95, leadId: lead.body.id });
    expect((await h.api().post(`${cb.pathname}?token=wrong`).send({ callId: 'x', from: '1', to: '2' })).status).toBe(401);
  });

  it('feature flags: telephony needs the plan feature (workspace B is on free)', async () => {
    const res = await h.api().post('/api/v1/integrations/telephony/connect').set(bearer(b.token)).send({ mode: 'mock', config: {} });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });

  it('disconnect wipes secrets and tokens; the old push URL stops working', async () => {
    const before = await h.api().get('/api/v1/integrations/indiamart').set(bearer(a.token));
    const pushUrl = new URL(before.body.endpoints.pushUrl as string);
    const res = await h.api().delete('/api/v1/integrations/indiamart').set(bearer(a.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'not_connected', hasSecrets: false });
    expect((await h.api().post(`${pushUrl.pathname}${pushUrl.search}`).send({ RESPONSE: { UNIQUE_QUERY_ID: 'X' } })).status).toBe(404);
    const audit = await h.prisma.auditLog.findMany({ where: { workspaceId: a.workspaceId, entityType: 'integration' }, select: { action: true, diff: true } });
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(['integration.connect', 'integration.disconnect']));
    expect(JSON.stringify(audit)).not.toContain(APP_SECRET);
  });

  it('tenant isolation: B sees its own (empty) hub, never A\'s', async () => {
    const res = await h.api().get('/api/v1/integrations').set(bearer(b.token));
    expect(res.body.items.every((i: { status: string }) => i.status === 'not_connected')).toBe(true);
    expect((await h.api().post(`/api/hooks/${b.workspaceId}/indiamart?key=x`).send({ RESPONSE: { UNIQUE_QUERY_ID: 'X' } })).status).toBe(404);
  });
});
