/**
 * Presence and status engine (D-062). Pure and deterministic: no I/O, the caller passes `now`.
 * The server keeps one `PresenceState` per user (Redis), feeds every observed fact through `reduce()`
 * and publishes the returned change. Presence decisions never trust the client clock: heartbeat,
 * idle, session, manual and attendance inputs carry the SERVER receive time; call events carry the
 * device time, used only to order the events of one call and to start the call timer.
 *
 * STATUS RULES (highest first)
 *   1. on_call      a live call is open (Android phone state or telephony "started", no "ended" yet).
 *                   Wins over everything, also without a heartbeat: the call itself is proof of activity.
 *   2. manual       the employee's own choice: in_meeting, field_visit, on_break, lunch, away, offline.
 *                   One at a time (the latest choice). It holds without a heartbeat (someone in a
 *                   meeting may close the laptop) until its lifetime ends, but after MANUAL_STALE_MS
 *                   (2 h) without any sign of life it shows offline. "offline" is invisible mode.
 *   3. field_visit  AUTO: field staff, checked in, inside working hours, online, no manual status
 *                   (picking "available" turns the auto field visit off for that working day)
 *   4. available    online and at least one device active (web tab visible and not idle, app in front)
 *   5. away         online but every device idle or hidden
 *   6. offline      no heartbeat from any device for PRESENCE_TIMEOUT_MS (45 s), or every session
 *                   logged out. `since` = last heartbeat + 45 s (or the logout time), never the sweep
 *                   time, so it does not depend on sweeper jitter. Shown with lastSeenAt.
 *   A call ending restores the manual status, otherwise the heartbeat-based status.
 *
 * LIFETIMES
 * - A manual status lasts until the user picks another one ("available" clears it), the last session
 *   logs out, attendance check-out, or the end of its working day: the end of the working window it
 *   was set in, or the next local midnight when it was set outside working hours.
 * - The auto field visit stops at check-out and at the end of working hours.
 * - A live call closes on "ended", on a device call-log entry that ended after the call started (one
 *   SIM call at a time), or by the SAFETY TIMEOUT: the device that reported the call has been silent
 *   (no heartbeat, no call event) for CALL_ORPHAN_MS (120 s), or the call is older than CALL_MAX_MS (3 h).
 * - Login alone does not make anyone online; the first heartbeat does.
 *
 * ORDERING AND IDEMPOTENCY
 * - An input may carry `eventId`; ids seen recently (last 64) are ignored.
 * - A heartbeat older than the device's last beat, older than the timeout, or from a session that
 *   logged out (in-flight beats after a logout) is ignored.
 * - Manual and attendance inputs older than the current value are ignored.
 * - "ended" before "started" for the same call: the end is remembered (last 32 calls) and the late
 *   "started" is dropped. A second "started" for an open call is a no-op.
 * - Two devices of one user are tracked separately; the user is online while any device is.
 * - `version` grows by exactly 1 per visible change (status, call or lead of the activity, manual
 *   note, screen); clients drop events whose version is not above the one they hold. A screen-only
 *   change is published but writes no history row (`historic: false`).
 *
 * WHAT AND WHERE
 * - `screen` (AppScreen) comes with heartbeats; the newest device that reported one wins. Offline
 *   users show no screen.
 * - The office zone (zone-engine.ts) rides in the same state and lock; it is NOT versioned and
 *   publishes `employee.zone_changed` (one net change per input). Going offline clears it.
 */
import { checkWorkingHours, nextLocalMidnight, type WorkingHoursConfig } from './working-hours.js';
import { clearZone, expireZone, reduceZone, zoneDeadline, type ZoneChange, type ZoneCurrent, type ZoneObservation, type ZoneSource, type ZoneState } from './zone-engine.js';

/** Literals equal packages/shared PRESENCE_STATUSES / MANUAL_PRESENCE_STATUSES / PRESENCE_SOURCES / CLIENT_KINDS. */
export const PRESENCE_STATUSES = ['available', 'on_call', 'in_meeting', 'on_break', 'lunch', 'field_visit', 'away', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export const MANUAL_STATUSES = ['available', 'in_meeting', 'on_break', 'lunch', 'field_visit', 'away', 'offline'] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];

