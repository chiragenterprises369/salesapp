import type {
  DomainEvent,
  PresenceActivity,
  PresenceSource,
  PresenceStatus,
  TeamFloorSnapshot,
  ZoneSignalSource,
} from '@vistar/shared';
import { floorRootReducer } from '../state/reducer';
import type { FloorAction, FloorEmployee, FloorPresenceFields, FloorPresencePatch, FloorState } from '../state/types';

/**
 * LIVE PRESENCE on the Team Floor (D-062, SPEC 29.2 and 29.11). Pure, unit tested.
 *
 * The server decides the status from observed facts and numbers every visible change per user
 * (`Presence.version`). The floor keeps, per person, the detailed status, the version it holds, the
 * office zone with its source and confidence, the activity (call, lead, screen, client) and "last seen".
 *
 * - `employee.status_changed` at or below the held version is dropped (late or repeated delivery), so a
 *   person never flips back to an older status.
 * - `employee.zone_changed` has no version: zone facts older than the newest applied one are dropped.
 * - A late `call.started` for a call the server already moved past (status changed after the call began)
 *   is dropped, so the floor never shows a call that has ended.
 * - Values that move without events (last seen, zone confidence) come from a periodic snapshot refresh;
 *   a newer version found there is applied as a synthetic status event, so the floor reducer stays in step.
 *
 * The people entries' presence fields (floor-interface-19b.md) are filled by FLOOR's reducer from the
 * events let through here, plus `presence` actions for what only this module learns (refresh, zone names).
 */

// ---------------------------------------------------------------- types

export interface LiveZone {
  zoneId: string;
  zoneName: string | null;
  source: ZoneSignalSource;
  /** 0..1 as reported by the server for `at` (QR and NFC 1, manual 0.8, BLE up to 0.95, Wi-Fi up to 0.7). */
  confidence: number;
  /** Epoch ms: entered this zone. */
  since: number;
  /** Epoch ms: last supporting signal. */
  at: number;
}

export interface LivePresence {
  userId: string;
  /** Detailed status; null when the server did not send one (test mocks): use the coarse floor status. */
  status: PresenceStatus | null;
  /** Presence.version held; -1 = unknown. */
  version: number;
  /** Epoch ms: when the current status started. */
  since: number | null;
  source: PresenceSource | null;
  /** Epoch ms of the last observed activity of any kind. */
  lastSeenAt: number | null;
  activity: PresenceActivity | null;
  zone: LiveZone | null;
  /** Epoch ms of the newest zone fact applied (orders zone events, which carry no version). */
  zoneAt: number | null;
  isFieldStaff: boolean;
  checkedIn: boolean;
  /** Seat on the published custom floor (FloorSeat.id); null on the default template. */
  seatId: string | null;
}

export interface LiveState {
  people: Readonly<Record<string, LivePresence>>;
  /** Zone id -> name, from the snapshot and the published seat map. */
  zoneNames: Readonly<Record<string, string>>;
}

/** The people entries' presence fields (declared by FLOOR on FloorEmployee, state/types.ts). */
export type LiveFloorFields = FloorPresenceFields;

/** A people entry of the floor (FloorEmployee carries the presence fields since FLOOR's fa7704a). */
export type LiveFloorEmployee = FloorEmployee;

export const EMPTY_LIVE: LiveState = Object.freeze({ people: Object.freeze({}), zoneNames: Object.freeze({}) }) as LiveState;

export { clientLabel, confidenceLabel, PRESENCE_LABEL, PRESENCE_TONE, SCREEN_LABEL, SOURCE_LABEL, statusView, ZONE_SOURCE_LABEL } from './presence-labels';

// ---------------------------------------------------------------- snapshot -> live

const t = (iso: string | null | undefined): number | null => {
  const v = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(v) ? v : null;
};

