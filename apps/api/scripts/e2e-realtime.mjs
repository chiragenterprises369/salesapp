#!/usr/bin/env node
/**
 * REALTIME end-to-end check with two sockets against a running API on a DEMO database (change #19 done check).
 *
 *   cd apps/api && node scripts/e2e-realtime.mjs http://localhost:4002
 *
 * Env: DATABASE_URL (else read from the repo .env), E2E_ADMIN (anil@shakti.example), E2E_EMPLOYEE
 * (rohit@shakti.example), E2E_PASSWORD (vistar-demo-123). The script makes the employee field staff with
 * all-day hours and turns field_tracking on for the company, then restores both at the end.
 *
 * Steps (each prints PASS / FAIL, exit code 1 on any failure):
 *   1 heartbeat -> available          4 zone signal (QR marker) -> employee.zone_changed
 *   2 call started -> on_call < 1 s     5 50 s silence -> offline (source timeout)
 *   3 ended + device log -> available,  6 check-in inside hours 201; location outside hours rejected
 *     one call row on the lead
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { io } from 'socket.io-client';

const BASE = (process.argv[2] ?? 'http://localhost:4002').replace(/\/+$/, '');
const API = `${BASE}/api/v1`;
const ADMIN = process.env.E2E_ADMIN ?? 'anil@shakti.example';
const EMPLOYEE = process.env.E2E_EMPLOYEE ?? 'rohit@shakti.example';
const PASSWORD = process.env.E2E_PASSWORD ?? 'vistar-demo-123';
const CONSENT_VERSION = '2026-11-v1';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const ALL_DAY = Object.fromEntries(DAYS.map((d) => [d, [{ start: '00:00', end: '23:59' }]]));
const CLOSED = Object.fromEntries(DAYS.map((d) => [d, []]));
const run = Date.now().toString(36);

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const line = readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not set and not in .env');
  return line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.info(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, token, body) {
  const res = await fetch(`${API}${url}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function login(email) {
  const r = await http('POST', '/auth/login', null, { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  const me = await http('GET', '/auth/me', r.body.accessToken);
  if (me.status !== 200) throw new Error(`me ${email}: ${me.status}`);
  return { accessToken: r.body.accessToken, user: me.body.user, workspace: me.body.workspace };
}

function connect(token, client) {
  return new Promise((resolve, reject) => {
    const s = io(`${BASE}/realtime`, { auth: { token, client, fresh: true }, transports: ['websocket'], reconnection: false, forceNew: true });
    s.events = [];
    s.onAny((name, event) => s.events.push({ name, event, t: Date.now() }));
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

async function waitEvent(socket, pred, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const hit = socket.events.find(pred);
    if (hit) return hit;
    await sleep(20);
  }
  return null;
}

const db = new pg.Client({ connectionString: databaseUrl() });
let restore = async () => {};

async function main() {
  await db.connect();
  const admin = await login(ADMIN);
  const emp = await login(EMPLOYEE);
  const empId = emp.user.id;
  const wsId = emp.workspace.id;

  // Fixture (restored at the end).
  const before = (await db.query('select "isFieldStaff", "workingHours" from "User" where id = $1', [empId])).rows[0];
  const flagBefore = (await db.query('select enabled from "FeatureFlagOverride" where "workspaceId" = $1 and flag = $2', [wsId, 'field_tracking'])).rows[0] ?? null;
  const setHours = (h) => db.query('update "User" set "workingHours" = $2 where id = $1', [empId, JSON.stringify(h)]);
  await db.query('update "User" set "isFieldStaff" = true where id = $1', [empId]);
  await setHours(ALL_DAY);
  await db.query(
    `insert into "FeatureFlagOverride" (id, "workspaceId", flag, enabled, "createdAt", "updatedAt") values (gen_random_uuid(), $1, 'field_tracking', true, now(), now())
     on conflict ("workspaceId", flag) do update set enabled = true, "updatedAt" = now()`,
    [wsId],
  );
  let markerId = null;
  restore = async () => {
    await http('POST', '/me/attendance/check-out', emp.accessToken, { lat: 19.07, lng: 72.87 }).catch(() => null);
    if (markerId) await http('DELETE', `/team-floor/markers/${markerId}`, admin.accessToken).catch(() => null);
    await db.query('update "User" set "isFieldStaff" = $2, "workingHours" = $3 where id = $1', [empId, before.isFieldStaff, before.workingHours === null ? null : JSON.stringify(before.workingHours)]);
    if (flagBefore) await db.query('update "FeatureFlagOverride" set enabled = $2 where "workspaceId" = $1 and flag = $3', [wsId, flagBefore.enabled, 'field_tracking']);
    else await db.query('delete from "FeatureFlagOverride" where "workspaceId" = $1 and flag = $2', [wsId, 'field_tracking']);
  };

  const phone = `+9198${String(Date.now()).slice(-8)}`;
  const lead = await http('POST', '/leads', admin.accessToken, { name: `E2E realtime ${run}`, phone, ownerId: empId });
  if (lead.status !== 201) throw new Error(`lead create: ${lead.status} ${JSON.stringify(lead.body)}`);
  const layout = await http('GET', '/team-floor/layout', admin.accessToken);
  const zoneId = layout.body?.floor?.seatMap?.zones?.[0]?.id ?? 'e2e-zone';
  const marker = await http('POST', '/team-floor/markers', admin.accessToken, { kind: 'qr', zoneId, label: `E2E door ${run}` });
  if (marker.status !== 201) throw new Error(`marker create: ${marker.status} ${JSON.stringify(marker.body)}`);
  markerId = marker.body.id;

  const watcher = await connect(admin.accessToken, 'web');
  const watcherBeat = setInterval(() => watcher.emit('presence.heartbeat', { activity: 'active', client: 'web' }), 15_000);
  const forEmp = (type, extra = () => true) => (r) => r.name === type && r.event.payload.userId === empId && extra(r.event.payload);

  // 1 heartbeat -> available
  const phoneSock = await connect(emp.accessToken, 'android');
  phoneSock.emit('presence.heartbeat', { activity: 'active', client: 'android', screen: 'home' });
  let lastBeat = Date.now();
  const avail = await waitEvent(watcher, forEmp('employee.status_changed', (p) => p.presence === 'available'), 3_000);
  const me1 = await http('GET', '/me/presence', emp.accessToken);
  check('1 heartbeat -> available', me1.body?.status === 'available' && (avail !== null || me1.body?.status === 'available'), `event ${avail ? 'received' : 'not needed (already available)'}`);

  // 2 call started -> on_call within 1 s
  const clientCallId = `e2e-${run}-call`;
  const t0 = Date.now();
  const started = await http('POST', '/me/calls/active', emp.accessToken, { event: 'started', clientCallId, direction: 'outbound', phone, startedAt: new Date(t0).toISOString() });
  const onCall = await waitEvent(watcher, forEmp('employee.status_changed', (p) => p.presence === 'on_call'), 1_000);
  check('2 call started -> on_call within 1 s', started.status === 200 && onCall !== null && onCall.t - t0 < 1_000, onCall ? `${onCall.t - t0} ms` : `status ${started.status}`);

  // 3 ended + device log -> available, one call row on the lead
  await sleep(1_500);
  phoneSock.emit('presence.heartbeat', { activity: 'active', client: 'android', screen: 'call' });
  lastBeat = Date.now();
  const endAt = Date.now();
  const ended = await http('POST', '/me/calls/active', emp.accessToken, { event: 'ended', clientCallId, endedAt: new Date(endAt).toISOString() });
  const log = await http('POST', '/me/calls/device-log', emp.accessToken, {
    entries: [{ deviceCallId: `e2e-${run}-log`, clientCallId, direction: 'outbound', phone, startedAt: new Date(t0).toISOString(), endedAt: new Date(endAt).toISOString(), durationSec: Math.round((endAt - t0) / 1000), result: 'connected' }],
  });
  const back = await waitEvent(watcher, forEmp('employee.status_changed', (p) => p.previousPresence === 'on_call'), 3_000);
  const calls = await http('GET', `/calls?leadId=${lead.body.id}`, admin.accessToken);
  const timeline = await http('GET', `/leads/${lead.body.id}/timeline`, admin.accessToken);
  const callRows = calls.body?.items ?? [];
  const timelineCalls = JSON.stringify(timeline.body ?? '').split('"type":"call"').length - 1;
  check(
    '3 call ended + device log -> available, one call row on the lead',
    ended.status === 200 && log.status === 200 && back?.event.payload.presence === 'available' && callRows.length === 1 && callRows[0].result === 'connected' && timelineCalls >= 1,
    `back=${back?.event.payload.presence} calls=${callRows.length} result=${callRows[0]?.result} timeline=${timelineCalls}`,
  );

  // 4 zone signal -> zone_changed
  const zone = await http('POST', '/me/presence/zone', emp.accessToken, { source: 'qr', at: new Date().toISOString(), markerToken: marker.body.token });
  const zc = await waitEvent(watcher, forEmp('employee.zone_changed', (p) => p.zoneId === zoneId), 3_000);
  check('4 zone signal -> employee.zone_changed', zone.status === 200 && zc !== null && zone.body?.location?.zoneId === zoneId, `zone=${zone.body?.location?.zoneId} source=${zc?.event.payload.source}`);

  // 5 50 s silence -> offline
  phoneSock.emit('presence.heartbeat', { activity: 'active', client: 'android', screen: 'team_floor' });
  lastBeat = Date.now();
  const offline = await waitEvent(watcher, (r) => r.t > lastBeat && forEmp('employee.status_changed', (p) => p.presence === 'offline')(r), 56_000);
  const silent = offline ? offline.t - lastBeat : null;
  check('5 50 s silence -> offline', offline !== null && offline.event.payload.source === 'timeout' && silent >= 45_000 && silent <= 55_000, `after ${silent} ms, source ${offline?.event.payload.source}`);

  // 6 check-in inside hours accepted, location outside hours rejected
  await http('PUT', '/me/tracking-consent', emp.accessToken, { accepted: true, version: CONSENT_VERSION });
  const fix = { lat: 19.076, lng: 72.8777, accuracy: 10 };
  const inHours = await http('POST', '/me/attendance/check-in', emp.accessToken, fix);
  await setHours(CLOSED);
  const loc = await http('POST', '/me/location', emp.accessToken, { points: [{ ...fix, at: new Date().toISOString() }] });
  const rejected = loc.status === 422 ? loc.body?.error?.code === 'OUTSIDE_WORKING_HOURS' : loc.body?.rejected?.[0]?.reason === 'outside_working_hours';
  check('6 check-in in hours accepted, location outside hours rejected', inHours.status === 201 && rejected, `check-in ${inHours.status}, location ${loc.status} ${loc.body?.error?.code ?? loc.body?.rejected?.[0]?.reason ?? ''}`);

  clearInterval(watcherBeat);
  watcher.disconnect();
  phoneSock.disconnect();
}

try {
  await main();
} catch (err) {
  check('script', false, err instanceof Error ? err.message : String(err));
} finally {
  await restore().catch((err) => console.error(`restore failed: ${err.message}`));
  await db.end().catch(() => undefined);
}
const failed = results.filter((r) => !r.ok).length;
console.info(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