export const STATUS_SOURCES = ['session', 'heartbeat', 'manual', 'phone_state', 'call_log', 'telephony', 'attendance', 'working_hours', 'timeout', 'system'] as const;
export type StatusSource = (typeof STATUS_SOURCES)[number];

export type ClientKind = 'web' | 'android';
export type DeviceActivity = 'active' | 'idle' | 'hidden';
export type CallSignal = 'phone_state' | 'telephony';

/** No heartbeat for this long -> offline (SPEC 29.2). */
export const PRESENCE_TIMEOUT_MS = 45_000;
/** A manual status with no sign of life for this long shows offline. */
export const MANUAL_STALE_MS = 2 * 3_600_000;
/** A live call whose device is silent this long is closed. */
export const CALL_ORPHAN_MS = 120_000;
/** Hard limit for a live call without "ended" or a call log. */
export const CALL_MAX_MS = 3 * 3_600_000;
/** A call-log entry also closes live calls that started up to this long after the logged end (clock skew). */
export const CALL_LOG_SKEW_MS = 5_000;
const SEEN_IDS = 64;
const ENDED_CALLS = 32;
const LOGGED_OUT = 16;

export interface DeviceState {
  client: ClientKind;
  sessionId: string | null;
  lastBeatAt: number;
  activity: DeviceActivity;
  /** Screen the client reported last (AppScreen); null/absent = not reported. */
  screen?: string | null;
  /** The app's own device id (POST /me/devices or installation id), for matching its live calls. */
  appDeviceId?: string | null;
}

export interface LiveCall {
  callId: string;
  deviceId: string | null;
  leadId: string | null;
  leadName: string | null;
  signal: CallSignal;
  /** Device time of the call start (call timer). */
  startedAt: number;
  /** Server time the start was received (CALL_MAX_MS base). */
  receivedAt: number;
  /** Last sign of life of the reporting device (CALL_ORPHAN_MS base). */
  lastSignAt: number;
}

export interface ManualState {
  status: ManualStatus;
  note: string | null;
  setAt: number;
  /** End of its working day (UTC ms). */
  until: number;
}

export interface PresenceActivity {
  kind: 'call' | 'meeting' | 'break' | 'lunch' | 'field_visit' | 'away' | null;
  callId: string | null;
  leadId: string | null;
  leadName: string | null;
  /** Call start, manual status time or check-in time; null when there is no activity. */
  startedAt: number | null;
  /** Client of the newest heartbeat and what it reported, at the time of the change. */
  client: ClientKind | null;
  clientActivity: DeviceActivity | null;
  note: string | null;
  /** Screen of the newest device that reported one (web or app); null when offline or unknown. */
  screen?: string | null;
}

export interface PresenceState {
  userId: string;
  version: number;
  status: PresenceStatus;
  since: number;
  source: StatusSource;
  /** Visible activity at `version` (what clients render). */
  activity: PresenceActivity;
  lastSeenAt: number | null;
  lastHeartbeatAt: number | null;
  devices: Record<string, DeviceState>;
  /** Logged-out sessions (sessionId -> logout time); their heartbeats are refused. */
  loggedOut: Record<string, number>;
  calls: Record<string, LiveCall>;
  /** Recently ended calls (callId -> end time) to drop late "started" events. */
  endedCalls: Record<string, number>;
  manual: ManualState | null;
  attendance: { checkedIn: boolean; at: number } | null;
  /** Fields as published with `version` (the view of an offline user never moves without an event). */
  shown: { manualStatus: ManualStatus | null; lastSeenAt: number | null; lastHeartbeatAt: number | null };
  seen: string[];
  /** Office zone (zone-engine.ts); changes publish employee.zone_changed and do not move the version. */
  zone?: ZoneState | null;
}

export interface PresenceContext {
  workingHours: WorkingHoursConfig;
  fieldStaff: boolean;
}

