import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainEvent, EventName, EventPayload, PresenceStatus, TeamFloorPresence, TeamFloorSnapshot } from '@vistar/shared';
import { mockTeamFloorSnapshot } from '@vistar/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { initialFloorState } from '../state/reducer';
import { FloorTemplateSchema, resolveTemplateId, type FloorTemplate } from '../state/template';
import { applyLiveEvents, enrichFloor, INITIAL_LIVE_FLOOR, liveFloorReducer, liveFromSnapshot, refreshLive, type LiveFloor, type LiveFloorEmployee } from './live-presence';
import { confidenceLabel, statusView } from './presence-labels';

/**
 * Live presence on the Team Floor (D-062): version ordering, zones, late call starts, refresh.
 * Run: pnpm --filter @vistar/web test (Kiro Crew; not run by the authoring agent).
 */

const DIR = join(__dirname, '../../../public/team-floor/templates');
const NOW = Date.parse('2026-11-03T05:00:00.000Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function template(people: number): FloorTemplate {
  const id = resolveTemplateId(people, null);
  return FloorTemplateSchema.parse(JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')));
}

function presence(status: PresenceStatus, version: number, extra: Partial<TeamFloorPresence> = {}): TeamFloorPresence {
  return {
    status,
    version,
    employeeStatus: status === 'available' ? 'idle' : status === 'on_call' ? 'on_call' : status === 'offline' ? 'offline' : 'away',
    source: 'heartbeat',
    since: iso(-10 * 60_000),
    manualStatus: null,
    lastHeartbeatAt: iso(-5_000),
    lastSeenAt: iso(-5_000),
    activity: { callId: null, callStartedAt: null, leadId: null, leadName: null, client: 'web', clientActivity: 'active', note: null, screen: 'leads' },
    location: null,
    seatId: null,
    isFieldStaff: false,
    checkedIn: false,
    ...extra,
  };
}

function snapshot(): TeamFloorSnapshot {
  const base = mockTeamFloorSnapshot(new Date(NOW));
  const [a, b, ...rest] = base.employees;
  return {
    ...base,
    generatedAt: iso(0),
    employees: [
      { ...a!, status: 'idle', activeCall: null, presence: presence('available', 5) },
      {
        ...b!,
        status: 'idle',
        activeCall: null,
        presence: presence('available', 9, { location: { zoneId: 'meeting', zoneName: 'Meeting room', source: 'qr', confidence: 1, since: iso(-60_000), at: iso(-30_000) } }),
      },
      ...rest,
    ],
  };
}

function load(): { s: LiveFloor; snap: TeamFloorSnapshot; a: string; b: string } {
  const snap = snapshot();
  const floor = initialFloorState(snap, { template: template(snap.employees.length) });
  const s = liveFloorReducer(INITIAL_LIVE_FLOOR, { kind: 'load', snapshot: snap, floor });
  return { s, snap, a: snap.employees[0]!.user.id, b: snap.employees[1]!.user.id };
}

let seq = 0;
function ev<E extends EventName>(type: E, payload: EventPayload<E>, at = iso(0)): DomainEvent<E> {
  seq += 1;
  return { id: `e${seq}`, type, workspaceId: 'w', occurredAt: at, actor: null, payload };
}

function statusEvent(userId: string, status: PresenceStatus, version: number, at = iso(0), screen: 'calls' | 'leads' | null = 'calls') {
  return ev('employee.status_changed', {
    userId,
    status: status === 'available' ? 'idle' : status === 'on_call' ? 'on_call' : status === 'offline' ? 'offline' : 'away',
    previousStatus: null,
    currentLeadId: null,
    callId: null,
    at,
    presence: status,
    version,
    since: at,
    source: 'manual',
    lastSeenAt: at,
    activity: { callId: null, callStartedAt: null, leadId: null, leadName: null, client: 'android', clientActivity: 'active', note: null, screen },
  });
}

const emp = (s: LiveFloor, id: string) => s.floor!.employees[s.floor!.index[id]!] as LiveFloorEmployee;

describe('liveFromSnapshot', () => {
  it('reads status, version, zone and learns zone names', () => {
    const { s, b } = load();
    expect(s.live.people[b]).toMatchObject({ status: 'available', version: 9, zone: { zoneId: 'meeting', zoneName: 'Meeting room', source: 'qr', confidence: 1 } });
    expect(s.live.zoneNames).toEqual({ meeting: 'Meeting room' });
  });

  it('mirrors the six agreed fields onto the people entries and seeds statusSince from the server', () => {
    const { s, b } = load();
    expect(emp(s, b)).toMatchObject({ zoneId: 'meeting', zoneName: 'Meeting room', zoneSource: 'qr', zoneConfidence: 1, screen: 'leads' });
    expect(emp(s, b).activity?.client).toBe('web');
    expect(emp(s, b).statusSince).toBe(NOW - 10 * 60_000);
  });

  it('falls back to the coarse status when the snapshot has no presence (test mocks)', () => {
    const live = liveFromSnapshot(mockTeamFloorSnapshot(new Date(NOW)));
    const first = Object.values(live.people)[0]!;
    expect(first.status).toBeNull();
    expect(first.version).toBe(-1);
    expect(statusView(first, 'busy')).toEqual({ label: 'Busy', tone: 'amber' });
  });
});

describe('version ordering (employee.status_changed)', () => {
  it('applies a newer version to the live presence and the floor', () => {
    const { s, a } = load();
    const next = liveFloorReducer(s, { kind: 'events', events: [statusEvent(a, 'on_break', 6)], now: NOW });
    expect(next.live.people[a]).toMatchObject({ status: 'on_break', version: 6, source: 'manual' });
    expect(emp(next, a).status).toBe('away');
    expect(emp(next, a).screen).toBe('calls');
  });

  it('drops events at or below the held version (late or repeated delivery)', () => {
    const { s, a } = load();
    const r = applyLiveEvents(s.live, [statusEvent(a, 'offline', 5), statusEvent(a, 'offline', 3)]);
    expect(r.accepted).toHaveLength(0);
    expect(r.live).toBe(s.live);
    const next = liveFloorReducer(s, { kind: 'events', events: [statusEvent(a, 'offline', 4)], now: NOW });
    expect(emp(next, a).status).toBe('idle');
  });

  it('keeps the newest of an out-of-order burst', () => {
    const { s, a } = load();
    const next = liveFloorReducer(s, { kind: 'events', events: [statusEvent(a, 'in_meeting', 8), statusEvent(a, 'on_break', 7)], now: NOW });
    expect(next.live.people[a]).toMatchObject({ status: 'in_meeting', version: 8 });
  });

  it('clears the zone when someone goes offline', () => {
    const { s, b } = load();
    const next = liveFloorReducer(s, { kind: 'events', events: [statusEvent(b, 'offline', 10)], now: NOW });
    expect(next.live.people[b]?.zone).toBeNull();
    expect(emp(next, b).zoneId).toBeNull();
  });
});

describe('zones (employee.zone_changed)', () => {
  it('applies a newer zone with its source and confidence and keeps names from the seat map', () => {
    const { s, a } = load();
    const withNames = liveFloorReducer(s, { kind: 'zones', zones: [{ id: 'pantry', name: 'Pantry' }] });
    const next = liveFloorReducer(withNames, {
      kind: 'events',
      events: [ev('employee.zone_changed', { userId: a, zoneId: 'pantry', previousZoneId: null, source: 'ble', confidence: 0.82, at: iso(0) })],
      now: NOW,
    });
    expect(next.live.people[a]?.zone).toMatchObject({ zoneId: 'pantry', zoneName: 'Pantry', source: 'ble', confidence: 0.82 });
    expect(emp(next, a)).toMatchObject({ zoneId: 'pantry', zoneName: 'Pantry', zoneSource: 'ble', zoneConfidence: 0.82 });
    expect(confidenceLabel('ble', 0.82)).toBe('High');
  });

  it('drops a zone fact older than the one held', () => {
    const { s, b } = load();
    const r = applyLiveEvents(s.live, [ev('employee.zone_changed', { userId: b, zoneId: 'pantry', previousZoneId: 'meeting', source: 'wifi', confidence: 0.6, at: iso(-120_000) })]);
    expect(r.accepted).toHaveLength(0);
    expect(r.live.people[b]?.zone?.zoneId).toBe('meeting');
  });

  it('zoneId null = left the known zones', () => {
    const { s, b } = load();
    const next = liveFloorReducer(s, { kind: 'events', events: [ev('employee.zone_changed', { userId: b, zoneId: null, previousZoneId: 'meeting', source: 'ble', confidence: 0, at: iso(0) })], now: NOW });
    expect(next.live.people[b]?.zone).toBeNull();
    expect(emp(next, b).zoneName).toBeNull();
  });
});

describe('late call.started', () => {
  it('is dropped when the server already moved the person past the call', () => {
    const { s, snap, a } = load();
    const after = liveFloorReducer(s, { kind: 'events', events: [statusEvent(a, 'available', 6, iso(0))], now: NOW });
    const user = snap.employees[0]!.user;
    const call = ev('call.started', {
      call: {
        id: 'c1',
        direction: 'outbound',
        status: 'ringing',
        outcome: null,
        leadId: null,
        leadName: 'Shree Traders',
        user,
        from: '',
        to: '',
        startedAt: iso(-60_000),
        answeredAt: null,
        endedAt: null,
        durationSec: 0,
        hasRecording: false,
        notes: null,
        disposition: null,
        provider: 'sim',
        customFields: {},
        source: 'sim',
        result: null,
        phone: null,
        deviceCallId: null,
        clientCallId: null,
        deviceId: null,
        recordingFileId: null,
      } as never,
    });
    const r = applyLiveEvents(after.live, [call]);
    expect(r.accepted).toHaveLength(0);
    const next = liveFloorReducer(after, { kind: 'events', events: [call], now: NOW });
    expect(emp(next, a).status).toBe('idle');
  });
});

describe('refreshLive', () => {
  it('turns a newer version into a synthetic status event and moves last seen', () => {
    const { s, snap, a } = load();
    const fresh: TeamFloorSnapshot = {
      ...snap,
      generatedAt: iso(60_000),
      employees: snap.employees.map((e, i) => (i === 0 ? { ...e, presence: presence('lunch', 7, { since: iso(30_000), lastSeenAt: iso(55_000) }) } : e)),
    };
    const r = refreshLive(s.live, fresh);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]?.type).toBe('employee.status_changed');
    expect(r.live.people[a]?.lastSeenAt).toBe(NOW + 55_000);
    const next = liveFloorReducer(s, { kind: 'refresh', snapshot: fresh, now: NOW + 60_000 });
    expect(next.live.people[a]).toMatchObject({ status: 'lunch', version: 7 });
    expect(emp(next, a).status).toBe('away');
  });

  it('changes nothing when the snapshot is not newer', () => {
    const { s, snap } = load();
    const next = liveFloorReducer(s, { kind: 'refresh', snapshot: snap, now: NOW });
    expect(next).toBe(s);
  });
});

describe('enrichFloor', () => {
  it('keeps the identity of people whose fields did not change', () => {
    const { s, a, b } = load();
    const before = emp(s, b);
    const next = liveFloorReducer(s, { kind: 'events', events: [statusEvent(a, 'on_break', 6)], now: NOW });
    expect(emp(next, b)).toBe(before);
    expect(enrichFloor(next.floor!, next.live)).toBe(next.floor);
  });
});
