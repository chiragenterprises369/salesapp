#!/usr/bin/env node
/**
 * HUB end-to-end check against a running API on a DEMO database (change #19 wave C; HUB-API, run by Kiro Crew).
 *
 *   cd apps/api && node scripts/e2e-hub.mjs http://localhost:4001
 *
 * Needs: `pnpm --filter @vistar/api seed:demo` data (Shakti is on growth), the API started with HUB_BACKGROUND_JOBS=on
 * (default) and Redis, and 127.0.0.1 on the outbound dev allowlist (default outside production).
 * Env: E2E_ADMIN (anil@shakti.example), E2E_EMPLOYEE (rohit@shakti.example), E2E_PASSWORD (vistar-demo-123).
 * It changes demo data of Shakti: adds leads, a routing rule (removed at the end), reconnects the mock IndiaMART and
 * WhatsApp integrations with known secrets.
 *
 * Steps (PASS / FAIL each, exit code 1 on any failure):
 *   1 signed inbound request -> routed lead (202)      6 outbound: first retry after about 60 s, then replay succeeds
 *   2 bad signature -> 401 WEBHOOK_SIGNATURE_INVALID     7 API key scopes: read ok, create 403, revoked 401
 *   3 timestamp 301 s old -> 401 WEBHOOK_TIMESTAMP_EXPIRED 8 WhatsApp verify challenge + signed message into the Inbox
 *   4 Idempotency-Key retry -> 200 duplicate, other body 409  9 IndiaMART mock pull + 429 within 5 min + push
 *   5 outbound: signed delivery to a local receiver      10 GET /api/v1/openapi.json
 */
import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';