export type PresenceInput = { eventId?: string | null } & (
  | { type: 'heartbeat'; deviceId: string; client: ClientKind; sessionId?: string | null; activity: DeviceActivity; at: number; screen?: string | null; appDeviceId?: string | null; zone?: ZoneObservation[] }
  | { type: 'zone'; observations: ZoneObservation[] }
  | { type: 'idle'; deviceId: string; idle: boolean; at: number }
  | { type: 'login'; sessionId: string; at: number }
  | { type: 'logout'; sessionId: string | null; deviceId?: string | null; at: number }
  | { type: 'call_started'; callId: string; signal?: CallSignal; deviceId?: string | null; leadId?: string | null; leadName?: string | null; at: number }
  | { type: 'call_ended'; callId: string; signal?: CallSignal; at: number }
  | { type: 'call_log'; deviceId?: string | null; callId?: string | null; startedAt: number; endedAt: number }
  | { type: 'manual'; status: ManualStatus; note?: string | null; at: number }
  | { type: 'check_in'; at: number }
  | { type: 'check_out'; at: number }
  | { type: 'tick' }
);

/** What clients render for one person (snapshot row and event payload). */
export interface PresenceView {
  userId: string;
  version: number;
  status: PresenceStatus;
  since: number;
  source: StatusSource;
  manualStatus: ManualStatus | null;
  lastSeenAt: number | null;
  lastHeartbeatAt: number | null;
  activity: PresenceActivity;
  /** Current office zone (not versioned; see zone-engine.ts). */
  zone: ZoneCurrent | null;
}

export interface StatusChange {
  previousStatus: PresenceStatus;
  view: PresenceView;
  /** False when only the screen moved: published and versioned, but no history row. */
  historic: boolean;
}

export interface ReduceResult {
  state: PresenceState;
  /** Set when the visible status changed: write one history row and publish one event. */
  change: StatusChange | null;
  /** True when the input carried no new fact (duplicate, stale or out of order). */
  ignored: boolean;
  /** Set when the office zone changed (net, from the zone clients last saw): publish employee.zone_changed. */
  zoneChange: ZoneChange | null;
}

export const NO_ACTIVITY: PresenceActivity = Object.freeze({ kind: null, callId: null, leadId: null, leadName: null, startedAt: null, client: null, clientActivity: null, note: null, screen: null });

export function initialState(userId: string, now: number, opts: { version?: number; lastSeenAt?: number | null } = {}): PresenceState {
  return {
    userId,
    version: opts.version ?? 0,
    status: 'offline',
    since: now,
    source: 'system',
    activity: { ...NO_ACTIVITY },
    lastSeenAt: opts.lastSeenAt ?? null,
    lastHeartbeatAt: null,
    devices: {},
    loggedOut: {},
    calls: {},
    endedCalls: {},
    manual: null,
    attendance: null,
    shown: { manualStatus: null, lastSeenAt: opts.lastSeenAt ?? null, lastHeartbeatAt: null },
    seen: [],
  };
}

const clone = (s: PresenceState): PresenceState => ({
  ...s,
  activity: { ...s.activity },
  devices: { ...s.devices },
  loggedOut: { ...s.loggedOut },
  calls: { ...s.calls },
  endedCalls: { ...s.endedCalls },
  manual: s.manual ? { ...s.manual } : null,
  attendance: s.attendance ? { ...s.attendance } : null,
  shown: { ...s.shown },
  seen: [...s.seen],
  zone: s.zone ?? null,
});

function capRecord(rec: Record<string, number>, max: number): Record<string, number> {
  const entries = Object.entries(rec);
  if (entries.length <= max) return rec;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, max));
}

/** End of the working day a manual status set at `at` belongs to. */
export function manualUntil(at: number, ctx: PresenceContext): number {
  const check = checkWorkingHours(at, ctx.workingHours);
  return check.open ? check.window.end : nextLocalMidnight(at, ctx.workingHours.timezone);
}

const isOnline = (d: DeviceState, now: number) => now - d.lastBeatAt < PRESENCE_TIMEOUT_MS;
const callExpired = (c: LiveCall, now: number) => now - c.receivedAt >= CALL_MAX_MS || now - c.lastSignAt >= CALL_ORPHAN_MS;

/** Drop what time alone has ended: silent devices, orphaned calls, a manual status past its day, an old zone. */
function expire(s: PresenceState, now: number, zoneOps?: ZoneChange[]): void {
  if (s.zone) {
    const z = expireZone(s.zone, now);
    s.zone = z.state;
    if (z.change) zoneOps?.push(z.change);
  }
  for (const [id, c] of Object.entries(s.calls)) {
    if (callExpired(c, now)) {
      delete s.calls[id];
      s.endedCalls[id] = c.startedAt + Math.max(0, now - c.receivedAt);
    }
  }
  s.endedCalls = capRecord(s.endedCalls, ENDED_CALLS);
  for (const [id, d] of Object.entries(s.devices)) if (!isOnline(d, now)) delete s.devices[id];
  if (s.manual && now >= s.manual.until) s.manual = null;
}

