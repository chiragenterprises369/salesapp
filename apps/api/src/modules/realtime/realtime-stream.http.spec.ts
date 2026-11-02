import 'reflect-metadata';
import { type INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CallSchema,
  DeviceCallLogResultSchema,
  eventPayloadSchemas,
  LocationBatchResultSchema,
  MyPresenceSchema,
  OfficeMarkerSchema,
  PresenceEventSchema,
  RecordingUrlSchema,
  REALTIME_NAMESPACE,
  TeamFloorSnapshotSchema,
  TRACKING_CONSENT_VERSION,
  type BusinessHours,
  type DomainEvent,
  type TeamFloorSnapshot,
} from '@vistar/shared';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module.js';
import { AppExceptionFilter } from '../../common/errors/exception.filter.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { hashPassword } from '../auth/password.js';
import { WorkspaceProvisioner } from '../auth/workspace-provisioner.js';
import { deleteTestWorkspace, newTestPrisma, testSuffix } from '../packs/testing.js';
import { PRESENCE_TIMEOUT_MS } from '../presence/engine/status-engine.js';
import { OfficeMarkersService } from '../presence/office-markers.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { StorageService } from '../storage/storage.service.js';

/**
 * REALTIME stream integration (full app on a random port, dev DB + Redis, TEMP workspaces test-rt-*):
 * presence over REST and sockets (fan-out by scope, tenant isolation, version ordering, screen), office
 * zones (markers CRUD, BLE / QR / manual signals, smoothing, zone_changed), SIM calls (live phone state,
 * device log idempotency, call row and timeline on the lead), recordings through StorageService,
 * attendance guards (field staff, flag, consent, working hours, per-point location gate), the offline
 * timeout, and "snapshot + events = fresh snapshot".
 */

const sfx = testSuffix();
const PASSWORD = `pw-${sfx}-Vistar!`;
const BEACON_UUID = 'f7826da6-4fa2-4e98-8024-bc5b71e0893e';
const ALL_DAY: BusinessHours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ start: '00:00', end: '23:59' }]])) as unknown as BusinessHours;
const CLOSED: BusinessHours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, []])) as unknown as BusinessHours;
const SEAT_MAP = {
  schemaVersion: 1,
  units: 'm',
  scale: 1,
  origin: [0, 0, 0],
  seats: [
    { id: 'd1', kind: 'desk', position: [0, 0, 0], rotation: 0, zoneId: 'sales' },
    { id: 'd2', kind: 'desk', position: [1, 0, 0], rotation: 0, zoneId: 'sales' },
    { id: 'd3', kind: 'desk', position: [2, 0, 0], rotation: 0, zoneId: 'sales' },
    { id: 'm1', kind: 'meeting', position: [5, 0, 5], rotation: 0, zoneId: 'meeting' },
  ],
  zones: [
    { id: 'sales', name: 'Sales floor', kind: 'work_area', polygon: [[0, 0], [4, 0], [4, 4]] },
    { id: 'meeting', name: 'Meeting room', kind: 'meeting_room', polygon: [[5, 5], [8, 5], [8, 8]] },
  ],
};

type Who = 'adminA' | 'mgr' | 'e1' | 'e2' | 'e3' | 'adminB' | 'eB';
const email = (w: Who) => `test-rt-${w.toLowerCase()}-${sfx}@example.test`;

let app: INestApplication;
let prisma: PrismaClient;
let base = '';
let wsA = '';
let wsB = '';
const ids = {} as Record<Who, string>;
const tokens = {} as Record<Who, string>;
const sockets: Partial<Record<Who, ClientSocket>> = {};
const received: Partial<Record<Who, Array<{ name: string; event: DomainEvent; t: number }>>> = {};
const beatTimers: NodeJS.Timeout[] = [];
let leadId = '';
let markerTokenA = '';
let markerTokenB = '';
const realNow = Date.now.bind(Date);
let clockOffset = 0;

