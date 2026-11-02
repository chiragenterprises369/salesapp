/**
 * Presence and status engine (D-062). Pure and deterministic: no I/O, the caller passes `now`.
 * The server keeps one `PresenceState` per user (Redis), feeds every observed fact through `reduce()`
 * and publishes the returned change. Presence decisions never trust the client clock: heartbeat,
 * idle, session, manual and attendance inputs carry the SERVER receive time; call events carry the
 * device time, used only to order the events of one call and to start the call timer.
 *
 * STATUS RULES (highest first)
 *   1. on_call      a live call is open (Android phone state "started", no "ended" yet). Wins over
 *                   everything, also without a heartbeat: the call itself is proof of activity.
 *   2. in_meeting   manual "meeting"                          \  need the user online (rule 7).
 *   3. field_visit  manual "field visit"                       | One manual status at a time: the
 *   4. on_break, lunch  manual                                 | employee's latest choice.
 *   5. field_visit  AUTO: field staff, checked in, inside working hours, online, and no manual
 *                   status (picking "available" turns the auto field visit off for that working day)
 *   6. available    online and at least one device active (web tab visible and not idle, app in front)
 *   7. away         online but every device idle or hidden
 *   8. offline      no heartbeat from any device for PRESENCE_TIMEOUT_MS (45 s), or every session
 *                   logged out. `since` = last heartbeat + 45 s (or the logout time), never the sweep
 *                   time, so it does not depend on sweeper jitter. Shown with lastSeenAt.
 *   A manual status is kept while offline and is shown again on the next heartbeat the same day.
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
 * - `version` grows by exactly 1 per visible change (status, call or lead of the activity); clients
 *   drop events whose version is not above the one they hold.
 */
import { checkWorkingHours, nextLocalMidnight, type WorkingHoursConfig } from './working-hours.js';

export const PRESENCE_STATUSES = ['on_call', 'in_meeting', 'field_visit', 'on_break', 'lunch', 'available', 'away', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export const MANUAL_STATUSES = ['in_meeting', 'field_visit', 'on_break', 'lunch', 'available'] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];

export const STATUS_SOURCES = ['heartbeat', 'session', 'call', 'call_log', 'manual', 'attendance', 'timeout', 'working_hours'] as const;
export type StatusSource = (typeof STATUS_SOURCES)[number];

/** No heartbeat for this long -> offline (SPEC 29.2). */
export const PRESENCE_TIMEOUT_MS = 45_000;
/** A live call whose device is silent this long is closed. */
export const CALL_ORPHAN_MS = 120_000;
/** Hard limit for a live call without "ended" or a call log. */
export const CALL_MAX_MS = 3 * 3_600_000;
/** A call-log entry also closes live calls that started up to this long after the logged end (clock skew). */
export const CALL_LOG_SKEW_MS = 5_000;
const SEEN_IDS = 64;
const ENDED_CALLS = 32;
const LOGGED_OUT = 16;

export type ClientKind = 'web' | 'app';
export type DeviceActivity = 'active' | 'idle' | 'hidden';

export interface DeviceState {
  kind: ClientKind;
  sessionId: string | null;
  lastBeatAt: number;
  activity: DeviceActivity;
}

export interface LiveCall {
  callId: string;
  deviceId: string | null;
  leadId: string | null;
  leadName: string | null;
  /** Device time of the call start (call timer). */
  startedAt: number;
  /** Server time the start was received (CALL_MAX_MS base). */
  receivedAt: number;
  /** Last sign of life of the reporting device (CALL_ORPHAN_MS base). */
  lastSignAt: number;
}

export interface ManualState {
  status: ManualStatus;
  setAt: number;
  /** End of its working day (UTC ms). */
  until: number;
}

export interface PresenceActivity {
  kind: 'call' | 'meeting' | 'break' | 'lunch' | 'field_visit';
  callId: string | null;
  leadId: string | null;
  leadName: string | null;
  startedAt: number;
}

export interface PresenceState {
  userId: string;
  version: number;
  status: PresenceStatus;
  since: number;
  source: StatusSource;
  /** Visible activity at `version` (what clients render). */
  activity: PresenceActivity | null;
  lastSeenAt: number | null;
  devices: Record<string, DeviceState>;
  /** Logged-out sessions (sessionId -> logout time); their heartbeats are refused. */
  loggedOut: Record<string, number>;
  calls: Record<string, LiveCall>;
  /** Recently ended calls (callId -> end time) to drop late "started" events. */
  endedCalls: Record<string, number>;
  manual: ManualState | null;
  attendance: { checkedIn: boolean; at: number } | null;
  seen: string[];
}

export interface PresenceContext {
  workingHours: WorkingHoursConfig;
  fieldStaff: boolean;
}