function currentCall(s: PresenceState): LiveCall | null {
  let best: LiveCall | null = null;
  for (const c of Object.values(s.calls)) {
    if (!best || c.startedAt > best.startedAt || (c.startedAt === best.startedAt && c.callId > best.callId)) best = c;
  }
  return best;
}

function newestDevice(s: PresenceState): DeviceState | null {
  let best: DeviceState | null = null;
  for (const d of Object.values(s.devices)) if (!best || d.lastBeatAt > best.lastBeatAt) best = d;
  return best;
}

/** Screen of the newest device that reported one (the newest signal wins per field). */
function newestScreen(s: PresenceState): string | null {
  let best: DeviceState | null = null;
  for (const d of Object.values(s.devices)) if (d.screen && (!best || d.lastBeatAt > best.lastBeatAt)) best = d;
  return best?.screen ?? null;
}

const MANUAL_ACTIVITY: Record<Exclude<ManualStatus, 'available' | 'offline'>, NonNullable<PresenceActivity['kind']>> = {
  in_meeting: 'meeting',
  field_visit: 'field_visit',
  on_break: 'break',
  lunch: 'lunch',
  away: 'away',
};

interface Derived {
  status: PresenceStatus;
  activity: PresenceActivity;
}

/** The status the rules give for an (already expired) state at `now`. */
export function derive(s: PresenceState, now: number, ctx: PresenceContext): Derived {
  const device = newestDevice(s);
  const base = { ...NO_ACTIVITY, client: device?.client ?? null, clientActivity: device?.activity ?? null, note: s.manual?.note ?? null, screen: newestScreen(s) };
  const call = currentCall(s);
  if (call) {
    return {
      status: 'on_call',
      activity: { ...base, kind: 'call', callId: call.callId, leadId: call.leadId, leadName: call.leadName, startedAt: Math.min(call.startedAt, call.receivedAt) },
    };
  }
  const online = Object.values(s.devices).filter((d) => isOnline(d, now));
  const m = s.manual;
  if (m && m.status === 'offline') return { status: 'offline', activity: { ...base, client: null, clientActivity: null, screen: null } };
  if (m && m.status !== 'available') {
    const silentTooLong = online.length === 0 && (s.lastSeenAt ?? m.setAt) + MANUAL_STALE_MS <= now;
    if (!silentTooLong) return { status: m.status, activity: { ...base, kind: MANUAL_ACTIVITY[m.status as keyof typeof MANUAL_ACTIVITY], startedAt: m.setAt } };
  }
  if (online.length === 0) return { status: 'offline', activity: { ...base, client: null, clientActivity: null, screen: null } };
  if (ctx.fieldStaff && !m && s.attendance?.checkedIn && checkWorkingHours(now, ctx.workingHours).open) {
    return { status: 'field_visit', activity: { ...base, kind: 'field_visit', startedAt: s.attendance.at } };
  }
  return { status: online.some((d) => d.activity === 'active') ? 'available' : 'away', activity: base };
}

/**
 * The client view of a stored state, purely from published fields, so a client applying events ends
 * with the same view as a fresh snapshot. Online users show the live last-seen times (informational;
 * they move with every heartbeat); offline users show the values published with the change, which
 * also keeps invisible mode ("offline" by choice) from leaking activity.
 */
export function viewOf(s: PresenceState): PresenceView {
  const offline = s.status === 'offline';
  return {
    userId: s.userId,
    version: s.version,
    status: s.status,
    since: s.since,
    source: s.source,
    manualStatus: s.shown.manualStatus,
    lastSeenAt: offline ? s.shown.lastSeenAt : s.lastSeenAt,
    lastHeartbeatAt: offline ? s.shown.lastHeartbeatAt : s.lastHeartbeatAt,
    activity: { ...s.activity, screen: s.activity.screen ?? null },
    zone: offline ? null : (s.zone?.current ?? null),
  };
}

