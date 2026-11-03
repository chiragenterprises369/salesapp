import { InboundWebhookResponseSchema, pageOf, WebhookDeliverySchema, WebhookEndpointSchema } from '@vistar/shared';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * Inbound webhooks over HTTP (change #19 wave C): HMAC "t.rawBody" signature with 300 s tolerance, token sources,
 * Idempotency-Key (duplicate 200, other body 409), routed lead creation, update_lead by phone, sample capture,
 * mapping preview, replay (verified only) and tenant isolation.
 * Written by HUB-API, run by Kiro Crew: `pnpm --filter @vistar/api test inbound-webhooks.http`.
 */
let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let b: Awaited<ReturnType<Harness['workspace']>>;
let rep: { userId: string; token: string };
let source: { id: string; inboundUrl: string; secret: string };

const sign = (secret: string, body: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const pathOf = (url: string) => new URL(url).pathname;
const phone = () => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

beforeAll(async () => {
  h = await createHarness('hookin');
  a = await h.workspace('a');
  b = await h.workspace('b');
  rep = await h.member(a.workspaceId, 'employee', 'hook-rep');
  await h.api().post('/api/v1/routing-rules').set(bearer(a.token)).send({ name: 'Webhook leads', conditions: { sources: ['webhook'] }, userIds: [rep.userId], respectWorkingHours: false, respectAvailability: false });
  const res = await h
    .api()
    .post('/api/v1/webhooks/endpoints/inbound')
    .set(bearer(a.token))
    .send({
      name: 'Website form',
      sourceKey: 'website-form',
      mapping: {
        fields: [
          { from: 'data.full_name || data.first_name + data.last_name', to: 'name', transform: 'trim' },
          { from: 'data.mobile', to: 'phone', transform: 'phone_in' },
          { from: 'data.email', to: 'email', transform: 'lower' },
          { from: 'data.city', to: 'city' },
          { from: 'data.ref', to: 'sourceRef' },
        ],
        defaults: { tags: 'website' },
      },
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const ep = WebhookEndpointSchema.extend({ secret: WebhookEndpointSchema.shape.name }).parse(res.body);
  source = { id: ep.id, inboundUrl: ep.inboundUrl!, secret: res.body.secret as string };
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('inbound source setup', () => {
  it('returns the secret once and a unique URL; reserved keys and duplicates are refused', async () => {
    expect(source.secret).toMatch(/^whsec_/);
    expect(pathOf(source.inboundUrl)).toBe(`/api/hooks/${a.workspaceId}/website-form`);
    const list = await h.api().get('/api/v1/webhooks/endpoints').set(bearer(a.token));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(source.secret);
    expect((await h.api().post('/api/v1/webhooks/endpoints/inbound').set(bearer(a.token)).send({ name: 'x', sourceKey: 'whatsapp' })).status).toBe(400);
    expect((await h.api().post('/api/v1/webhooks/endpoints/inbound').set(bearer(a.token)).send({ name: 'x', sourceKey: 'website-form' })).status).toBe(409);
  });

  it('employees cannot manage webhooks; managers can read', async () => {
    expect((await h.api().get('/api/v1/webhooks/endpoints').set(bearer(rep.token))).status).toBe(403);
    const mgr = await h.member(a.workspaceId, 'manager', 'hook-mgr');
    expect((await h.api().get('/api/v1/webhooks/endpoints').set(bearer(mgr.token))).status).toBe(200);
    expect((await h.api().post('/api/v1/webhooks/endpoints/inbound').set(bearer(mgr.token)).send({ name: 'x', sourceKey: 'mgr-src' })).status).toBe(403);
  });
});

describe('signed requests', () => {
  it('a valid signature creates a routed lead (202) with the mapped fields', async () => {
    const mobile = phone();
    const body = JSON.stringify({ data: { first_name: 'Asha', last_name: 'Rao', mobile: mobile.slice(3), email: 'Asha@Example.IN', city: 'Pune' } });
    const res = await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('X-Vistar-Signature', sign(source.secret, body)).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const out = InboundWebhookResponseSchema.parse(res.body);
    expect(out.leadId).toBeTruthy();
    const lead = await h.prisma.lead.findUniqueOrThrow({ where: { id: out.leadId! } });
    expect(lead).toMatchObject({ name: 'Asha Rao', phone: mobile, email: 'asha@example.in', city: 'Pune', source: 'webhook', ownerId: rep.userId });
    expect(lead.tags).toContain('website');
  });

  it('a wrong signature is 401 WEBHOOK_SIGNATURE_INVALID and is logged as unverified', async () => {
    const body = JSON.stringify({ data: { full_name: 'Bad Sig', mobile: '9876500000' } });
    const res = await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('X-Vistar-Signature', sign('whsec_wrong', body)).send(body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    const log = await h.api().get('/api/v1/webhooks/deliveries').query({ endpointId: source.id, status: 'failed' }).set(bearer(a.token));
    const page = pageOf(WebhookDeliverySchema).parse(log.body);
    const rejected = page.items.find((d) => d.signatureValid === false);
    expect(rejected?.canReplay).toBe(false);
    const replay = await h.api().post(`/api/v1/webhooks/deliveries/${rejected!.id}/replay`).set(bearer(a.token));
    expect(replay.status).toBe(422);
    expect(replay.body.error.code).toBe('WEBHOOK_REPLAY_NOT_ALLOWED');
  });

  it('a missing signature is 401 and a timestamp older than 300 s is 401 WEBHOOK_TIMESTAMP_EXPIRED', async () => {
    const body = JSON.stringify({ data: { full_name: 'Old', mobile: '9876500001' } });
    expect((await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').send(body)).status).toBe(401);
    const old = sign(source.secret, body, Math.floor(Date.now() / 1000) - 301);
    const res = await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('X-Vistar-Signature', old).send(body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('WEBHOOK_TIMESTAMP_EXPIRED');
  });

  it('Idempotency-Key: the retry is a 200 duplicate (one lead), another body with the same key is 409', async () => {
    const key = randomUUID();
    const body = JSON.stringify({ data: { full_name: 'Idem Patel', mobile: phone().slice(3) } });
    const send = (raw: string) => h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('Idempotency-Key', key).set('X-Vistar-Signature', sign(source.secret, raw)).send(raw);
    const first = await send(body);
    expect(first.status).toBe(202);
    const again = await send(body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, leadId: first.body.leadId });
    expect(await h.prisma.lead.count({ where: { workspaceId: a.workspaceId, name: 'Idem Patel' } })).toBe(1);
    const other = await send(JSON.stringify({ data: { full_name: 'Someone else', mobile: '9876500002' } }));
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('a repeated sourceRef answers duplicate without a second lead', async () => {
    const raw = JSON.stringify({ data: { full_name: 'Ref Lead', mobile: phone().slice(3), ref: `ref-${h.sfx}` } });
    const first = await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('X-Vistar-Signature', sign(source.secret, raw)).send(raw);
    const second = await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('X-Vistar-Signature', sign(source.secret, raw)).send(raw);
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true, leadId: first.body.leadId });
  });

  it('the previous secret works during the rotation grace only', async () => {
    const res = await h.api().post(`/api/v1/webhooks/endpoints/${source.id}/rotate-secret`).set(bearer(a.token)).send({ graceHours: 1 });
    expect(res.status).toBe(200);
    const fresh = res.body.secret as string;
    const raw = JSON.stringify({ data: { full_name: 'Grace Old', mobile: phone().slice(3) } });
    expect((await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('X-Vistar-Signature', sign(source.secret, raw)).send(raw)).status).toBe(202);
    const raw2 = JSON.stringify({ data: { full_name: 'Grace New', mobile: phone().slice(3) } });
    expect((await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('X-Vistar-Signature', sign(fresh, raw2)).send(raw2)).status).toBe(202);
    await h.api().post(`/api/v1/webhooks/endpoints/${source.id}/rotate-secret`).set(bearer(a.token)).send({ graceHours: 0 }).then((r) => (source.secret = r.body.secret as string));
    const raw3 = JSON.stringify({ data: { full_name: 'Grace Gone', mobile: phone().slice(3) } });
    expect((await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('X-Vistar-Signature', sign(fresh, raw3)).send(raw3)).status).toBe(401);
  });
});

describe('token sources, update_lead, capture, preview, replay', () => {
  it('token verification (header or query) and update_lead by phone', async () => {
    const res = await h.api().post('/api/v1/webhooks/endpoints/inbound').set(bearer(a.token)).send({ name: 'Sheet sync', sourceKey: 'sheet-sync', verification: 'token', action: 'update_lead', matchBy: ['phone'], createIfMissing: false, mapping: { fields: [{ from: 'mobile', to: 'phone', transform: 'phone_in' }, { from: 'note', to: 'requirement' }, { from: 'tag', to: 'tags' }], defaults: {} } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const url = pathOf(res.body.inboundUrl as string);
    const token = res.body.secret as string;
    const mobile = phone();
    const lead = await h.api().post('/api/v1/leads').set(bearer(a.token)).send({ name: 'Existing Lead', phone: mobile });
    expect(lead.status).toBe(201);
    const upd = await h.api().post(url).set('X-Vistar-Token', token).send({ mobile: mobile.slice(3), note: 'Asked for a callback', tag: 'sheet' });
    expect(upd.status, JSON.stringify(upd.body)).toBe(202);
    expect(upd.body.leadId).toBe(lead.body.id);
    const after = await h.prisma.lead.findUniqueOrThrow({ where: { id: lead.body.id as string } });
    expect(after.requirement).toBe('Asked for a callback');
    expect(after.tags).toContain('sheet');
    const miss = await h.api().post(`${url}?token=${encodeURIComponent(token)}`).send({ mobile: '9000000001', note: 'x' });
    expect(miss.status).toBe(202);
    expect(miss.body.leadId).toBeNull();
    expect((await h.api().post(url).set('X-Vistar-Token', 'nope').send({ mobile: '9000000001' })).status).toBe(401);
  });

  it('capture mode stores the next verified request as the sample and creates no lead', async () => {
    const armed = await h.api().post(`/api/v1/webhooks/endpoints/${source.id}/capture`).set(bearer(a.token)).send({ enabled: true, minutes: 5 });
    expect(armed.status).toBe(200);
    expect(armed.body.captureUntil).toBeTruthy();
    const raw = JSON.stringify({ data: { full_name: 'Sample Only', mobile: '9811111111', extra: { utm: 'fb' } } });
    const res = await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('X-Vistar-Signature', sign(source.secret, raw)).send(raw);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ captured: true, leadId: null });
    const ep = await h.api().get(`/api/v1/webhooks/endpoints/${source.id}`).set(bearer(a.token));
    expect(ep.body.samplePayload).toEqual(JSON.parse(raw));
    expect(ep.body.captureUntil).toBeNull();
    expect(await h.prisma.lead.count({ where: { workspaceId: a.workspaceId, name: 'Sample Only' } })).toBe(0);
  });

  it('mapping preview returns the lead, errors and the path list', async () => {
    const res = await h
      .api()
      .post('/api/v1/webhooks/mapping/preview')
      .set(bearer(a.token))
      .send({ samplePayload: { data: { full_name: ' Ravi ', mobile: '98765 43210', email: 'bad' } }, mapping: { fields: [{ from: 'data.full_name', to: 'name', transform: 'trim' }, { from: 'data.mobile', to: 'phone', transform: 'phone_in' }, { from: 'data.email', to: 'email' }], defaults: {} } });
    expect(res.status).toBe(200);
    expect(res.body.lead).toMatchObject({ name: 'Ravi', phone: '+919876543210' });
    expect(res.body.errors).toEqual([{ path: 'fields.2', message: expect.any(String) }]);
    expect(res.body.paths.map((p: { path: string }) => p.path)).toContain('data.mobile');
  });

  it('replay of a verified delivery runs it again as a new delivery', async () => {
    const raw = JSON.stringify({ data: { full_name: 'Replay Me', mobile: phone().slice(3) } });
    const first = await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('X-Vistar-Signature', sign(source.secret, raw)).send(raw);
    expect(first.status).toBe(202);
    const replay = await h.api().post(`/api/v1/webhooks/deliveries/${first.body.deliveryId}/replay`).set(bearer(a.token));
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    const d = WebhookDeliverySchema.parse(replay.body);
    expect(d.replayOfId).toBe(first.body.deliveryId);
    expect(d.status).toBe('success');
  });

  it('a paused source answers 410', async () => {
    await h.api().patch(`/api/v1/webhooks/endpoints/${source.id}`).set(bearer(a.token)).send({ isActive: false });
    const raw = JSON.stringify({ data: { full_name: 'Paused' } });
    const res = await h.api().post(pathOf(source.inboundUrl)).set('Content-Type', 'application/json').set('X-Vistar-Signature', sign(source.secret, raw)).send(raw);
    expect(res.status).toBe(410);
    await h.api().patch(`/api/v1/webhooks/endpoints/${source.id}`).set(bearer(a.token)).send({ isActive: true });
  });
});

describe('tenant isolation', () => {
  it('another workspace cannot see, change or receive through A\'s source', async () => {
    expect((await h.api().get(`/api/v1/webhooks/endpoints/${source.id}`).set(bearer(b.token))).status).toBe(404);
    expect((await h.api().patch(`/api/v1/webhooks/endpoints/${source.id}`).set(bearer(b.token)).send({ name: 'x' })).status).toBe(404);
    const list = await h.api().get('/api/v1/webhooks/deliveries').set(bearer(b.token));
    expect(list.body.items).toEqual([]);
    const raw = JSON.stringify({ data: { full_name: 'Cross' } });
    const cross = await h.api().post(`/api/hooks/${b.workspaceId}/website-form`).set('Content-Type', 'application/json').set('X-Vistar-Signature', sign(source.secret, raw)).send(raw);
    expect(cross.status).toBe(404);
    expect((await h.api().post('/api/hooks/not-a-uuid/website-form').send({})).status).toBe(400);
  });
});