const api = () => request(app.getHttpServer());
const auth = (w: Who) => ({ Authorization: `Bearer ${tokens[w]}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (ms = Date.now()) => new Date(ms).toISOString();

async function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 5_000, label = 'condition'): Promise<T> {
  const until = realNow() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (realNow() > until) throw new Error(`Timed out waiting for ${label}`);
    await sleep(20);
  }
}

/** Resolves when no event arrived on these sockets for `quietMs`. */
async function quiet(quietMs = 700): Promise<void> {
  const count = () => Object.values(received).reduce((s, l) => s + (l?.length ?? 0), 0);
  let last = count();
  let since = realNow();
  while (realNow() - since < quietMs) {
    await sleep(50);
    const c = count();
    if (c !== last) {
      last = c;
      since = realNow();
    }
  }
}

const eventsOf = (w: Who, name: string, pred: (e: DomainEvent) => boolean = () => true) => (received[w] ?? []).filter((r) => r.name === name && pred(r.event));
const statusEvents = (w: Who, userId: string) => eventsOf(w, 'employee.status_changed', (e) => (e.payload as { userId: string }).userId === userId);
const zoneEvents = (w: Who, userId: string) => eventsOf(w, 'employee.zone_changed', (e) => (e.payload as { userId: string }).userId === userId);

function connect(w: Who, extra: Record<string, unknown> = {}): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = io(`${base}${REALTIME_NAMESPACE}`, { auth: { token: tokens[w], client: 'web', fresh: true, ...extra }, transports: ['websocket'], reconnection: false, forceNew: true });
    received[w] = [];
    s.onAny((name: string, event: DomainEvent) => received[w]!.push({ name, event, t: realNow() }));
    s.once('connect', () => resolve(s));
    s.once('connect_error', (err) => reject(err));
  });
}

async function login(w: Who): Promise<string> {
  const res = await api().post('/api/v1/auth/login').send({ email: email(w), password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

const beat = (w: Who, body: Record<string, unknown> = {}) => api().post('/api/v1/me/presence/heartbeat').set(auth(w)).send({ activity: 'active', client: 'android', ...body });

beforeAll(async () => {
  prisma = newTestPrisma();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: ['error'] });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  const passwordHash = await hashPassword(PASSWORD);
  const provisioner = app.get(WorkspaceProvisioner);
  const a = await provisioner.provision({ ownerName: 'Admin A', email: email('adminA'), passwordHash, googleSub: null, workspaceName: `test-rt-a-${sfx}`, timezone: 'Asia/Kolkata' });
  const b = await provisioner.provision({ ownerName: 'Admin B', email: email('adminB'), passwordHash, googleSub: null, workspaceName: `test-rt-b-${sfx}`, timezone: 'Asia/Kolkata' });
  wsA = a.workspaceId;
  wsB = b.workspaceId;
  ids.adminA = a.userId;
  ids.adminB = b.userId;
  const role = async (workspaceId: string, kind: 'manager' | 'employee') => (await prisma.role.findFirstOrThrow({ where: { workspaceId, kind } })).id;
  const mk = async (w: Who, workspaceId: string, kind: 'manager' | 'employee', extra: { teamId?: string; isFieldStaff?: boolean; workingHours?: BusinessHours; deskIndex?: number } = {}) => {
    const u = await prisma.user.create({ data: { workspaceId, email: email(w), passwordHash, name: `RT ${w}`, roleId: await role(workspaceId, kind), ...extra } });
    ids[w] = u.id;
  };
  await mk('mgr', wsA, 'manager', { deskIndex: 0 });
  const team = await prisma.team.create({ data: { workspaceId: wsA, name: `Field ${sfx}`, managerId: ids.mgr } });
  await mk('e1', wsA, 'employee', { teamId: team.id, isFieldStaff: true, deskIndex: 1 });
  await mk('e2', wsA, 'employee', { deskIndex: 2 });
  await mk('e3', wsA, 'employee', { teamId: team.id, isFieldStaff: true, workingHours: CLOSED, deskIndex: 3 });
  await mk('eB', wsB, 'employee');
  // A published custom floor with two zones (Sales floor, Meeting room).
  await prisma.floorAsset.create({ data: { workspaceId: wsA, version: 1, status: 'published', format: 'layout_json', modelFileId: randomUUID(), seatMap: SEAT_MAP, publishedAt: new Date() } });
  app.get(OfficeMarkersService).invalidate(wsA);

  for (const w of ['adminA', 'mgr', 'e1', 'e2', 'e3', 'adminB', 'eB'] as Who[]) tokens[w] = await login(w);
  for (const w of ['adminA', 'mgr', 'e2', 'adminB'] as Who[]) sockets[w] = await connect(w);
  // Socket users keep beating like the web app (every 10 s here).
  for (const w of ['adminA', 'mgr', 'e2', 'adminB'] as Who[]) beatTimers.push(setInterval(() => sockets[w]?.emit('presence.heartbeat', { activity: 'active', client: 'web' }), 10_000));
  const lead = await api().post('/api/v1/leads').set(auth('adminA')).send({ name: `RT Lead ${sfx}`, phone: '+919876543210', ownerId: ids.e1 });
  expect(lead.status, JSON.stringify(lead.body)).toBe(201);
  leadId = lead.body.id;
}, 90_000);

afterAll(async () => {
  vi.restoreAllMocks();
  for (const t of beatTimers) clearInterval(t);
  for (const s of Object.values(sockets)) s?.disconnect();
  if (prisma) {
    const storage = app ? app.get(StorageService) : null;
    for (const workspaceId of [wsA, wsB].filter(Boolean)) {
      const files = await prisma.file.findMany({ where: { workspaceId } });
      for (const f of files) await storage?.deleteObject(f);
      await prisma.activity.deleteMany({ where: { workspaceId } });
      await prisma.call.deleteMany({ where: { workspaceId } });
      await prisma.locationPing.deleteMany({ where: { workspaceId } });
      await prisma.attendanceSession.deleteMany({ where: { workspaceId } });
      await deleteTestWorkspace(prisma, workspaceId).catch((err: Error) => console.error(`cleanup ${workspaceId}: ${err.message}`));
    }
  }
  await app?.close();
  await prisma?.$disconnect();
}, 60_000);

describe('presence over REST and sockets', () => {
  it('a heartbeat makes the person available with screen and version; the event reaches admin and manager, not other employees or companies', async () => {
    const res = await beat('e1', { screen: 'leads', deviceId: 'app-e1' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(MyPresenceSchema.safeParse(res.body).success, JSON.stringify(MyPresenceSchema.safeParse(res.body).error?.issues)).toBe(true);
    expect(res.body).toMatchObject({ status: 'available', activity: { client: 'android', screen: 'leads' }, heartbeatIntervalSec: 15, timeoutSec: 45 });
    expect(res.body.version).toBeGreaterThan(0);

    const ev = await waitFor(() => statusEvents('adminA', ids.e1).find((r) => (r.event.payload as { presence: string }).presence === 'available'), 3_000, 'adminA status event');
    expect(eventPayloadSchemas['employee.status_changed'].safeParse(ev.event.payload).success).toBe(true);
    expect(ev.event.payload).toMatchObject({ userId: ids.e1, status: 'idle', presence: 'available', source: 'heartbeat', version: res.body.version, activity: { screen: 'leads' } });
    await waitFor(() => statusEvents('mgr', ids.e1).length > 0, 3_000, 'manager status event');
    await sleep(300);
    expect(statusEvents('e2', ids.e1), 'own-scope employee').toHaveLength(0);
    expect((received.adminB ?? []).filter((r) => r.event.workspaceId === wsA), 'other company').toHaveLength(0);

    const again = await beat('e1', { screen: 'leads', deviceId: 'app-e1' });
    expect(again.body.version, 'same screen, no change').toBe(res.body.version);
    const moved = await beat('e1', { screen: 'lead_detail', deviceId: 'app-e1' });
    expect(moved.body).toMatchObject({ version: res.body.version + 1, activity: { screen: 'lead_detail' } });
    const rows = await prisma.presenceEvent.findMany({ where: { workspaceId: wsA, userId: ids.e1 }, orderBy: { version: 'asc' } });
    expect(rows.map((r) => r.version), 'a screen-only change writes no history row').not.toContain(moved.body.version);
  });

  it('a socket heartbeat may carry the screen', async () => {
    sockets.e2!.emit('presence.heartbeat', { activity: 'active', client: 'web', screen: 'board' });
    const ev = await waitFor(() => statusEvents('e2', ids.e2).find((r) => (r.event.payload as { activity?: { screen?: string } }).activity?.screen === 'board'), 3_000, 'screen event');
    expect(ev.event.payload).toMatchObject({ presence: 'available', activity: { client: 'web', screen: 'board' } });
  });

  it('PUT /me/status sets a manual status with a note; legacy idle means available; support of the version order', async () => {
    const meeting = await api().put('/api/v1/me/status').set(auth('e1')).send({ status: 'in_meeting', note: 'Client call prep' });
    expect(meeting.status, JSON.stringify(meeting.body)).toBe(200);
    expect(meeting.body).toMatchObject({ status: 'in_meeting', manualStatus: 'in_meeting', source: 'manual', activity: { note: 'Client call prep' } });
    const idle = await api().put('/api/v1/me/status').set(auth('e1')).send({ status: 'idle' });
    expect(idle.body).toMatchObject({ status: 'available' });
    expect(idle.body.version).toBe(meeting.body.version + 1);
    const bad = await api().put('/api/v1/me/status').set(auth('e1')).send({ status: 'on_call' });
    expect(bad.status).toBe(400);
  });

  it('presence history: team scope for the manager, 404 for other employees and companies, 403 without team.read', async () => {
    const mgr = await api().get(`/api/v1/users/${ids.e1}/presence-history`).set(auth('mgr'));
    expect(mgr.status, JSON.stringify(mgr.body)).toBe(200);
    expect(mgr.body.items.length).toBeGreaterThanOrEqual(3);
    for (const item of mgr.body.items) expect(PresenceEventSchema.safeParse(item).success).toBe(true);
    const versions = (mgr.body.items as Array<{ version: number }>).map((i) => i.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect((await api().get(`/api/v1/users/${ids.e2}/presence-history`).set(auth('mgr'))).status, 'not in the team').toBe(404);
    expect((await api().get(`/api/v1/users/${ids.e1}/presence-history`).set(auth('adminB'))).status, 'other company').toBe(404);
    expect((await api().get(`/api/v1/users/${ids.e1}/presence-history`).set(auth('e2'))).status, 'employee has no team.read').toBe(403);
  });
});

describe('SIM calls from the app', () => {
  const clientCallId = `cc-${sfx}-0001`;
  let callId = '';

  it('call started -> on_call within 1 s; a retry creates no second row', async () => {
    await beat('e1', { deviceId: 'app-e1' });
    const started = Date.now();
    const t0 = realNow();
    const body = { event: 'started', clientCallId, direction: 'outbound', phone: '98765 43210', startedAt: iso(started), deviceId: randomUUID() };
    const res = await api().post('/api/v1/me/calls/active').set(auth('e1')).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(CallSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({ status: 'in_progress', source: 'sim', provider: 'sim', leadId, phone: '+919876543210' });
    callId = res.body.id;
    const ev = await waitFor(() => statusEvents('adminA', ids.e1).find((r) => (r.event.payload as { presence: string }).presence === 'on_call'), 1_000, 'on_call within 1 s');
    expect(ev.t - t0).toBeLessThan(1_000);
    expect(ev.event.payload).toMatchObject({ source: 'phone_state', callId, activity: { leadId } });
    const retry = await api().post('/api/v1/me/calls/active').set(auth('e1')).send(body);
    expect(retry.body.id).toBe(callId);
    expect(await prisma.call.count({ where: { workspaceId: wsA, clientCallId } })).toBe(1);
  });

  it('call ended + device log -> available, one call row with the result on the lead (idempotent batches)', async () => {
    const ended = await api().post('/api/v1/me/calls/active').set(auth('e1')).send({ event: 'ended', clientCallId, endedAt: iso() });
    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe('completed');
    await waitFor(() => statusEvents('adminA', ids.e1).find((r) => (r.event.payload as { presence: string; previousPresence: string }).previousPresence === 'on_call'), 2_000, 'back from on_call');
    const entry = { deviceCallId: `dc-${sfx}-1`, clientCallId, direction: 'outbound', phone: '+91 98765 43210', startedAt: iso(Date.now() - 60_000), endedAt: iso(), durationSec: 42, result: 'connected' };
    const log = await api().post('/api/v1/me/calls/device-log').set(auth('e1')).send({ entries: [entry] });
    expect(log.status, JSON.stringify(log.body)).toBe(200);
    expect(DeviceCallLogResultSchema.safeParse(log.body).success).toBe(true);
    expect(log.body).toMatchObject({ updated: 1, created: 0, items: [{ callId, status: 'updated', leadId }] });
    const again = await api().post('/api/v1/me/calls/device-log').set(auth('e1')).send({ entries: [entry, entry] });
    expect(again.body).toMatchObject({ unchanged: 1, created: 0, updated: 0 });
    const me = await api().get('/api/v1/me/presence').set(auth('e1'));
    expect(me.body.status).toBe('available');
    const call = await api().get(`/api/v1/calls/${callId}`).set(auth('e1'));
    expect(call.body).toMatchObject({ result: 'connected', durationSec: 42, deviceCallId: entry.deviceCallId, leadId });
    expect(await prisma.call.count({ where: { workspaceId: wsA, userId: ids.e1 } })).toBe(1);
    expect(await prisma.activity.count({ where: { workspaceId: wsA, leadId, type: 'call' } }), 'one timeline entry on the lead').toBe(1);
  });

  it('call scope and tenant isolation', async () => {
    expect((await api().get(`/api/v1/calls/${callId}`).set(auth('mgr'))).status).toBe(200);
    expect((await api().get(`/api/v1/calls/${callId}`).set(auth('e2'))).status).toBe(404);
    expect((await api().get(`/api/v1/calls/${callId}`).set(auth('adminB'))).status).toBe(404);
    const list = await api().get('/api/v1/calls').set(auth('e2'));
    expect(list.body.items).toHaveLength(0);
  });

  it('recording upload: own call only, idempotent for the same file, 409 for another, signed URL for readers', async () => {
    const bytes = Buffer.from(`fake-m4a-${sfx}`.repeat(50));
    const up = () => api().post(`/api/v1/calls/${callId}/recording`).set(auth('e1')).attach('file', bytes, { filename: 'Call_9876543210.m4a', contentType: 'audio/mp4' });
    const first = await up();
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ hasRecording: true });
    expect(first.body.recordingFileId).toBeTruthy();
    const second = await up();
    expect(second.status).toBe(200);
    expect(second.body.recordingFileId).toBe(first.body.recordingFileId);
    expect(await prisma.file.count({ where: { workspaceId: wsA, purpose: 'call_recording' } })).toBe(1);
    const other = await api().post(`/api/v1/calls/${callId}/recording`).set(auth('e1')).attach('file', Buffer.from('other'), { filename: 'b.m4a', contentType: 'audio/mp4' });
    expect(other.status).toBe(409);
    const mgrUp = await api().post(`/api/v1/calls/${callId}/recording`).set(auth('mgr')).attach('file', bytes, { filename: 'a.m4a', contentType: 'audio/mp4' });
    expect(mgrUp.status, 'not the caller').toBe(403);
    const e2Up = await api().post(`/api/v1/calls/${callId}/recording`).set(auth('e2')).attach('file', bytes, { filename: 'a.m4a', contentType: 'audio/mp4' });
    expect(e2Up.status, 'out of scope').toBe(404);

    const url = await api().get(`/api/v1/calls/${callId}/recording`).set(auth('mgr'));
    expect(url.status, JSON.stringify(url.body)).toBe(200);
    expect(RecordingUrlSchema.safeParse(url.body).success).toBe(true);
    const dl = await api().get(new URL(url.body.url).pathname).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, bytes)).toBe(0);
    expect((await api().get(`/api/v1/calls/${callId}/recording`).set(auth('adminB'))).status).toBe(404);

    // A log-only call: wrong file type is refused.
    const log = await api().post('/api/v1/me/calls/device-log').set(auth('e1')).send({ entries: [{ deviceCallId: `dc-${sfx}-2`, direction: 'inbound', phone: '', startedAt: iso(Date.now() - 300_000), durationSec: 0, result: 'missed' }] });
    const txt = await api().post(`/api/v1/calls/${log.body.items[0].callId}/recording`).set(auth('e1')).attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(txt.status).toBe(415);
  });
});

describe('office zones', () => {
  it('markers: settings.manage only, QR token returned once, duplicates 409, zones of the published floor, tenant isolation', async () => {
    expect((await api().get('/api/v1/team-floor/markers').set(auth('e1'))).status).toBe(403);
    const qr = await api().post('/api/v1/team-floor/markers').set(auth('adminA')).send({ kind: 'qr', zoneId: 'meeting', label: 'Meeting room door' });
    expect(qr.status, JSON.stringify(qr.body)).toBe(201);
    expect(OfficeMarkerSchema.safeParse(qr.body).success).toBe(true);
    expect(qr.body.token).toMatch(/^vz1\./);
    markerTokenA = qr.body.token;
    const row = await prisma.officeMarker.findUniqueOrThrow({ where: { id: qr.body.id } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toContain(markerTokenA);

    const beacon = { kind: 'ble_beacon', zoneId: 'sales', label: 'Sales beacon', beacon: { uuid: BEACON_UUID, major: 1, minor: 1 } };
    expect((await api().post('/api/v1/team-floor/markers').set(auth('adminA')).send(beacon)).status).toBe(201);
    expect((await api().post('/api/v1/team-floor/markers').set(auth('adminA')).send(beacon)).status, 'same beacon again').toBe(409);
    expect((await api().post('/api/v1/team-floor/markers').set(auth('adminA')).send({ ...beacon, zoneId: 'meeting', label: 'Meeting beacon', beacon: { uuid: BEACON_UUID, major: 1, minor: 2 } })).status).toBe(201);
    expect((await api().post('/api/v1/team-floor/markers').set(auth('adminA')).send({ kind: 'wifi_ap', zoneId: 'sales', label: 'AP' })).status, 'AP without BSSID').toBe(400);
    const unknown = await api().post('/api/v1/team-floor/markers').set(auth('adminA')).send({ kind: 'qr', zoneId: 'rooftop', label: 'Roof' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('VALIDATION_FAILED');
    const tmp = await api().post('/api/v1/team-floor/markers').set(auth('adminA')).send({ kind: 'wifi_ap', zoneId: 'sales', label: 'Sales AP', bssid: 'AA:BB:CC:DD:EE:01' });
    expect(tmp.body.bssid).toBe('aa:bb:cc:dd:ee:01');

    const list = await api().get('/api/v1/team-floor/markers').set(auth('adminA'));
    expect(list.body.items).toHaveLength(4);
    for (const m of list.body.items) expect(m.token, 'token never listed').toBeUndefined();

    expect((await api().delete(`/api/v1/team-floor/markers/${tmp.body.id}`).set(auth('adminB'))).status, 'other company').toBe(404);
    expect((await api().delete(`/api/v1/team-floor/markers/${tmp.body.id}`).set(auth('adminA'))).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { workspaceId: wsA, action: { in: ['office_marker.create', 'office_marker.delete'] } } })).toBe(5);
    const b = await api().post('/api/v1/team-floor/markers').set(auth('adminB')).send({ kind: 'nfc', zoneId: 'lobby', label: 'B lobby' });
    expect(b.status, 'no published floor: any zone id').toBe(201);
    markerTokenB = b.body.token;
  });

  it('BLE, QR and manual signals set the zone with source and confidence; zone_changed reaches the scope only', async () => {
    await beat('e1', { deviceId: 'app-e1' });
    const ble = await api().post('/api/v1/me/presence/zone').set(auth('e1')).send({ source: 'ble', at: iso(), beacons: [{ uuid: BEACON_UUID, major: 1, minor: 1, rssi: -60 }] });
    expect(ble.status, JSON.stringify(ble.body)).toBe(200);
    expect(MyPresenceSchema.safeParse(ble.body).success).toBe(true);
    expect(ble.body.location).toMatchObject({ zoneId: 'sales', zoneName: 'Sales floor', source: 'ble', confidence: 0.95 });
    const ev = await waitFor(() => zoneEvents('adminA', ids.e1)[0], 3_000, 'zone_changed');
    expect(eventPayloadSchemas['employee.zone_changed'].safeParse(ev.event.payload).success).toBe(true);
    expect(ev.event.payload).toMatchObject({ userId: ids.e1, zoneId: 'sales', previousZoneId: null, source: 'ble' });
    await waitFor(() => zoneEvents('mgr', ids.e1).length > 0, 3_000, 'manager zone event');

    const qr = await api().post('/api/v1/me/presence/zone').set(auth('e1')).send({ source: 'qr', at: iso(), markerToken: markerTokenA });
    expect(qr.body.location).toMatchObject({ zoneId: 'meeting', zoneName: 'Meeting room', source: 'qr', confidence: 1 });
    // A strong Sales beacon right after a door scan does not pull the person back (explicit hold, dwell).
    for (let i = 0; i < 3; i++) {
      const r = await api().post('/api/v1/me/presence/zone').set(auth('e1')).send({ source: 'ble', at: iso(), beacons: [{ uuid: BEACON_UUID, major: 1, minor: 1, rssi: -50 }] });
      expect(r.body.location.zoneId).toBe('meeting');
    }
    expect((await api().post('/api/v1/me/presence/zone').set(auth('e1')).send({ source: 'nfc', at: iso(), markerToken: markerTokenB })).status, "another company's tag").toBe(404);
    expect((await api().post('/api/v1/me/presence/zone').set(auth('e1')).send({ source: 'qr', at: iso(), markerToken: 'vz1.not-a-real-marker-token' })).status).toBe(404);
    expect((await api().post('/api/v1/me/presence/zone').set(auth('e1')).send({ source: 'manual', at: iso(), zoneId: 'rooftop' })).status).toBe(400);
    const out = await api().post('/api/v1/me/presence/zone').set(auth('e1')).send({ source: 'manual', at: iso() });
    expect(out.body.location).toBeNull();
    const back = await api().post('/api/v1/me/presence/zone').set(auth('e1')).send({ source: 'manual', at: iso(), zoneId: 'sales' });
    expect(back.body.location).toMatchObject({ zoneId: 'sales', source: 'manual', confidence: 0.8 });
    await waitFor(() => zoneEvents('adminA', ids.e1).length >= 4, 3_000, 'four zone changes');
    expect(zoneEvents('adminA', ids.e1).map((r) => (r.event.payload as { zoneId: string | null }).zoneId)).toEqual(['sales', 'meeting', null, 'sales']);
    await sleep(200);
    expect(zoneEvents('e2', ids.e1), 'own-scope employee').toHaveLength(0);
    expect((received.adminB ?? []).filter((r) => r.name === 'employee.zone_changed' && r.event.workspaceId === wsA)).toHaveLength(0);

    // On a heartbeat: a valid token moves the zone, an unknown one costs nothing.
    const hb = await beat('e1', { deviceId: 'app-e1', zone: { source: 'qr', at: iso(), markerToken: markerTokenA } });
    expect(hb.status).toBe(200);
    expect(hb.body.location.zoneId).toBe('meeting');
    const hbBad = await beat('e1', { deviceId: 'app-e1', zone: { source: 'qr', at: iso(), markerToken: 'vz1.unknown-unknown-unknown' } });
    expect(hbBad.status).toBe(200);
    expect(hbBad.body.location.zoneId).toBe('meeting');
  });

  it('the Team Floor snapshot shows zone, screen, seat and the custom floor', async () => {
    await beat('e1', { deviceId: 'app-e1', screen: 'team_floor' });
    const res = await api().get('/api/v1/team-floor/snapshot').set(auth('adminA'));
    expect(res.status).toBe(200);
    const parsed = TeamFloorSnapshotSchema.safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
    const snap = res.body as TeamFloorSnapshot;
    expect(snap.floor).toMatchObject({ source: 'custom', version: 1 });
    const e1 = snap.employees.find((e) => e.user.id === ids.e1)!;
    expect(e1.presence).toMatchObject({ status: 'available', location: { zoneId: 'meeting', zoneName: 'Meeting room', source: 'qr' }, activity: { screen: 'team_floor' }, isFieldStaff: true });
    expect(e1.presence?.seatId).toMatch(/^d\d$/);
    const mine = await api().get('/api/v1/team-floor/snapshot').set(auth('e2'));
    expect((mine.body as TeamFloorSnapshot).employees.map((e) => e.user.id), 'own scope').toEqual([ids.e2]);
    const other = await api().get('/api/v1/team-floor/snapshot').set(auth('adminB'));
    expect((other.body as TeamFloorSnapshot).employees.map((e) => e.user.id)).not.toContain(ids.e1);
  });
});

describe('attendance and field tracking guards', () => {
  const fix = { lat: 19.076, lng: 72.8777, accuracy: 12 };
  const setHours = (w: Who, hours: BusinessHours) => prisma.user.update({ where: { id: ids[w] }, data: { workingHours: hours } });

  it('not field staff 403, feature off 403, no consent 422, in hours 201, double check-in 409', async () => {
    const notField = await api().post('/api/v1/me/attendance/check-in').set(auth('e2')).send(fix);
    expect(notField.status).toBe(403);
    expect(notField.body.error.code).toBe('NOT_FIELD_STAFF');
    const off = await api().post('/api/v1/me/attendance/check-in').set(auth('e1')).send(fix);
    expect(off.body.error.code).toBe('FEATURE_DISABLED');
    await prisma.featureFlagOverride.create({ data: { workspaceId: wsA, flag: 'field_tracking', enabled: true } });
    const noConsent = await api().post('/api/v1/me/attendance/check-in').set(auth('e1')).send(fix);
    expect(noConsent.status).toBe(422);
    expect(noConsent.body.error.code).toBe('TRACKING_CONSENT_REQUIRED');
    for (const w of ['e1', 'e3'] as Who[]) {
      const c = await api().put('/api/v1/me/tracking-consent').set(auth(w)).send({ accepted: true, version: TRACKING_CONSENT_VERSION });
      expect(c.body).toMatchObject({ accepted: true, version: TRACKING_CONSENT_VERSION });
    }
    await setHours('e1', ALL_DAY);
    const inHours = await api().post('/api/v1/me/attendance/check-in').set(auth('e1')).send(fix);
    expect(inHours.status, JSON.stringify(inHours.body)).toBe(201);
    await waitFor(() => eventsOf('mgr', 'attendance.checked_in').length > 0, 3_000, 'manager gets checked_in');
    await sleep(200);
    expect(eventsOf('e2', 'attendance.checked_in'), 'not to other employees').toHaveLength(0);
    const twice = await api().post('/api/v1/me/attendance/check-in').set(auth('e1')).send(fix);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('ATTENDANCE_STATE_INVALID');
    const outside = await api().post('/api/v1/me/attendance/check-in').set(auth('e3')).send(fix);
    expect(outside.status).toBe(422);
    expect(outside.body.error.code).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('location: idempotent per point; outside working hours rejected and never stored', async () => {
    const now = Date.now();
    const points = [{ ...fix, at: iso(now - 10_000) }, { ...fix, lat: 19.077, at: iso(now) }];
    const first = await api().post('/api/v1/me/location').set(auth('e1')).send({ points });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(LocationBatchResultSchema.safeParse(first.body).success).toBe(true);
    expect(first.body).toMatchObject({ accepted: 2, duplicates: 0, rejected: [] });
    const again = await api().post('/api/v1/me/location').set(auth('e1')).send({ points });
    expect(again.body).toMatchObject({ accepted: 0, duplicates: 2 });
    await waitFor(() => eventsOf('mgr', 'location.updated').length > 0, 3_000, 'manager gets location');
    expect(eventsOf('e2', 'location.updated')).toHaveLength(0);
    await setHours('e1', CLOSED);
    const late = await api().post('/api/v1/me/location').set(auth('e1')).send({ points: [{ ...fix, at: iso() }] });
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('OUTSIDE_WORKING_HOURS');
    expect(await prisma.locationPing.count({ where: { workspaceId: wsA, userId: ids.e1 } })).toBe(2);
    await setHours('e1', ALL_DAY);
    const out = await api().post('/api/v1/me/attendance/check-out').set(auth('e1')).send(fix);
    expect(out.status).toBe(200);
    expect((await api().post('/api/v1/me/attendance/check-out').set(auth('e1')).send(fix)).status).toBe(409);
  });
});

describe('socket auth', () => {
  it('a bad token is refused at the handshake; rooms of another company answer NOT_FOUND', async () => {
    const s = io(`${base}${REALTIME_NAMESPACE}`, { auth: { token: 'not-a-token' }, transports: ['websocket'], reconnection: false, forceNew: true });
    const err = await new Promise<Error>((resolve) => s.once('connect_error', resolve));
    expect(err.message).toMatch(/^AUTH_/);
    s.disconnect();
    const res = await sockets.adminB!.emitWithAck('room.join', { room: `lead:${leadId}` });
    expect(res).toEqual({ ok: false, error: 'NOT_FOUND' });
    const own = await sockets.adminA!.emitWithAck('room.join', { room: `lead:${leadId}` });
    expect(own).toEqual({ ok: true });
  });
});

describe('snapshot + events = fresh snapshot, event ordering, offline timeout', () => {
  it('a client applying the events it received after a snapshot ends with the fresh snapshot', async () => {
    received.adminA = [];
    const s0 = (await api().get('/api/v1/team-floor/snapshot').set(auth('adminA'))).body as TeamFloorSnapshot;

    // A burst of activity across people.
    await beat('e1', { deviceId: 'app-e1', screen: 'calls' });
    await api().put('/api/v1/me/status').set(auth('e2')).send({ status: 'on_break' });
    await api().put('/api/v1/me/status').set(auth('mgr')).send({ status: 'in_meeting', note: 'Weekly review' });
    await beat('e3', { client: 'web', screen: 'board' });
    const cc = `cc-${sfx}-0002`;
    await api().post('/api/v1/me/calls/active').set(auth('e1')).send({ event: 'started', clientCallId: cc, direction: 'inbound', phone: '+919811122233', startedAt: iso() });
    await api().post('/api/v1/me/presence/zone').set(auth('e1')).send({ source: 'manual', at: iso(), zoneId: 'sales' });
    await api().post('/api/v1/me/calls/active').set(auth('e1')).send({ event: 'ended', clientCallId: cc, endedAt: iso() });
    await api().put('/api/v1/me/status').set(auth('e2')).send({ status: 'available' });
    await quiet();

    // 46 s of silence: the sweeper takes everybody offline (since = last beat + 45 s) and clears zones.
    for (const t of beatTimers) clearInterval(t);
    const lastBeat = Date.parse((await api().get('/api/v1/me/presence').set(auth('e1'))).body.lastHeartbeatAt);
    clockOffset = PRESENCE_TIMEOUT_MS + 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset);
    await app.get(PresenceService).sweep(true);
    await quiet();

    const s1 = (await api().get('/api/v1/team-floor/snapshot').set(auth('adminA'))).body as TeamFloorSnapshot;
    const off = statusEvents('adminA', ids.e1).at(-1)!.event.payload as { presence: string; source: string; since: string };
    expect(off).toMatchObject({ presence: 'offline', source: 'timeout' });
    expect(Date.parse(off.since)).toBe(lastBeat + PRESENCE_TIMEOUT_MS);
    expect((zoneEvents('adminA', ids.e1).at(-1)!.event.payload as { zoneId: string | null }).zoneId).toBeNull();

    // Reference client: status by version (drop stale), zones in arrival order.
    type Row = { status: string; version: number; zoneId: string | null; screen: string | null };
    const state = new Map<string, Row>(
      s0.employees.map((e) => [e.user.id, { status: e.presence!.status, version: e.presence!.version, zoneId: e.presence!.location?.zoneId ?? null, screen: e.presence!.activity.screen ?? null }]),
    );
    for (const r of received.adminA ?? []) {
      if (r.name === 'employee.status_changed') {
        const p = r.event.payload as { userId: string; presence: string; version: number; activity: { screen?: string | null } };
        const held = state.get(p.userId);
        if (!held || held.version >= p.version) continue;
        state.set(p.userId, { ...held, status: p.presence, version: p.version, screen: p.activity.screen ?? null });
      } else if (r.name === 'employee.zone_changed') {
        const p = r.event.payload as { userId: string; zoneId: string | null };
        const held = state.get(p.userId);
        if (held) state.set(p.userId, { ...held, zoneId: p.zoneId });
      }
    }
    const fresh = new Map<string, Row>(
      s1.employees.map((e) => [e.user.id, { status: e.presence!.status, version: e.presence!.version, zoneId: e.presence!.location?.zoneId ?? null, screen: e.presence!.activity.screen ?? null }]),
    );
    expect(Object.fromEntries(state)).toEqual(Object.fromEntries(fresh));
    for (const uid of [ids.e1, ids.e2, ids.e3]) expect(fresh.get(uid)?.status, `user ${uid}`).toBe('offline');
    expect(fresh.get(ids.mgr)?.status, 'a manual meeting holds without heartbeats').toBe('in_meeting');

    // Ordering: per person the versions arrive strictly increasing, without gaps.
    for (const uid of [ids.mgr, ids.e1, ids.e2, ids.e3]) {
      const versions = statusEvents('adminA', uid).map((r) => (r.event.payload as { version: number }).version);
      expect(versions.length, `events for ${uid}`).toBeGreaterThan(0);
      versions.forEach((v, i) => i > 0 && expect(v, `user ${uid}`).toBe(versions[i - 1]! + 1));
    }
  }, 30_000);
});