function sourceOf(input: PresenceInput, prev: PresenceStatus, next: PresenceStatus): StatusSource {
  switch (input.type) {
    case 'heartbeat':
    case 'idle':
    case 'zone':
      return 'heartbeat';
    case 'login':
    case 'logout':
      return 'session';
    case 'call_started':
    case 'call_ended':
      return input.signal ?? 'phone_state';
    case 'call_log':
      return 'call_log';
    case 'manual':
      return 'manual';
    case 'check_in':
    case 'check_out':
      return 'attendance';
    case 'tick':
      return next === 'offline' || prev === 'on_call' ? 'timeout' : 'working_hours';
  }
}

/** History-worthy change = status, the call or lead of the activity, the activity kind or the manual note. */
const sameActivity = (a: PresenceActivity, b: PresenceActivity) => a.kind === b.kind && a.callId === b.callId && a.leadId === b.leadId && a.note === b.note;
/** Visible change = the above or the screen (the screen is versioned and published, not kept in history). */
const sameView = (a: PresenceActivity, b: PresenceActivity) => sameActivity(a, b) && (a.screen ?? null) === (b.screen ?? null);

/** Apply one input. Returns the new state and, when the visible status changed, the change to publish. */
export function reduce(prev: PresenceState, input: PresenceInput, ctx: PresenceContext, now: number): ReduceResult {
  if (input.eventId && prev.seen.includes(input.eventId)) return { state: prev, change: null, ignored: true, zoneChange: null };
  const s = clone(prev);
  if (input.eventId) s.seen = [...s.seen, input.eventId].slice(-SEEN_IDS);
  const zoneOps: ZoneChange[] = [];
  const zoneBefore = prev.status === 'offline' ? null : (prev.zone?.current?.zoneId ?? null);

  expire(s, now, zoneOps);
  const applied = apply(s, input, ctx, now, zoneOps);
  expire(s, now, zoneOps);

  const d = derive(s, now, ctx);
  // Offline (timeout, logout, invisible mode) forgets the office zone: nobody is shown in a room.
  if (d.status === 'offline' && s.zone?.current) {
    const r = clearZone(s.zone, now);
    s.zone = r.state;
    if (r.change) zoneOps.push(r.change);
  }
  const zoneChange = netZoneChange(zoneBefore, s, zoneOps, now);
  const manualStatus = s.manual?.status ?? null;
  if (d.status === s.status && sameView(d.activity, s.activity) && manualStatus === s.shown.manualStatus) {
    // Same visible status: keep the stored activity (its startedAt is what clients already show).
    return { state: s, change: null, ignored: !applied && !zoneChange, zoneChange };
  }

  const previousStatus = s.status;
  const historic = d.status !== previousStatus || !sameActivity(d.activity, s.activity) || manualStatus !== s.shown.manualStatus;
  if (!historic) {
    // Only the screen moved: keep the activity's start time, update the screen.
    s.version += 1;
    s.source = sourceOf(input, previousStatus, d.status);
    s.activity = { ...s.activity, screen: d.activity.screen ?? null, client: d.activity.client, clientActivity: d.activity.clientActivity };
    s.shown = { manualStatus, lastSeenAt: s.lastSeenAt, lastHeartbeatAt: s.lastHeartbeatAt };
    return { state: s, change: { previousStatus, view: viewOf(s), historic: false }, ignored: false, zoneChange };
  }
  s.version += 1;
  s.source = sourceOf(input, previousStatus, d.status);
  if (d.status !== previousStatus) s.since = d.status === 'offline' ? offlineSince(prev, s, input, now) : now;
  s.status = d.status;
  s.activity = d.activity;
  s.shown = { manualStatus, lastSeenAt: s.lastSeenAt, lastHeartbeatAt: s.lastHeartbeatAt };
  return { state: s, change: { previousStatus, view: viewOf(s), historic: true }, ignored: false, zoneChange };
}

/** One zone change from the zone clients last saw to the zone now (several steps in one input publish once). */
function netZoneChange(before: string | null, s: PresenceState, ops: readonly ZoneChange[], now: number): ZoneChange | null {
  const cur = s.zone?.current ?? null;
  const after = cur?.zoneId ?? null;
  if (after === before) return null;
  const source: ZoneSource = cur?.source ?? ops.at(-1)?.source ?? 'manual';
  return { zoneId: after, previousZoneId: before, source, confidence: cur ? cur.confidence : 0, at: now };
}