/** Live presence from the server snapshot (zone names learned here are kept across reloads). */
export function liveFromSnapshot(snapshot: TeamFloorSnapshot, prev: LiveState | null = null): LiveState {
  const zoneNames: Record<string, string> = { ...(prev?.zoneNames ?? {}) };
  const people: Record<string, LivePresence> = {};
  for (const e of snapshot.employees) {
    const p = e.presence;
    const loc = p?.location ?? null;
    if (loc?.zoneId && loc.zoneName) zoneNames[loc.zoneId] = loc.zoneName;
    const zoneAt = loc ? t(loc.at) : null;
    people[e.user.id] = {
      userId: e.user.id,
      status: p?.status ?? null,
      version: p?.version ?? -1,
      since: t(p?.since) ?? (e.activeCall ? t(e.activeCall.startedAt) : null),
      source: p?.source ?? null,
      lastSeenAt: t(p?.lastSeenAt),
      activity: p?.activity ?? null,
      zone:
        loc && loc.zoneId
          ? {
              zoneId: loc.zoneId,
              zoneName: loc.zoneName ?? zoneNames[loc.zoneId] ?? null,
              source: loc.source,
              confidence: loc.confidence,
              since: t(loc.since) ?? zoneAt ?? 0,
              at: zoneAt ?? 0,
            }
          : null,
      zoneAt,
      isFieldStaff: p?.isFieldStaff ?? false,
      checkedIn: p?.checkedIn ?? false,
      seatId: p?.seatId ?? null,
    };
  }
  return { people, zoneNames };
}

/** Add zone names (from the published seat map); fills names of zones people are already in. */
export function withZoneNames(live: LiveState, zones: ReadonlyArray<{ id: string; name: string }>): { live: LiveState; touched: Set<string> } {
  const touched = new Set<string>();
  const names = { ...live.zoneNames };
  let namesChanged = false;
  for (const z of zones) {
    if (names[z.id] !== z.name) {
      names[z.id] = z.name;
      namesChanged = true;
    }
  }
  if (!namesChanged) return { live, touched };
  let people: Record<string, LivePresence> | null = null;
  for (const p of Object.values(live.people)) {
    const name = p.zone ? names[p.zone.zoneId] : undefined;
    if (p.zone && name && p.zone.zoneName !== name) {
      people ??= { ...live.people };
      people[p.userId] = { ...p, zone: { ...p.zone, zoneName: name } };
      touched.add(p.userId);
    }
  }
  return { live: { people: people ?? live.people, zoneNames: names }, touched };
}

// ---------------------------------------------------------------- events

export interface LiveApplyResult {
  live: LiveState;
  /** Events the floor reducer should apply (stale ones removed). */
  accepted: DomainEvent[];
  /** People whose live presence changed. */
  touched: Set<string>;
}

/** Apply domain events to the live presence; drops stale status, zone and call-start events. */
export function applyLiveEvents(live: LiveState, events: readonly DomainEvent[]): LiveApplyResult {
  let people: Record<string, LivePresence> | null = null;
  const touched = new Set<string>();
  const accepted: DomainEvent[] = [];
  const get = (id: string | null | undefined) => (id ? (people ?? live.people)[id] : undefined);
  const put = (p: LivePresence) => {
    people ??= { ...live.people };
    people[p.userId] = p;
    touched.add(p.userId);
  };

  for (const e of events) {
    switch (e.type) {
      case 'employee.status_changed': {
        const p = (e as DomainEvent<'employee.status_changed'>).payload;
        const held = get(p.userId);
        if (held && p.version !== undefined && held.version >= p.version) continue;
        accepted.push(e);
        if (!held) continue;
        const offline = p.presence ? p.presence === 'offline' : p.status === 'offline';
        put({
          ...held,
          status: p.presence ?? null,
          version: p.version ?? held.version,
          since: t(p.since ?? p.at) ?? held.since,
          source: p.source ?? held.source,
          lastSeenAt: p.lastSeenAt !== undefined ? t(p.lastSeenAt) : held.lastSeenAt,
          activity: p.activity ?? held.activity,
          // Going offline clears the zone on the server too.
          zone: offline ? null : held.zone,
        });
        continue;
      }
      case 'employee.zone_changed': {
        const p = (e as DomainEvent<'employee.zone_changed'>).payload;
        const held = get(p.userId);
        const at = t(p.at) ?? 0;
        if (held && held.zoneAt !== null && at < held.zoneAt) continue;
        accepted.push(e);
        if (!held) continue;
        const same = held.zone?.zoneId === p.zoneId;
        put({
          ...held,
          zoneAt: at,
          zone:
            p.zoneId === null
              ? null
              : {
                  zoneId: p.zoneId,
                  zoneName: live.zoneNames[p.zoneId] ?? (same ? (held.zone?.zoneName ?? null) : null),
                  source: p.source,
                  confidence: p.confidence,
                  since: same && held.zone ? held.zone.since : at,
                  at,
                },
        });
        continue;
      }
      case 'call.started': {
        const { call } = (e as DomainEvent<'call.started'>).payload;
        const held = get(call.user?.id);
        const startedAt = t(call.startedAt);
        const movedPast =
          !!held && held.version >= 0 && held.status !== null && held.status !== 'on_call' && held.since !== null && startedAt !== null && startedAt < held.since;
        if (call.endedAt || movedPast) continue;
        accepted.push(e);
        continue;
      }
      case 'attendance.checked_in':
      case 'attendance.checked_out': {
        const { user, session } = (e as DomainEvent<'attendance.checked_in'>).payload;
        accepted.push(e);
        const held = get(user.id);
        const checkedIn = e.type === 'attendance.checked_in' && session.checkOutAt === null;
        if (held && held.checkedIn !== checkedIn) put({ ...held, checkedIn });
        continue;
      }
      default:
        accepted.push(e);
    }
  }
  return { live: people ? { ...live, people } : live, accepted, touched };
}