export type PresenceInput = { eventId?: string | null } & (
  | { type: 'heartbeat'; deviceId: string; client: ClientKind; sessionId?: string | null; activity: DeviceActivity; at: number }
  | { type: 'idle'; deviceId: string; idle: boolean; at: number }
  | { type: 'login'; sessionId: string; at: number }
  | { type: 'logout'; sessionId: string | null; deviceId?: string | null; at: number }
  | { type: 'call_started'; callId: string; deviceId?: string | null; leadId?: string | null; leadName?: string | null; at: number }
  | { type: 'call_ended'; callId: string; at: number }
  | { type: 'call_log'; deviceId?: string | null; callId?: string | null; startedAt: number; endedAt: number }
  | { type: 'manual'; status: ManualStatus; at: number }
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
  lastSeenAt: number | null;
  activity: PresenceActivity | null;
}

export interface StatusChange {
  previousStatus: PresenceStatus;
  view: PresenceView;
}

export interface ReduceResult {
  state: PresenceState;
  /** Set when the visible status changed: write one history row and publish one event. */
  change: StatusChange | null;
  /** True when the input carried no new fact (duplicate, stale or out of order). */
  ignored: boolean;
}

export function initialState(userId: string, now: number, opts: { version?: number; lastSeenAt?: number | null } = {}): PresenceState {
  return {
    userId,
    version: opts.version ?? 0,
    status: 'offline',
    since: now,
    source: 'session',
    activity: null,
    lastSeenAt: opts.lastSeenAt ?? null,
    devices: {},
    loggedOut: {},
    calls: {},
    endedCalls: {},
    manual: null,
    attendance: null,
    seen: [],
  };
}