function applyZone(s: PresenceState, observations: readonly ZoneObservation[], now: number, ops: ZoneChange[]): boolean {
  let applied = false;
  for (const obs of observations) {
    const r = reduceZone(s.zone, obs, now);
    s.zone = r.state;
    if (r.change) ops.push(r.change);
    applied = applied || !r.ignored;
  }
  return applied;
}

/**
 * Offline since: the logout time, or the last sign of life + timeout (independent of sweep jitter).
 * Leaving a call or a manual status (timeout, invisible mode) uses `now`.
 */
function offlineSince(prev: PresenceState, s: PresenceState, input: PresenceInput, now: number): number {
  if (input.type === 'logout') return Math.max(prev.since, Math.min(now, input.at));
  if (prev.status !== 'available' && prev.status !== 'away' && prev.status !== 'field_visit') return now;
  if (input.type === 'manual') return now;
  const lastSign = s.lastHeartbeatAt ?? s.lastSeenAt ?? prev.since;
  return Math.min(now, Math.max(prev.since, lastSign + PRESENCE_TIMEOUT_MS));
}

const seenNow = (s: PresenceState, at: number) => {
  if (s.lastSeenAt === null || at > s.lastSeenAt) s.lastSeenAt = at;
};

/** Mutates `s`. Returns false when the input carried no new fact (stale, duplicate, refused). */
function apply(s: PresenceState, input: PresenceInput, ctx: PresenceContext, now: number, zoneOps: ZoneChange[] = []): boolean {
  switch (input.type) {
    case 'heartbeat': {
      if (input.sessionId && s.loggedOut[input.sessionId] !== undefined) return false;
      const existing = s.devices[input.deviceId];
      if (existing && existing.lastBeatAt > input.at) return false;
      if (now - input.at >= PRESENCE_TIMEOUT_MS) return false;
      const appDeviceId = input.appDeviceId ?? existing?.appDeviceId ?? null;
      s.devices[input.deviceId] = {
        client: input.client,
        sessionId: input.sessionId ?? existing?.sessionId ?? null,
        lastBeatAt: input.at,
        activity: input.activity,
        screen: input.screen !== undefined ? input.screen : (existing?.screen ?? null),
        appDeviceId,
      };
      for (const [id, c] of Object.entries(s.calls)) {
        const sameDevice = c.deviceId === input.deviceId || (appDeviceId !== null && c.deviceId === appDeviceId) || (c.deviceId === null && input.client === 'android');
        if (sameDevice && input.at > c.lastSignAt) s.calls[id] = { ...c, lastSignAt: input.at };
      }
      if (s.lastHeartbeatAt === null || input.at > s.lastHeartbeatAt) s.lastHeartbeatAt = input.at;
      seenNow(s, input.at);
      if (input.zone?.length) applyZone(s, input.zone, now, zoneOps);
      return true;
    }
    case 'zone':
      return applyZone(s, input.observations, now, zoneOps);
    case 'idle': {
      const d = s.devices[input.deviceId];
      if (!d || d.lastBeatAt > input.at) return false;
      s.devices[input.deviceId] = { ...d, lastBeatAt: input.at, activity: input.idle ? 'idle' : 'active' };
      if (s.lastHeartbeatAt === null || input.at > s.lastHeartbeatAt) s.lastHeartbeatAt = input.at;
      seenNow(s, input.at);
      return true;
    }
    case 'login':
      delete s.loggedOut[input.sessionId];
      return true;
    case 'logout': {
      let removed = false;
      for (const [id, d] of Object.entries(s.devices)) {
        const match = (input.sessionId !== null && d.sessionId === input.sessionId) || (input.deviceId && id === input.deviceId);
        if (match && d.lastBeatAt <= input.at) {
          delete s.devices[id];
          removed = true;
        }
      }
      if (input.sessionId) s.loggedOut = capRecord({ ...s.loggedOut, [input.sessionId]: input.at }, LOGGED_OUT);
      if (Object.keys(s.devices).length === 0 && s.manual && s.manual.setAt <= input.at) s.manual = null;
      return removed || input.sessionId !== null;
    }
    case 'call_started': {
      if (s.calls[input.callId] || s.endedCalls[input.callId] !== undefined) return false;
      if (now - input.at >= CALL_MAX_MS) return false;
      s.calls[input.callId] = {
        callId: input.callId,
        deviceId: input.deviceId ?? null,
        leadId: input.leadId ?? null,
        leadName: input.leadName ?? null,
        signal: input.signal ?? 'phone_state',
        startedAt: input.at,
        receivedAt: now,
        lastSignAt: now,
      };
      seenNow(s, now);
      return true;
    }
    case 'call_ended': {
      const open = Boolean(s.calls[input.callId]);
      if (!open && s.endedCalls[input.callId] !== undefined) return false;
      delete s.calls[input.callId];
      s.endedCalls = capRecord({ ...s.endedCalls, [input.callId]: input.at }, ENDED_CALLS);
      if (open) seenNow(s, now);
      return true;
    }
    case 'call_log': {
      let closed = false;
      for (const [id, c] of Object.entries(s.calls)) {
        const sameDevice = !input.deviceId || !c.deviceId || c.deviceId === input.deviceId;
        if ((input.callId && id === input.callId) || (c.signal === 'phone_state' && sameDevice && c.startedAt <= input.endedAt + CALL_LOG_SKEW_MS)) {
          delete s.calls[id];
          s.endedCalls[id] = input.endedAt;
          closed = true;
        }
      }
      if (input.callId && s.endedCalls[input.callId] === undefined) s.endedCalls[input.callId] = input.endedAt;
      s.endedCalls = capRecord(s.endedCalls, ENDED_CALLS);
      return closed;
    }
    case 'manual': {
      if (s.manual && s.manual.setAt > input.at) return false;
      const note = input.note?.trim() || null;
      if (input.status === 'available') {
        // Clears the manual status. For field staff a marker also turns the auto field visit off until
        // the end of the working day.
        s.manual = ctx.fieldStaff ? { status: 'available', note: null, setAt: input.at, until: manualUntil(input.at, ctx) } : null;
        return true;
      }
      s.manual = { status: input.status, note, setAt: input.at, until: manualUntil(input.at, ctx) };
      return true;
    }
    case 'check_in':
      if (s.attendance && s.attendance.at > input.at) return false;
      s.attendance = { checkedIn: true, at: input.at };
      seenNow(s, input.at);
      return true;
    case 'check_out':
      if (s.attendance && s.attendance.at > input.at) return false;
      s.attendance = { checkedIn: false, at: input.at };
      if (s.manual && s.manual.setAt <= input.at) s.manual = null;
      seenNow(s, input.at);
      return true;
    case 'tick':
      return true;
  }
}