const BASE = (process.argv[2] ?? 'http://localhost:4001').replace(/\/+$/, '');
const API = `${BASE}/api/v1`;
const ADMIN = process.env.E2E_ADMIN ?? 'anil@shakti.example';
const EMPLOYEE = process.env.E2E_EMPLOYEE ?? 'rohit@shakti.example';
const PASSWORD = process.env.E2E_PASSWORD ?? 'vistar-demo-123';
const run = Date.now().toString(36);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.info(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, url, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}
const sign = (secret, raw, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const local = (url) => `${BASE}${new URL(url).pathname}${new URL(url).search}`;
const phone = () => `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function login(email) {
  const res = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function main() {
  const admin = await login(ADMIN);
  const token = admin.accessToken;
  const wid = admin.me.workspace.id;
  const emp = await login(EMPLOYEE);
  const repId = emp.me.user.id;
  const cleanup = [];

  // routing: webhook leads go to the employee
  const rule = await call('POST', '/routing-rules', { token, body: { name: `Kiro hub ${run}`, conditions: { sources: ['webhook'] }, userIds: [repId], respectWorkingHours: false, respectAvailability: false } });
  if (rule.status === 201) cleanup.push(() => call('DELETE', `/routing-rules/${rule.body.id}`, { token }));
  // put the rule first so it wins over the demo rules
  const rules = await call('GET', '/routing-rules', { token });
  if (rules.status === 200 && rule.status === 201) {
    const ids = rules.body.items.map((r) => r.id).filter((id) => id !== rule.body.id);
    await call('PUT', '/routing-rules/order', { token, body: { ids: [rule.body.id, ...ids] } });
  }

  // 1-4 inbound
  const src = await call('POST', '/webhooks/endpoints/inbound', { token, body: { name: `Kiro source ${run}`, sourceKey: `kiro-${run}`, mapping: { fields: [{ from: 'name', to: 'name', transform: 'trim' }, { from: 'mobile', to: 'phone', transform: 'phone_in' }, { from: 'city', to: 'city' }], defaults: {} } } });
  if (src.status !== 201) throw new Error(`inbound source: ${src.status} ${JSON.stringify(src.body)}`);
  cleanup.push(() => call('DELETE', `/webhooks/endpoints/${src.body.id}`, { token }));
  const hookUrl = local(src.body.inboundUrl);
  const secret = src.body.secret;
  const raw1 = JSON.stringify({ name: `Kiro Hook ${run}`, mobile: phone(), city: 'Pune' });
  const r1 = await call('POST', hookUrl, { raw: raw1, headers: { 'x-vistar-signature': sign(secret, raw1) } });
  const lead1 = r1.body?.leadId ? await call('GET', `/leads/${r1.body.leadId}`, { token }) : null;
  check('1 signed inbound request creates a routed lead (202)', r1.status === 202 && lead1?.body?.owner?.id === repId && lead1?.body?.source === 'webhook', `status ${r1.status}, owner ${lead1?.body?.owner?.name ?? 'none'}`);
  const r2 = await call('POST', hookUrl, { raw: raw1, headers: { 'x-vistar-signature': sign('whsec_wrong', raw1) } });
  check('2 bad signature -> 401 WEBHOOK_SIGNATURE_INVALID', r2.status === 401 && r2.body?.error?.code === 'WEBHOOK_SIGNATURE_INVALID', `status ${r2.status}`);
  const r3 = await call('POST', hookUrl, { raw: raw1, headers: { 'x-vistar-signature': sign(secret, raw1, Math.floor(Date.now() / 1000) - 301) } });
  check('3 timestamp older than 300 s -> 401 WEBHOOK_TIMESTAMP_EXPIRED', r3.status === 401 && r3.body?.error?.code === 'WEBHOOK_TIMESTAMP_EXPIRED', `status ${r3.status}`);
  const key = randomUUID();
  const raw4 = JSON.stringify({ name: `Kiro Idem ${run}`, mobile: phone() });
  const a4 = await call('POST', hookUrl, { raw: raw4, headers: { 'x-vistar-signature': sign(secret, raw4), 'idempotency-key': key } });
  const b4 = await call('POST', hookUrl, { raw: raw4, headers: { 'x-vistar-signature': sign(secret, raw4), 'idempotency-key': key } });
  const raw4b = JSON.stringify({ name: 'Other body', mobile: phone() });
  const c4 = await call('POST', hookUrl, { raw: raw4b, headers: { 'x-vistar-signature': sign(secret, raw4b), 'idempotency-key': key } });
  check('4 Idempotency-Key: retry 200 duplicate with the same lead, other body 409', a4.status === 202 && b4.status === 200 && b4.body?.duplicate === true && b4.body?.leadId === a4.body?.leadId && c4.status === 409, `${a4.status}/${b4.status}/${c4.status}`);

  // 5-6 outbound to a local receiver: 500 twice, then 200
  const got = [];
  let failuresLeft = 2;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ at: Date.now(), headers: req.headers, body });
      const status = failuresLeft-- > 0 ? 500 : 200;
      res.writeHead(status, { 'content-type': 'application/json' }).end(status === 200 ? '{"ok":true}' : '{"error":"down"}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const receiver = `http://127.0.0.1:${server.address().port}/hook`;
  try {
    const sub = await call('POST', '/webhooks/endpoints/outbound', { token, body: { name: `Kiro receiver ${run}`, url: receiver, events: ['lead.created'] } });
    if (sub.status !== 201) throw new Error(`outbound: ${sub.status} ${JSON.stringify(sub.body)}`);
    cleanup.push(() => call('DELETE', `/webhooks/endpoints/${sub.body.id}`, { token }));
    await call('POST', '/leads', { token, body: { name: `Kiro Outbound ${run}`, phone: `+91${phone()}` } });
    for (let i = 0; i < 150 && got.length < 1; i++) await sleep(100);
    const first = got[0];
    const sig = first?.headers['x-vistar-signature'] ?? '';
    const t = Number(/t=(\d+)/.exec(sig)?.[1]);
    const v1 = /v1=([0-9a-f]{64})/.exec(sig)?.[1];
    const expected = first ? createHmac('sha256', sub.body.secret).update(`${t}.${first.body}`).digest('hex') : '';
    check('5 outbound delivery is signed (t.rawBody HMAC) with the lead.created envelope', !!first && v1 === expected && JSON.parse(first.body).type === 'lead.created', first ? `delivery ${first.headers['x-vistar-delivery']}` : 'nothing received in 15 s');
    console.info('      waiting up to 90 s for the first retry (WEBHOOK_RETRY_DELAYS_SEC[0] = 60 s)...');
    for (let i = 0; i < 900 && got.length < 2; i++) await sleep(100);
    const gap = got.length >= 2 ? (got[1].at - got[0].at) / 1000 : null;
    const log = await call('GET', `/webhooks/deliveries?endpointId=${sub.body.id}&limit=5`, { token });
    const d = log.body?.items?.[0];
    const nextIn = d?.nextAttemptAt && d.attempts?.length ? (Date.parse(d.nextAttemptAt) - Date.parse(d.attempts.at(-1).at)) / 1000 : null;
    check('6a retry after about 60 s; the next one is scheduled 300 s later', gap !== null && gap >= 55 && gap <= 95 && d?.status === 'failed' && d?.attempt === 2 && nextIn !== null && Math.abs(nextIn - 300) <= 5, `gap ${gap?.toFixed(1)} s, attempt ${d?.attempt}, next in ${nextIn} s`);
    const replay = d ? await call('POST', `/webhooks/deliveries/${d.id}/replay`, { token }) : { status: 0 };
    check('6b replay -> new delivery, success, replayOfId set', replay.status === 201 && replay.body?.status === 'success' && replay.body?.replayOfId === d?.id, `status ${replay.status} ${replay.body?.status ?? ''}`);
  } finally {
    server.close();
  }

  // 7 API key scopes
  const k = await call('POST', '/api-keys', { token, body: { name: `Kiro read ${run}`, scopes: ['leads.read'] } });
  const apiKey = k.body?.key;
  const kr = apiKey ? await call('GET', '/leads?limit=1', { token: apiKey }) : { status: 0 };
  const kw = apiKey ? await call('POST', '/leads', { token: apiKey, body: { name: 'Via key' } }) : { status: 0 };
  if (k.status === 201) await call('DELETE', `/api-keys/${k.body.id}`, { token });
  const kx = apiKey ? await call('GET', '/leads?limit=1', { token: apiKey }) : { status: 0 };
  check('7 API key: leads.read 200, create 403 API_KEY_SCOPE_MISSING, revoked 401', k.status === 201 && kr.status === 200 && kw.status === 403 && kw.body?.error?.code === 'API_KEY_SCOPE_MISSING' && kx.status === 401, `${k.status}/${kr.status}/${kw.status}/${kx.status}`);

  // 8 WhatsApp (mock mode, known app secret)
  const APP_SECRET = `kiro-app-secret-${run}`;
  const wa = await call('POST', '/integrations/whatsapp_cloud/connect', { token, body: { mode: 'mock', config: { phoneNumberId: '1000000000001' }, secrets: { appSecret: APP_SECRET } } });
  const waPath = wa.body?.endpoints?.webhookUrl ? local(wa.body.endpoints.webhookUrl) : `${BASE}/api/hooks/${wid}/whatsapp`;
  const verify = await call('GET', `${waPath}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(wa.body?.endpoints?.verifyToken ?? '')}&hub.challenge=kiro123`);
  const verifyBad = await call('GET', `${waPath}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=kiro123`);
  const from = `91${phone()}`;
  const waRaw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1000000000001' }, contacts: [{ wa_id: from, profile: { name: `Kiro WA ${run}` } }], messages: [{ from, id: `wamid.KIRO${run}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Rate for 50 pcs?' } }] } }] }] });
  const msg = await call('POST', waPath, { raw: waRaw, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(waRaw).digest('hex')}` } });
  const conv = await call('GET', `/conversations?q=${from.slice(2)}`, { token });
  check('8 WhatsApp: verify echoes the challenge (wrong token 403); signed message lands in the Inbox', wa.status === 200 && verify.status === 200 && verify.body === 'kiro123' && verifyBad.status === 403 && msg.status === 200 && (conv.body?.items?.length ?? 0) >= 1, `connect ${wa.status}, verify ${verify.status}/${verifyBad.status}, message ${msg.status}, conversations ${conv.body?.items?.length ?? 0}`);

  // 9 IndiaMART (mock): fresh connect pulls the last 24 h
  await call('DELETE', '/integrations/indiamart', { token });
  const im = await call('POST', '/integrations/indiamart/connect', { token, body: { mode: 'mock', config: { pullEnabled: true, pullIntervalMin: 15, pushEnabled: true, tags: ['indiamart'] } } });
  const again = await call('POST', '/integrations/indiamart/sync', { token });
  const pushUrl = im.body?.endpoints?.pushUrl;
  const rec = { CODE: 200, STATUS: 'SUCCESS', RESPONSE: { UNIQUE_QUERY_ID: `KIRO${run}`, QUERY_TYPE: 'W', SENDER_NAME: `Kiro Buyer ${run}`, SENDER_MOBILE: `+91-${phone()}`, SENDER_CITY: 'Rajkot', QUERY_PRODUCT_NAME: 'Pumps', QUERY_MESSAGE: 'Need 10' } };
  const p1 = pushUrl ? await call('POST', local(pushUrl), { body: rec }) : { status: 0 };
  const p2 = pushUrl ? await call('POST', local(pushUrl), { body: rec }) : { status: 0 };
  check('9 IndiaMART mock: connect pulls (status connected, lastPulledCount >= 1), sync again 429, push creates once', im.status === 200 && im.body?.status === 'connected' && Number(im.body?.stats?.lastPulledCount ?? 0) >= 1 && again.status === 429 && p1.status === 200 && p2.body?.duplicate === true, `connect ${im.status} ${im.body?.status ?? ''} pulled ${im.body?.stats?.lastPulledCount ?? '-'}, sync ${again.status}, push ${p1.status}/${p2.body?.duplicate}`);

  // 10 public API reference
  const doc = await call('GET', '/openapi.json');
  check('10 GET /api/v1/openapi.json lists the API-key routes', doc.status === 200 && !!doc.body?.paths?.['/api/v1/leads'] && !doc.body?.paths?.['/api/v1/integrations'], `status ${doc.status}`);

  for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
}

main()
  .catch((err) => {
    console.error(err);
    results.push({ name: 'script', ok: false });
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    console.info(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  });