const clone = (s: PresenceState): PresenceState => ({
  ...s,
  activity: s.activity ? { ...s.activity } : null,
  devices: { ...s.devices },
  loggedOut: { ...s.loggedOut },
  calls: { ...s.calls },
  endedCalls: { ...s.endedCalls },
  manual: s.manual ? { ...s.manual } : null,
  attendance: s.attendance ? { ...s.attendance } : null,
  seen: [...s.seen],
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

/** Drop what time alone has ended: silent devices, orphaned calls, a manual status past its day. */
function expire(s: PresenceState, now: number): void {
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

const MANUAL_ACTIVITY: Record<Exclude<ManualStatus, 'available'>, PresenceActivity['kind']> = {
  in_meeting: 'meeting',
  field_visit: 'field_visit',
  on_break: 'break',
  lunch: 'lunch',
};

interface Derived {
  status: PresenceStatus;
  activity: PresenceActivity | null;
}

/** The status the rules give for an (already expired) state at `now`. */
export function derive(s: PresenceState, now: number, ctx: PresenceContext): Derived {
  const call = currentCall(s);
  if (call) {
    return {
      status: 'on_call',
      activity: { kind: 'call', callId: call.callId, leadId: call.leadId, leadName: call.leadName, startedAt: Math.min(call.startedAt, call.receivedAt) },
    };
  }
  const online = Object.values(s.devices).filter((d) => isOnline(d, now));
  if (online.length === 0) return { status: 'offline', activity: null };
  const m = s.manual;
  if (m && m.status !== 'available') {
    return { status: m.status, activity: { kind: MANUAL_ACTIVITY[m.status], callId: null, leadId: null, leadName: null, startedAt: m.setAt } };
  }
  if (ctx.fieldStaff && !m && s.attendance?.checkedIn && checkWorkingHours(now, ctx.workingHours).open) {
    return { status: 'field_visit', activity: { kind: 'field_visit', callId: null, leadId: null, leadName: null, startedAt: s.attendance.at } };
  }
  return { status: online.some((d) => d.activity === 'active') ? 'available' : 'away', activity: null };
}

/** The client view of a stored state. Purely from stored fields, so snapshots and events agree. */
export function viewOf(s: PresenceState): PresenceView {
  return { userId: s.userId, version: s.version, status: s.status, since: s.since, source: s.source, lastSeenAt: s.lastSeenAt, activity: s.activity };
}

function sourceOf(input: PresenceInput, prev: PresenceStatus, next: PresenceStatus): StatusSource {
  switch (input.type) {
    case 'heartbeat':
    case 'idle':
      return 'heartbeat';
    case 'login':
    case 'logout':
      return 'session';
    case 'call_started':
    case 'call_ended':
      return 'call';
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

const sameActivity = (a: PresenceActivity | null, b: PresenceActivity | null) =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.callId === b.callId && a.leadId === b.leadId);

/** Apply one input. Returns the new state and, when the visible status changed, the change to publish. */
export function reduce(prev: PresenceState, input: PresenceInput, ctx: PresenceContext, now: number): ReduceResult {
  if (input.eventId && prev.seen.includes(input.eventId)) return { state: prev, change: null, ignored: true };
  const s = clone(prev);
  if (input.eventId) s.seen = [...s.seen, input.eventId].slice(-SEEN_IDS);

  expire(s, now);
  const applied = apply(s, input, ctx, now);
  expire(s, now);

  const d = derive(s, now, ctx);
  if (d.status === s.status && sameActivity(d.activity, s.activity)) {
    // Same status: keep the stored activity (its startedAt is what clients already show).
    return { state: s, change: null, ignored: !applied };
  }

  const previousStatus = s.status;
  s.version += 1;
  s.source = sourceOf(input, previousStatus, d.status);
  if (d.status !== previousStatus) s.since = d.status === 'offline' ? offlineSince(prev, s, input, now) : now;
  s.status = d.status;
  s.activity = d.activity;
  return { state: s, change: { previousStatus, view: viewOf(s) }, ignored: false };
}

/**
 * Offline since: the logout time, or the last sign of life + timeout (independent of sweep jitter).
 * Leaving a call by its safety timeout uses `now`: the call was the evidence until it expired.
 */
function offlineSince(prev: PresenceState, s: PresenceState, input: PresenceInput, now: number): number {
  if (input.type === 'logout') return Math.max(prev.since, Math.min(now, input.at));
  if (prev.status === 'on_call') return now;
  const lastSign = s.lastSeenAt ?? prev.since;
  return Math.min(now, Math.max(prev.since, lastSign + PRESENCE_TIMEOUT_MS));
}

const seenNow = (s: PresenceState, at: number) => {
  if (s.lastSeenAt === null || at > s.lastSeenAt) s.lastSeenAt = at;
};

/** Mutates `s`. Returns false when the input carried no new fact (stale, duplicate, refused). */
function apply(s: PresenceState, input: PresenceInput, ctx: PresenceContext, now: number): boolean {
  switch (input.type) {
    case 'heartbeat': {
      if (input.sessionId && s.loggedOut[input.sessionId] !== undefined) return false;
      const existing = s.devices[input.deviceId];
      if (existing && existing.lastBeatAt > input.at) return false;
      if (now - input.at >= PRESENCE_TIMEOUT_MS) return false;
      s.devices[input.deviceId] = { kind: input.client, sessionId: input.sessionId ?? existing?.sessionId ?? null, lastBeatAt: input.at, activity: input.activity };
      for (const [id, c] of Object.entries(s.calls)) {
        if ((c.deviceId === input.deviceId || (c.deviceId === null && input.client === 'app')) && input.at > c.lastSignAt) s.calls[id] = { ...c, lastSignAt: input.at };
      }
      seenNow(s, input.at);
      return true;
    }
    case 'idle': {
      const d = s.devices[input.deviceId];
      if (!d || d.lastBeatAt > input.at) return false;
      s.devices[input.deviceId] = { ...d, lastBeatAt: input.at, activity: input.idle ? 'idle' : 'active' };
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
        if ((input.callId && id === input.callId) || (sameDevice && c.startedAt <= input.endedAt + CALL_LOG_SKEW_MS)) {
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
      if (input.status === 'available') {
        // Clears the manual status. For field staff the marker also turns the auto field visit off
        // until the end of the working day.
        s.manual = ctx.fieldStaff ? { status: 'available', setAt: input.at, until: manualUntil(input.at, ctx) } : null;
        return true;
      }
      s.manual = { status: input.status, setAt: input.at, until: manualUntil(input.at, ctx) };
      return true;
    }
    case 'check_in':
      if (s.attendance && s.attendance.at > input.at) return false;
      s.attendance = { checkedIn: true, at: input.at };
      return true;
    case 'check_out':
      if (s.attendance && s.attendance.at > input.at) return false;
      s.attendance = { checkedIn: false, at: input.at };
      if (s.manual && s.manual.setAt <= input.at) s.manual = null;
      return true;
    case 'tick':
      return true;
  }
}

/**
 * Earliest instant after `now` at which the status can change with no new input (heartbeat timeout,
 * call safety timeout, manual expiry, working-hours edge of the auto field visit). The sweeper keys
 * its sorted set on this. Null = nothing pending.
 */
export function nextDeadline(s: PresenceState, ctx: PresenceContext, now: number): number | null {
  const candidates: number[] = [];
  for (const d of Object.values(s.devices)) candidates.push(d.lastBeatAt + PRESENCE_TIMEOUT_MS);
  for (const c of Object.values(s.calls)) candidates.push(c.receivedAt + CALL_MAX_MS, c.lastSignAt + CALL_ORPHAN_MS);
  if (s.manual) candidates.push(s.manual.until);
  if (ctx.fieldStaff && s.attendance?.checkedIn) {
    const check = checkWorkingHours(now, ctx.workingHours);
    if (check.open) candidates.push(check.window.end);
    else if (check.nextStart !== null) candidates.push(check.nextStart);
  }
  if (candidates.length === 0) return null;
  return Math.max(now + 1, Math.min(...candidates));
}

/** Apply a published view to a client-side map, dropping stale versions (the reference client reducer). */
export function applyView(map: Map<string, PresenceView>, view: PresenceView): boolean {
  const held = map.get(view.userId);
  if (held && held.version >= view.version) return false;
  map.set(view.userId, view);
  return true;
}