/**
 * Earliest instant after `now` at which the status can change with no new input (heartbeat timeout,
 * call safety timeout, manual expiry or staleness, working-hours edge of the auto field visit). The
 * sweeper keys its sorted set on this. Null = nothing pending.
 */
export function nextDeadline(s: PresenceState, ctx: PresenceContext, now: number): number | null {
  const candidates: number[] = [];
  for (const d of Object.values(s.devices)) candidates.push(d.lastBeatAt + PRESENCE_TIMEOUT_MS);
  for (const c of Object.values(s.calls)) candidates.push(c.receivedAt + CALL_MAX_MS, c.lastSignAt + CALL_ORPHAN_MS);
  if (s.manual) {
    candidates.push(s.manual.until);
    if (s.manual.status !== 'available' && s.manual.status !== 'offline') candidates.push((s.lastSeenAt ?? s.manual.setAt) + MANUAL_STALE_MS);
  }
  if (ctx.fieldStaff && s.attendance?.checkedIn) {
    const check = checkWorkingHours(now, ctx.workingHours);
    if (check.open) candidates.push(check.window.end);
    else if (check.nextStart !== null) candidates.push(check.nextStart);
  }
  const zd = zoneDeadline(s.zone);
  if (zd !== null) candidates.push(zd);
  const future = candidates.filter((t) => t > now);
  return future.length ? Math.min(...future) : null;
}

/** Apply a published view to a client-side map, dropping stale versions (the reference client reducer). */
export function applyView(map: Map<string, PresenceView>, view: PresenceView): boolean {
  const held = map.get(view.userId);
  if (held && held.version >= view.version) return false;
  map.set(view.userId, view);
  return true;
}
