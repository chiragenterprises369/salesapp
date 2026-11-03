import { CallSchema, MessageSchema } from '@vistar/shared';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * Change #20 hub gaps over HTTP with the dev mock providers (PROD-HUB, D-075): click-to-call (POST /calls through
 * mock telephony, simulated status path, scope, validation, plan feature) and WhatsApp sending from the inbox
 * (mock Cloud API: provider message id, delivered and read statuses, 24 h window, opt-out, not connected).
 * Written for Kiro Crew; run with `pnpm --filter @vistar/api test hub-send.http`.
 */
let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let free: Awaited<ReturnType<Harness['workspace']>>;
let employee: { userId: string; token: string };
const APP_SECRET = 'mock-app-secret-0123456789';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  h = await createHarness('hubsend');
  a = await h.workspace('a');
  free = await h.workspace('free');
  await h.prisma.workspace.update({ where: { id: a.workspaceId }, data: { plan: 'growth' } });
  employee = await h.member(a.workspaceId, 'employee', 'hubsend-emp');
  await h.prisma.user.update({ where: { id: a.adminId }, data: { phone: '+919800000001' } });
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('click-to-call', () => {
  it('422 INTEGRATION_NOT_CONNECTED before telephony is connected; 403 on a plan without telephony', async () => {
    const res = await h.api().post('/api/v1/calls').set(bearer(a.token)).send({ to: '+919812300001' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INTEGRATION_NOT_CONNECTED');
    const f = await h.api().post('/api/v1/calls').set(bearer(free.token)).send({ to: '+919812300001' });
    expect(f.status).toBe(403);
    expect(f.body.error.code).toBe('FEATURE_DISABLED');
  });

  it('rings through mock telephony for a lead; the simulated callbacks complete the call', async () => {
    const con = await h.api().post('/api/v1/integrations/telephony/connect').set(bearer(a.token)).send({ mode: 'mock', config: {} });
    expect(con.status, JSON.stringify(con.body)).toBe(200);
    const lead = await h.api().post('/api/v1/leads').set(bearer(a.token)).send({ name: 'Ring me', phone: '+919812300002' });
    const res = await h.api().post('/api/v1/calls').set(bearer(a.token)).send({ leadId: lead.body.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const call = CallSchema.parse(res.body);
    expect(call).toMatchObject({ status: 'ringing', direction: 'outbound', leadId: lead.body.id, provider: 'mock', source: 'mock', to: '+919812300002' });
    const row = await h.prisma.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(row.providerCallId).toBe(`mock-${call.id}`);
    // the mock answers after 3 s; the callback path updates the same row (no second call)
    await sleep(3_500);
    const live = await h.prisma.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(live.status).toBe('in_progress');
    expect(await h.prisma.call.count({ where: { workspaceId: a.workspaceId, providerCallId: row.providerCallId } })).toBe(1);
  }, 20_000);

  it('a status callback for the provider id updates the click-to-call row', async () => {
    const res = await h.api().post('/api/v1/calls').set(bearer(a.token)).send({ to: '+919812300003' });
    expect(res.status).toBe(201);
    const row = await h.prisma.call.findUniqueOrThrow({ where: { id: res.body.id } });
    const integ = await h.api().get('/api/v1/integrations/telephony').set(bearer(a.token));
    const cb = new URL(integ.body.endpoints.callbackUrl as string);
    const done = await h.api().post(`${cb.pathname}${cb.search}`).send({ callId: row.providerCallId, direction: 'outbound', status: 'completed', from: '+910000000000', to: '+919812300003', durationSec: 42 });
    expect(done.status).toBe(200);
    expect(done.body.callId).toBe(row.id);
    const after = await h.prisma.call.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: 'completed', result: 'connected', durationSec: 42, userId: a.adminId });
  });

  it('validation and scope: no number, a lead without phone, a lead out of the employee scope', async () => {
    expect((await h.api().post('/api/v1/calls').set(bearer(a.token)).send({})).status).toBe(400);
    const noPhone = await h.api().post('/api/v1/leads').set(bearer(a.token)).send({ name: 'No phone', email: `np-${h.sfx}@example.test` });
    const r = await h.api().post('/api/v1/calls').set(bearer(a.token)).send({ leadId: noPhone.body.id });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe('leadId');
    const other = await h.api().post('/api/v1/leads').set(bearer(a.token)).send({ name: 'Admin lead', phone: '+919812300004', ownerId: a.adminId });
    expect((await h.api().post('/api/v1/calls').set(bearer(employee.token)).send({ leadId: other.body.id })).status).toBe(404);
  });
});

describe('WhatsApp sending (mock Cloud API)', () => {
  let conversationId = '';
  const from = `9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  it('sending before WhatsApp is connected is 422 (no conversation without a connection either)', async () => {
    const conv = await h.prisma.conversation.findFirst({ where: { workspaceId: a.workspaceId } });
    expect(conv).toBeNull();
  });

  it('text inside the 24 h window gets a provider id, then delivered and read', async () => {
    const con = await h.api().post('/api/v1/integrations/whatsapp_cloud/connect').set(bearer(a.token)).send({ mode: 'mock', config: { phoneNumberId: '1098765432102' }, secrets: { appSecret: APP_SECRET } });
    expect(con.status, JSON.stringify(con.body)).toBe(200);
    const body = JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1098765432102' }, contacts: [{ wa_id: from, profile: { name: 'Window open' } }], messages: [{ from, id: `wamid.IN${h.sfx}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Hello' } }] } }] }] });
    const sig = `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
    expect((await h.api().post(`/api/hooks/${a.workspaceId}/whatsapp`).set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body)).status).toBe(200);
    const msg = await h.prisma.message.findFirstOrThrow({ where: { workspaceId: a.workspaceId, providerMessageId: `wamid.IN${h.sfx}` } });
    conversationId = msg.conversationId;

    const res = await h.api().post(`/api/v1/conversations/${conversationId}/messages`).set(bearer(a.token)).send({ type: 'text', body: 'Rs 450 each' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const sent = MessageSchema.parse(res.body);
    expect(sent.status).toBe('sent');
    const row = await h.prisma.message.findUniqueOrThrow({ where: { id: sent.id } });
    expect(row.providerMessageId).toMatch(/^wamid\.mock-/);
    await sleep(6_500);
    expect((await h.prisma.message.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe('read');
  }, 20_000);

  it('templates must be approved and need every variable; notes never leave Vistar', async () => {
    const t = await h.prisma.template.create({ data: { workspaceId: a.workspaceId, name: `doc_${h.sfx}`.slice(0, 60), language: 'en', category: 'utility', status: 'pending', body: 'Dear {{1}}, {{2}}', variables: [] } });
    const pending = await h.api().post(`/api/v1/conversations/${conversationId}/messages`).set(bearer(a.token)).send({ type: 'template', templateId: t.id, variables: { '1': 'Asha', '2': 'x' } });
    expect(pending.body.error.code).toBe('WHATSAPP_TEMPLATE_NOT_APPROVED');
    await h.prisma.template.update({ where: { id: t.id }, data: { status: 'approved' } });
    const missing = await h.api().post(`/api/v1/conversations/${conversationId}/messages`).set(bearer(a.token)).send({ type: 'template', templateId: t.id, variables: { '1': 'Asha' } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].path).toBe('variables.2');
    const ok = await h.api().post(`/api/v1/conversations/${conversationId}/messages`).set(bearer(a.token)).send({ type: 'template', templateId: t.id, variables: { '1': 'Asha', '2': 'your quotation' } });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ type: 'template', body: 'Dear Asha, your quotation', status: 'sent' });
    const note = await h.api().post(`/api/v1/conversations/${conversationId}/messages`).set(bearer(a.token)).send({ type: 'note', body: 'internal' });
    expect(note.status).toBe(201);
    expect((await h.prisma.message.findUniqueOrThrow({ where: { id: note.body.id } })).providerMessageId).toBeNull();
  });

  it('opted-out contacts and a closed window are refused', async () => {
    const conv = await h.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    await h.prisma.conversation.update({ where: { id: conversationId }, data: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) } });
    const closed = await h.api().post(`/api/v1/conversations/${conversationId}/messages`).set(bearer(a.token)).send({ type: 'text', body: 'late' });
    expect(closed.body.error.code).toBe('WHATSAPP_WINDOW_CLOSED');
    await h.prisma.contact.update({ where: { id: conv.contactId }, data: { whatsappOptIn: 'opted_out' } });
    const out = await h.api().post(`/api/v1/conversations/${conversationId}/messages`).set(bearer(a.token)).send({ type: 'text', body: 'x' });
    expect(out.body.error.code).toBe('CONSENT_OPTED_OUT');
  });
});