// ---------------------------------------------------------------- periodic refresh

export interface LiveRefreshResult {
  live: LiveState;
  /** Synthetic status events for versions newer than held (applied through the normal event path). */
  events: DomainEvent[];
  touched: Set<string>;
}

/**
 * Merge a fresh snapshot into the live presence without resetting the floor: last seen, zone confidence
 * and time of the last signal (they move without events), check-in, seat; newer versions become events.
 */
export function refreshLive(live: LiveState, snapshot: TeamFloorSnapshot): LiveRefreshResult {
  const fresh = liveFromSnapshot(snapshot, live);
  const generated = t(snapshot.generatedAt) ?? 0;
  const events: DomainEvent[] = [];
  const touched = new Set<string>();
  let people: Record<string, LivePresence> | null = null;

  for (const e of snapshot.employees) {
    const held = live.people[e.user.id];
    const next = fresh.people[e.user.id];
    const p = e.presence;
    if (!held || !next || !p) continue;
    if (p.version > held.version) {
      events.push({
        id: `refresh:${e.user.id}:${p.version}`,
        type: 'employee.status_changed',
        workspaceId: '',
        occurredAt: snapshot.generatedAt,
        actor: null,
        payload: {
          userId: e.user.id,
          status: p.employeeStatus,
          previousStatus: null,
          currentLeadId: p.activity.leadId,
          callId: p.activity.callId,
          at: p.since,
          presence: p.status,
          version: p.version,
          since: p.since,
          source: p.source,
          lastSeenAt: p.lastSeenAt,
          activity: p.activity,
        },
      } as DomainEvent<'employee.status_changed'>);
    }
    let merged = held;
    if (next.lastSeenAt !== null && (held.lastSeenAt === null || next.lastSeenAt > held.lastSeenAt)) merged = { ...merged, lastSeenAt: next.lastSeenAt };
    const zoneFresher = next.zoneAt !== null ? held.zoneAt === null || next.zoneAt >= held.zoneAt : held.zone !== null && (held.zoneAt === null || generated > held.zoneAt);
    if (zoneFresher && !sameZone(held.zone, next.zone)) merged = { ...merged, zone: next.zone, zoneAt: next.zoneAt ?? generated };
    if (held.checkedIn !== next.checkedIn || held.isFieldStaff !== next.isFieldStaff || held.seatId !== next.seatId)
      merged = { ...merged, checkedIn: next.checkedIn, isFieldStaff: next.isFieldStaff, seatId: next.seatId };
    if (merged !== held) {
      people ??= { ...live.people };
      people[held.userId] = merged;
      touched.add(held.userId);
    }
  }
  const namesChanged = Object.keys(fresh.zoneNames).length !== Object.keys(live.zoneNames).length;
  return { live: people || namesChanged ? { people: people ?? live.people, zoneNames: fresh.zoneNames } : live, events, touched };
}

function sameZone(a: LiveZone | null, b: LiveZone | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.zoneId === b.zoneId && a.source === b.source && a.confidence === b.confidence && a.at === b.at && a.zoneName === b.zoneName;
}

// ---------------------------------------------------------------- hand-off to the floor reducer

/**
 * FLOOR's reducer fills the people entries' presence fields (zone, screen, activity, presence, last seen)
 * from the snapshot and from the events this module lets through; values learned elsewhere (refresh,
 * seat-map zone names) go in as its `presence` action so placement in zones stays consistent.
 */
function presencePatch(p: LivePresence, emp: FloorEmployee | undefined): FloorPresencePatch | null {
  const patch: FloorPresencePatch = {
    zoneId: p.zone?.zoneId ?? null,
    zoneName: p.zone?.zoneName ?? (p.zone && emp?.zoneId === p.zone.zoneId ? (emp.zoneName ?? null) : null),
    zoneSource: p.zone?.source ?? null,
    zoneConfidence: p.zone?.confidence ?? null,
    zoneAt: p.zone?.at ?? null,
    lastSeenAt: p.lastSeenAt,
    seatId: p.seatId,
  };
  if (!emp) return patch;
  const differs = (Object.keys(patch) as (keyof FloorPresencePatch)[]).some((k) => (emp[k] ?? null) !== (patch[k] ?? null));
  return differs ? patch : null;
}

function patchFloor(floor: FloorState, live: LiveState, ids: Iterable<string>): FloorState {
  let next = floor;
  for (const id of ids) {
    const p = live.people[id];
    const i = next.index[id];
    if (!p || i === undefined) continue;
    const patch = presencePatch(p, next.employees[i]);
    if (patch) next = floorRootReducer(next, { kind: 'presence', userId: id, patch }) ?? next;
  }
  return next;
}

/** A missing `statusSince` comes from the server's `since` (the floor shows "on a break for 12 min"). */
export function seedStatusSince(floor: FloorState, live: LiveState): FloorState {
  let employees: FloorEmployee[] | null = null;
  floor.employees.forEach((e, i) => {
    const since = live.people[e.id]?.since ?? null;
    if (e.statusSince !== null || since === null) return;
    employees ??= [...floor.employees];
    employees[i] = { ...e, statusSince: since };
  });
  return employees ? { ...floor, employees } : floor;
}

// ---------------------------------------------------------------- reducer used by the feed

export interface LiveFloor {
  floor: FloorState | null;
  live: LiveState;
}

export type LiveFloorAction =
  | { kind: 'load'; snapshot: TeamFloorSnapshot; floor: FloorState }
  | { kind: 'refresh'; snapshot: TeamFloorSnapshot; now: number }
  | { kind: 'zones'; zones: ReadonlyArray<{ id: string; name: string }> }
  | Exclude<FloorAction, { kind: 'reset' }>;

export const INITIAL_LIVE_FLOOR: LiveFloor = { floor: null, live: EMPTY_LIVE };

/** Floor state plus live presence: version and zone ordering first, then FLOOR's reducer. */
export function liveFloorReducer(s: LiveFloor, a: LiveFloorAction): LiveFloor {
  switch (a.kind) {
    case 'load': {
      const live = liveFromSnapshot(a.snapshot, s.live);
      return { live, floor: seedStatusSince(a.floor, live) };
    }
    case 'events': {
      if (!s.floor) return s;
      const r = applyLiveEvents(s.live, a.events);
      const base = floorRootReducer(s.floor, { kind: 'events', events: r.accepted, now: a.now }) ?? s.floor;
      // Keep the floor's zone, seat and last seen in step with what this module holds (e.g. offline clears the zone).
      const floor = r.touched.size ? patchFloor(base, r.live, r.touched) : base;
      return floor === s.floor && r.live === s.live ? s : { floor, live: r.live };
    }
    case 'refresh': {
      if (!s.floor) return s;
      const r = refreshLive(s.live, a.snapshot);
      const next = r.events.length ? liveFloorReducer({ floor: s.floor, live: r.live }, { kind: 'events', events: r.events, now: a.now }) : { floor: s.floor, live: r.live };
      const floor = r.touched.size && next.floor ? patchFloor(next.floor, next.live, r.touched) : next.floor;
      return floor === s.floor && next.live === s.live ? s : { floor, live: next.live };
    }
    case 'zones': {
      const r = withZoneNames(s.live, a.zones);
      if (r.live === s.live) return s;
      return { live: r.live, floor: s.floor && r.touched.size ? patchFloor(s.floor, r.live, r.touched) : s.floor };
    }
    default: {
      if (!s.floor) return s;
      const floor = floorRootReducer(s.floor, a);
      return floor === s.floor || !floor ? s : { ...s, floor };
    }
  }
}