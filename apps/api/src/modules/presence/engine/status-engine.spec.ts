import { DEFAULT_BUSINESS_HOURS } from '@vistar/shared';
import { describe, expect, it } from 'vitest';
import {
  applyView,
  CALL_MAX_MS,
  CALL_ORPHAN_MS,
  initialState,
  nextDeadline,
  PRESENCE_TIMEOUT_MS,
  reduce,
  viewOf,
  type PresenceContext,
  type PresenceInput,
  type PresenceState,
  type PresenceStatus,
  type PresenceView,
  type StatusChange,
} from './status-engine.js';

const t = (iso: string) => Date.parse(iso);
const S = 1000;
const MIN = 60 * S;
/** Monday 2026-11-02 11:00 IST (inside the default 09:30-18:30 hours). */
const T0 = t('2026-11-02T05:30:00Z');
const office: PresenceContext = { workingHours: { hours: DEFAULT_BUSINESS_HOURS, timezone: 'Asia/Kolkata', holidays: [] }, fieldStaff: false };
const field: PresenceContext = { ...office, fieldStaff: true };

/** Small driver: feeds inputs at server times and records every published change. */
class Run {
  state: PresenceState;
  changes: StatusChange[] = [];
  constructor(
    readonly ctx: PresenceContext = office,
    start = T0,
  ) {
    this.state = initialState('u1', start);
  }
  feed(input: PresenceInput, now: number) {
    const r = reduce(this.state, input, this.ctx, now);
    this.state = r.state;
    if (r.change) this.changes.push(r.change);
    return r;
  }
  beat(now: number, opts: Partial<{ deviceId: string; client: 'web' | 'app'; activity: 'active' | 'idle' | 'hidden'; sessionId: string; eventId: string }> = {}) {
    return this.feed({ type: 'heartbeat', deviceId: opts.deviceId ?? 'web-1', client: opts.client ?? 'web', activity: opts.activity ?? 'active', sessionId: opts.sessionId ?? 's1', at: now, eventId: opts.eventId }, now);
  }
  tick(now: number) {
    return this.feed({ type: 'tick' }, now);
  }
  get status(): PresenceStatus {
    return this.state.status;
  }
}

describe('status engine: heartbeats and offline timeout', () => {
  it('first heartbeat makes the user available (version 1, source heartbeat)', () => {
    const r = new Run();
    const res = r.beat(T0);
    expect(res.change?.view).toMatchObject({ status: 'available', version: 1, source: 'heartbeat', since: T0, lastSeenAt: T0 });
    expect(res.change?.previousStatus).toBe('offline');
  });

  it('repeated heartbeats do not emit', () => {
    const r = new Run();
    r.beat(T0);
    for (let i = 1; i <= 10; i++) expect(r.beat(T0 + i * 15 * S).change).toBeNull();
    expect(r.state.version).toBe(1);
    expect(r.state.lastSeenAt).toBe(T0 + 150 * S);
  });

  it('offline exactly 45 s after the last heartbeat, since = last beat + 45 s, even when the sweep is late', () => {
    const r = new Run();
    r.beat(T0);
    expect(r.tick(T0 + PRESENCE_TIMEOUT_MS - 1).change).toBeNull();
    const late = r.tick(T0 + PRESENCE_TIMEOUT_MS + 4 * S);
    expect(late.change?.view).toMatchObject({ status: 'offline', since: T0 + PRESENCE_TIMEOUT_MS, source: 'timeout', lastSeenAt: T0, version: 2 });
  });

  it('a heartbeat after offline brings the user back', () => {
    const r = new Run();
    r.beat(T0);
    r.tick(T0 + 60 * S);
    expect(r.beat(T0 + 70 * S).change?.view).toMatchObject({ status: 'available', version: 3 });
  });

  it('idle reports and hidden tabs make the user away; activity brings them back', () => {
    const r = new Run();
    r.beat(T0);
    expect(r.feed({ type: 'idle', deviceId: 'web-1', idle: true, at: T0 + 5 * S }, T0 + 5 * S).change?.view.status).toBe('away');
    expect(r.feed({ type: 'idle', deviceId: 'web-1', idle: false, at: T0 + 9 * S }, T0 + 9 * S).change?.view.status).toBe('available');
    expect(r.beat(T0 + 20 * S, { activity: 'hidden' }).change?.view.status).toBe('away');
  });

  it('stale heartbeats (older than the device last beat) are ignored', () => {
    const r = new Run();
    r.beat(T0 + 20 * S);
    const res = r.feed({ type: 'heartbeat', deviceId: 'web-1', client: 'web', activity: 'idle', at: T0 + 10 * S }, T0 + 21 * S);
    expect(res.ignored).toBe(true);
    expect(r.status).toBe('available');
  });

  it('a heartbeat that arrives after the timeout window is refused', () => {
    const r = new Run();
    const res = r.feed({ type: 'heartbeat', deviceId: 'web-1', client: 'web', activity: 'active', at: T0 }, T0 + PRESENCE_TIMEOUT_MS);
    expect(res.ignored).toBe(true);
    expect(r.status).toBe('offline');
  });

  it('duplicate event ids are ignored', () => {
    const r = new Run();
    r.beat(T0, { eventId: 'e1' });
    const dup = r.feed({ type: 'idle', deviceId: 'web-1', idle: true, at: T0 + 1 * S, eventId: 'e1' }, T0 + S);
    expect(dup.ignored).toBe(true);
    expect(r.status).toBe('available');
  });
});

describe('status engine: two devices, sessions', () => {
  it('stays online while any device beats; away when the remaining one is hidden', () => {
    const r = new Run();
    r.beat(T0, { deviceId: 'web-1', sessionId: 's-web' });
    r.beat(T0 + 1 * S, { deviceId: 'app-1', client: 'app', sessionId: 's-app' });
    // web stops; app keeps beating
    for (let i = 1; i <= 5; i++) r.beat(T0 + i * 20 * S, { deviceId: 'app-1', client: 'app', sessionId: 's-app' });
    expect(r.status).toBe('available');
    expect(Object.keys(r.state.devices)).toEqual(['app-1']);
    r.beat(T0 + 120 * S, { deviceId: 'app-1', client: 'app', sessionId: 's-app', activity: 'hidden' });
    expect(r.status).toBe('away');
    r.tick(T0 + 120 * S + PRESENCE_TIMEOUT_MS);
    expect(r.state).toMatchObject({ status: 'offline', since: T0 + 120 * S + PRESENCE_TIMEOUT_MS });
  });

  it('logout removes only that session; the last logout is offline at the logout time', () => {
    const r = new Run();
    r.beat(T0, { deviceId: 'web-1', sessionId: 's-web' });
    r.beat(T0, { deviceId: 'app-1', client: 'app', sessionId: 's-app' });
    expect(r.feed({ type: 'logout', sessionId: 's-web', at: T0 + 5 * S }, T0 + 5 * S).change).toBeNull();
    const last = r.feed({ type: 'logout', sessionId: 's-app', at: T0 + 8 * S }, T0 + 8 * S);
    expect(last.change?.view).toMatchObject({ status: 'offline', since: T0 + 8 * S, source: 'session' });
  });

  it('in-flight heartbeats of a logged-out session cannot revive it', () => {
    const r = new Run();
    r.beat(T0, { sessionId: 's1' });
    r.feed({ type: 'logout', sessionId: 's1', at: T0 + 5 * S }, T0 + 5 * S);
    expect(r.beat(T0 + 6 * S, { sessionId: 's1' }).ignored).toBe(true);
    expect(r.status).toBe('offline');
    // a new login (new session) works
    r.feed({ type: 'login', sessionId: 's2', at: T0 + 10 * S }, T0 + 10 * S);
    expect(r.beat(T0 + 11 * S, { sessionId: 's2' }).change?.view.status).toBe('available');
  });

  it('login alone does not make anyone online', () => {
    const r = new Run();
    expect(r.feed({ type: 'login', sessionId: 's1', at: T0 }, T0).change).toBeNull();
    expect(r.status).toBe('offline');
  });
});

describe('status engine: live calls', () => {
  const started = (callId: string, at: number, extra: Partial<{ deviceId: string; leadId: string; leadName: string; eventId: string }> = {}): PresenceInput => ({
    type: 'call_started',
    callId,
    at,
    deviceId: extra.deviceId ?? 'app-1',
    leadId: extra.leadId ?? 'lead-1',
    leadName: extra.leadName ?? 'Ravi Kumar',
    eventId: extra.eventId,
  });

  it('call started -> on_call with the lead; ended -> back to available', () => {
    const r = new Run();
    r.beat(T0, { deviceId: 'app-1', client: 'app' });
    const on = r.feed(started('c1', T0 + 2 * S), T0 + 2 * S);
    expect(on.change?.view).toMatchObject({
      status: 'on_call',
      source: 'call',
      since: T0 + 2 * S,
      activity: { kind: 'call', callId: 'c1', leadId: 'lead-1', leadName: 'Ravi Kumar', startedAt: T0 + 2 * S },
    });
    const off = r.feed({ type: 'call_ended', callId: 'c1', at: T0 + 30 * S }, T0 + 30 * S);
    expect(off.change?.view).toMatchObject({ status: 'available', activity: null, source: 'call' });
    expect(r.changes.map((c) => c.view.version)).toEqual([1, 2, 3]);
  });

  it('a live call wins without any heartbeat; the end without a device online is offline', () => {
    const r = new Run();
    expect(r.feed(started('c1', T0), T0).change?.view.status).toBe('on_call');
    expect(r.feed({ type: 'call_ended', callId: 'c1', at: T0 + 20 * S }, T0 + 20 * S).change?.view).toMatchObject({ status: 'offline', since: T0 + 20 * S });
  });

  it('a live call beats every manual status and the manual status comes back after it', () => {
    const r = new Run();
    r.beat(T0);
    r.feed({ type: 'manual', status: 'in_meeting', at: T0 + S }, T0 + S);
    expect(r.feed(started('c1', T0 + 2 * S), T0 + 2 * S).change?.view.status).toBe('on_call');
    r.beat(T0 + 15 * S);
    expect(r.feed({ type: 'call_ended', callId: 'c1', at: T0 + 20 * S }, T0 + 20 * S).change?.view.status).toBe('in_meeting');
  });

  it('out of order: "ended" before "started" drops the late start', () => {
    const r = new Run();
    r.beat(T0);
    r.feed({ type: 'call_ended', callId: 'c1', at: T0 + 30 * S }, T0 + 30 * S);
    const late = r.feed(started('c1', T0 + 2 * S), T0 + 31 * S);
    expect(late.ignored).toBe(true);
    expect(r.status).toBe('available');
    expect(r.state.version).toBe(1);
  });

  it('duplicate "started" (retry or second socket) is a no-op; duplicate event ids too', () => {
    const r = new Run();
    r.beat(T0);
    r.feed(started('c1', T0 + S, { eventId: 'ev-1' }), T0 + S);
    expect(r.feed(started('c1', T0 + S), T0 + 2 * S).ignored).toBe(true);
    expect(r.feed(started('c1', T0 + S, { eventId: 'ev-1' }), T0 + 3 * S).ignored).toBe(true);
    expect(r.state.version).toBe(2);
    // duplicate "ended"
    r.feed({ type: 'call_ended', callId: 'c1', at: T0 + 10 * S }, T0 + 10 * S);
    expect(r.feed({ type: 'call_ended', callId: 'c1', at: T0 + 10 * S }, T0 + 11 * S).ignored).toBe(true);
    expect(r.state.version).toBe(3);
  });

  it('a second call while on a call (call waiting) switches the activity and bumps the version once', () => {
    const r = new Run();
    r.beat(T0);
    r.feed(started('a', T0 + S), T0 + S);
    const b = r.feed(started('b', T0 + 5 * S, { leadId: 'lead-2', leadName: 'Meena' }), T0 + 5 * S);
    expect(b.change).toMatchObject({ previousStatus: 'on_call', view: { status: 'on_call', version: 3, activity: { callId: 'b', leadId: 'lead-2' } } });
    expect(b.change?.view.since).toBe(T0 + S); // still on a call since the first one
    expect(r.feed({ type: 'call_ended', callId: 'b', at: T0 + 9 * S }, T0 + 9 * S).change?.view.activity?.callId).toBe('a');
    expect(r.feed({ type: 'call_ended', callId: 'a', at: T0 + 12 * S }, T0 + 12 * S).change?.view.status).toBe('available');
  });

  it('a call that never reports "ended" closes when the device call log arrives', () => {
    const r = new Run();
    r.beat(T0, { deviceId: 'app-1', client: 'app' });
    r.feed(started('c1', T0 + S), T0 + S);
    r.beat(T0 + 20 * S, { deviceId: 'app-1', client: 'app' });
    const log = r.feed({ type: 'call_log', deviceId: 'app-1', startedAt: T0 + S, endedAt: T0 + 25 * S }, T0 + 30 * S);
    expect(log.change?.view).toMatchObject({ status: 'available', source: 'call_log' });
  });

  it('a delayed call log of an OLDER call does not close the call in progress', () => {
    const r = new Run();
    r.beat(T0, { deviceId: 'app-1', client: 'app' });
    r.feed(started('new', T0 + 60 * S), T0 + 60 * S);
    const old = r.feed({ type: 'call_log', deviceId: 'app-1', startedAt: T0 - 5 * MIN, endedAt: T0 - 2 * MIN }, T0 + 61 * S);
    expect(old.ignored).toBe(true);
    expect(r.status).toBe('on_call');
  });

  it('a call log from another device does not close this device call', () => {
    const r = new Run();
    r.beat(T0, { deviceId: 'app-1', client: 'app' });
    r.feed(started('c1', T0 + S, { deviceId: 'app-1' }), T0 + S);
    r.feed({ type: 'call_log', deviceId: 'app-2', startedAt: T0, endedAt: T0 + 10 * S }, T0 + 11 * S);
    expect(r.status).toBe('on_call');
  });

  it('safety timeout: the call closes when its device is silent for 120 s', () => {
    const r = new Run();
    r.beat(T0, { deviceId: 'app-1', client: 'app' });
    r.feed(started('c1', T0 + S), T0 + S);
    // no heartbeat after T0: offline would be at T0+45 s but the call keeps the user on_call
    expect(r.tick(T0 + 60 * S).change).toBeNull();
    expect(r.status).toBe('on_call');
    const closed = r.tick(T0 + S + CALL_ORPHAN_MS);
    expect(closed.change?.view).toMatchObject({ status: 'offline', source: 'timeout' });
  });

  it('safety timeout: a device that keeps beating keeps the call until the 3 h limit', () => {
    const r = new Run();
    r.beat(T0, { deviceId: 'app-1', client: 'app' });
    r.feed(started('c1', T0), T0);
    let now = T0;
    while (now < T0 + CALL_MAX_MS - 20 * S) {
      now += 20 * S;
      r.beat(now, { deviceId: 'app-1', client: 'app' });
    }
    expect(r.status).toBe('on_call');
    r.beat(T0 + CALL_MAX_MS, { deviceId: 'app-1', client: 'app' });
    expect(r.state).toMatchObject({ status: 'available', source: 'heartbeat' });
  });

  it('a call start older than the 3 h limit is refused', () => {
    const r = new Run();
    expect(r.feed(started('c1', T0 - CALL_MAX_MS), T0).ignored).toBe(true);
  });
});

describe('status engine: manual status and working hours', () => {
  it('break, lunch, meeting, field visit and available', () => {
    const r = new Run();
    r.beat(T0);
    const seq: Array<[string, PresenceStatus, string | null]> = [
      ['on_break', 'on_break', 'break'],
      ['lunch', 'lunch', 'lunch'],
      ['in_meeting', 'in_meeting', 'meeting'],
      ['field_visit', 'field_visit', 'field_visit'],
      ['available', 'available', null],
    ];
    seq.forEach(([input, status, kind], i) => {
      const at = T0 + (i + 1) * S;
      const res = r.feed({ type: 'manual', status: input as 'on_break', at }, at);
      expect(res.change?.view).toMatchObject({ status, source: 'manual', since: at });
      expect(res.change?.view.activity?.kind ?? null).toBe(kind);
    });
  });

  it('an older manual change (out of order) is ignored', () => {
    const r = new Run();
    r.beat(T0);
    r.feed({ type: 'manual', status: 'lunch', at: T0 + 10 * S }, T0 + 10 * S);
    expect(r.feed({ type: 'manual', status: 'on_break', at: T0 + 5 * S }, T0 + 11 * S).ignored).toBe(true);
    expect(r.status).toBe('lunch');
  });

  it('a manual status needs the user online, is kept while offline and comes back the same day', () => {
    const r = new Run();
    r.beat(T0);
    r.feed({ type: 'manual', status: 'lunch', at: T0 + S }, T0 + S);
    r.tick(T0 + 50 * S);
    expect(r.status).toBe('offline');
    expect(r.beat(T0 + 10 * MIN).change?.view.status).toBe('lunch');
  });

  it('a manual status ends with its working day (18:30 IST) and is not shown the next day', () => {
    const r = new Run();
    r.beat(T0);
    r.feed({ type: 'manual', status: 'in_meeting', at: T0 + S }, T0 + S);
    expect(r.state.manual?.until).toBe(t('2026-11-02T13:00:00Z'));
    // working until 18:29:50 IST, still in the meeting
    let now = T0 + S;
    const end = t('2026-11-02T13:00:00Z');
    while (now + 20 * S < end) {
      now += 20 * S;
      r.beat(now);
    }
    expect(r.status).toBe('in_meeting');
    const after = r.beat(end + 5 * S);
    expect(after.change?.view).toMatchObject({ status: 'available', source: 'heartbeat' });
    expect(r.state.manual).toBeNull();
  });

  it('set outside working hours (Saturday 23:59 IST) it ends at local midnight (Sunday 00:00 IST = 18:30 UTC)', () => {
    const sat = t('2026-11-07T18:29:00Z');
    const r = new Run(office, sat);
    r.beat(sat);
    r.feed({ type: 'manual', status: 'on_break', at: sat }, sat);
    expect(r.state.manual?.until).toBe(t('2026-11-07T18:30:00Z'));
    r.beat(sat + 70 * S);
    expect(r.status).toBe('available');
  });

  it('check-out clears the manual status', () => {
    const r = new Run();
    r.beat(T0);
    r.feed({ type: 'manual', status: 'on_break', at: T0 + S }, T0 + S);
    expect(r.feed({ type: 'check_out', at: T0 + 2 * S }, T0 + 2 * S).change?.view).toMatchObject({ status: 'available', source: 'attendance' });
  });

  it('logout of the last session clears the manual status', () => {
    const r = new Run();
    r.beat(T0);
    r.feed({ type: 'manual', status: 'lunch', at: T0 + S }, T0 + S);
    r.feed({ type: 'logout', sessionId: 's1', at: T0 + 2 * S }, T0 + 2 * S);
    r.feed({ type: 'login', sessionId: 's2', at: T0 + 3 * S }, T0 + 3 * S);
    expect(r.beat(T0 + 4 * S, { sessionId: 's2' }).change?.view.status).toBe('available');
  });
});

describe('status engine: attendance and the auto field visit', () => {
  it('field staff checked in inside working hours and online -> field_visit', () => {
    const r = new Run(field);
    r.beat(T0, { deviceId: 'app-1', client: 'app', activity: 'hidden' });
    expect(r.status).toBe('away');
    const res = r.feed({ type: 'check_in', at: T0 + S }, T0 + S);
    expect(res.change?.view).toMatchObject({ status: 'field_visit', source: 'attendance', activity: { kind: 'field_visit', startedAt: T0 + S } });
  });

  it('the auto field visit ends at the end of working hours (source working_hours)', () => {
    const r = new Run(field);
    const end = t('2026-11-02T13:00:00Z');
    const late = end - 30 * S;
    r.beat(late, { deviceId: 'app-1', client: 'app' });
    r.feed({ type: 'check_in', at: late }, late);
    expect(r.status).toBe('field_visit');
    expect(nextDeadline(r.state, field, late)).toBe(end);
    r.beat(end - 10 * S, { deviceId: 'app-1', client: 'app' });
    expect(r.tick(end).change?.view).toMatchObject({ status: 'available', source: 'working_hours' });
  });

  it('checked in before hours: field_visit starts when the hours open', () => {
    const early = t('2026-11-02T03:59:30Z'); // 09:29:30 IST
    const r = new Run(field, early);
    r.beat(early, { deviceId: 'app-1', client: 'app' });
    r.feed({ type: 'check_in', at: early }, early);
    expect(r.status).toBe('available');
    expect(nextDeadline(r.state, field, early)).toBe(t('2026-11-02T04:00:00Z')); // opening comes before the heartbeat timeout
    r.beat(early + 20 * S, { deviceId: 'app-1', client: 'app' });
    expect(nextDeadline(r.state, field, early + 20 * S)).toBe(t('2026-11-02T04:00:00Z'));
    expect(r.tick(t('2026-11-02T04:00:00Z')).change?.view.status).toBe('field_visit');
  });

  it('"available" turns the auto field visit off; a manual break wins over it; check-out ends it', () => {
    const r = new Run(field);
    r.beat(T0, { deviceId: 'app-1', client: 'app' });
    r.feed({ type: 'check_in', at: T0 }, T0);
    expect(r.feed({ type: 'manual', status: 'available', at: T0 + S }, T0 + S).change?.view.status).toBe('available');
    expect(r.feed({ type: 'manual', status: 'lunch', at: T0 + 2 * S }, T0 + 2 * S).change?.view.status).toBe('lunch');
    r.feed({ type: 'check_out', at: T0 + 3 * S }, T0 + 3 * S);
    expect(r.status).toBe('available');
    // checked out: no auto field visit
    expect(r.state.attendance).toEqual({ checkedIn: false, at: T0 + 3 * S });
  });

  it('office staff checking in stay available', () => {
    const r = new Run(office);
    r.beat(T0);
    expect(r.feed({ type: 'check_in', at: T0 + S }, T0 + S).change).toBeNull();
    expect(r.status).toBe('available');
  });

  it('a check-in older than the last check-out is ignored', () => {
    const r = new Run(field);
    r.beat(T0, { deviceId: 'app-1', client: 'app' });
    r.feed({ type: 'check_out', at: T0 + 10 * S }, T0 + 10 * S);
    expect(r.feed({ type: 'check_in', at: T0 + 5 * S }, T0 + 11 * S).ignored).toBe(true);
    expect(r.status).toBe('available');
  });
});

describe('status engine: precedence table', () => {
  type Setup = { call?: boolean; manual?: 'in_meeting' | 'field_visit' | 'on_break' | 'lunch'; autoField?: boolean; active?: boolean; online?: boolean };
  const cases: Array<[Setup, PresenceStatus]> = [
    [{ call: true, manual: 'in_meeting', autoField: true, active: true, online: true }, 'on_call'],
    [{ call: true, online: false }, 'on_call'],
    [{ manual: 'in_meeting', autoField: true, active: true, online: true }, 'in_meeting'],
    [{ manual: 'field_visit', active: true, online: true }, 'field_visit'],
    [{ manual: 'on_break', active: true, online: true }, 'on_break'],
    [{ manual: 'lunch', active: true, online: true }, 'lunch'],
    [{ autoField: true, active: true, online: true }, 'field_visit'],
    [{ active: true, online: true }, 'available'],
    [{ active: false, online: true }, 'away'],
    [{ manual: 'in_meeting', online: false }, 'offline'],
    [{ autoField: true, online: false }, 'offline'],
    [{ online: false }, 'offline'],
  ];
  it.each(cases)('%j -> %s', (setup, expected) => {
    const r = new Run(setup.autoField ? field : office);
    if (setup.online) r.beat(T0, { deviceId: 'app-1', client: 'app', activity: setup.active ? 'active' : 'hidden' });
    if (setup.autoField) r.feed({ type: 'check_in', at: T0 }, T0);
    if (setup.manual) r.feed({ type: 'manual', status: setup.manual, at: T0 }, T0);
    if (setup.call) r.feed({ type: 'call_started', callId: 'c', deviceId: 'app-1', at: T0 }, T0);
    expect(r.status).toBe(expected);
  });
});

describe('status engine: deadlines for the sweeper', () => {
  it('heartbeat timeout, call safety timeout, manual expiry', () => {
    const r = new Run();
    expect(nextDeadline(r.state, office, T0)).toBeNull();
    r.beat(T0);
    expect(nextDeadline(r.state, office, T0)).toBe(T0 + PRESENCE_TIMEOUT_MS);
    r.feed({ type: 'call_started', callId: 'c', deviceId: 'web-1', at: T0 }, T0);
    expect(nextDeadline(r.state, office, T0)).toBe(T0 + PRESENCE_TIMEOUT_MS);
    r.tick(T0 + PRESENCE_TIMEOUT_MS);
    expect(nextDeadline(r.state, office, T0 + PRESENCE_TIMEOUT_MS)).toBe(T0 + CALL_ORPHAN_MS);
  });

  it('never in the past', () => {
    const r = new Run();
    r.beat(T0);
    expect(nextDeadline(r.state, office, T0 + 10 * MIN)).toBe(T0 + 10 * MIN + 1);
  });
});

// ---------------------------------------------------------------- randomized properties

/** Deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInput(rand: () => number, now: number, calls: string[]): PresenceInput {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)] as T;
  const device = pick(['web-1', 'web-2', 'app-1']);
  const r = rand();
  if (r < 0.4) return { type: 'heartbeat', deviceId: device, client: device.startsWith('app') ? 'app' : 'web', activity: pick(['active', 'active', 'idle', 'hidden'] as const), sessionId: device, at: now - Math.floor(rand() * 3 * S) };
  if (r < 0.48) return { type: 'idle', deviceId: device, idle: rand() < 0.5, at: now };
  if (r < 0.56) {
    const id = `c${Math.floor(rand() * 6)}`;
    calls.push(id);
    return { type: 'call_started', callId: id, deviceId: 'app-1', leadId: `lead-${id}`, at: now - Math.floor(rand() * 10 * S) };
  }
  if (r < 0.64) return { type: 'call_ended', callId: calls.length ? pick(calls) : 'c0', at: now };
  if (r < 0.68) return { type: 'call_log', deviceId: 'app-1', startedAt: now - 60 * S, endedAt: now - Math.floor(rand() * 20 * S) };
  if (r < 0.78) return { type: 'manual', status: pick(['in_meeting', 'field_visit', 'on_break', 'lunch', 'available'] as const), at: now - Math.floor(rand() * 2 * S) };
  if (r < 0.82) return { type: rand() < 0.5 ? 'check_in' : 'check_out', at: now };
  if (r < 0.85) return { type: 'logout', sessionId: device, at: now };
  if (r < 0.87) return { type: 'login', sessionId: device, at: now };
  return { type: 'tick' };
}

describe('status engine: randomized properties (500 runs x 120 inputs)', () => {
  it('version grows by exactly 1 per emitted change, every change is visible, duplicates never emit', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const rand = rng(seed);
      const ctx = seed % 2 ? field : office;
      let state = initialState('u1', T0);
      let now = T0;
      const calls: string[] = [];
      for (let i = 0; i < 120; i++) {
        now += Math.floor(rand() * 40 * S);
        const input = { ...randomInput(rand, now, calls), eventId: `e${i}` };
        const r = reduce(state, input, ctx, now);
        if (r.change) {
          expect(r.change.view.version).toBe(state.version + 1);
          const changedSomething = r.change.view.status !== state.status || r.change.view.activity?.callId !== state.activity?.callId || r.change.view.activity?.leadId !== state.activity?.leadId;
          expect(changedSomething, `seed ${seed} step ${i}`).toBe(true);
          if (r.change.view.status !== state.status) expect(r.change.previousStatus).toBe(state.status);
        } else {
          expect(r.state.version).toBe(state.version);
        }
        // replaying the same event id is ignored and changes nothing
        const dup = reduce(r.state, input, ctx, now);
        expect(dup.ignored).toBe(true);
        expect(dup.change).toBeNull();
        expect(r.state.since).toBeLessThanOrEqual(now);
        state = r.state;
      }
    }
  });

  it('offline is never reported while a device beat within 45 s, and on_call only with an open call', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed * 7919);
      let state = initialState('u1', T0);
      let now = T0;
      const calls: string[] = [];
      for (let i = 0; i < 120; i++) {
        now += Math.floor(rand() * 30 * S);
        state = reduce(state, randomInput(rand, now, calls), office, now).state;
        const fresh = Object.values(state.devices).some((d) => now - d.lastBeatAt < PRESENCE_TIMEOUT_MS);
        if (state.status === 'offline') expect(fresh || Object.keys(state.calls).length > 0).toBe(false);
        if (state.status === 'on_call') expect(Object.keys(state.calls).length).toBeGreaterThan(0);
        if (Object.keys(state.calls).length > 0) expect(state.status).toBe('on_call');
      }
    }
  });
});

describe('snapshot and events agree', () => {
  /** Snapshot comparison: lastSeenAt is only meaningful (and only kept in sync by events) when offline. */
  const comparable = (v: PresenceView) => ({ ...v, lastSeenAt: v.status === 'offline' ? v.lastSeenAt : null });

  it('a client applying events (shuffled, duplicated) to an old snapshot ends with a fresh snapshot (300 runs, 5 users)', () => {
    let totalEvents = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed * 104729);
      const users = ['u1', 'u2', 'u3', 'u4', 'u5'];
      const states = new Map(users.map((u) => [u, initialState(u, T0)]));
      const calls = new Map(users.map((u) => [u, [] as string[]]));
      let now = T0;
      const advance = (steps: number, sink: PresenceView[] | null) => {
        for (let i = 0; i < steps; i++) {
          now += Math.floor(rand() * 15 * S);
          const u = users[Math.floor(rand() * users.length)] as string;
          const ctx = u === 'u5' ? field : office;
          const r = reduce(states.get(u)!, randomInput(rand, now, calls.get(u)!), ctx, now);
          states.set(u, r.state);
          if (r.change && sink) sink.push(r.change.view);
          // the sweeper ticks every user now and then
          if (rand() < 0.2) {
            for (const v of users) {
              const tr = reduce(states.get(v)!, { type: 'tick' }, v === 'u5' ? field : office, now);
              states.set(v, tr.state);
              if (tr.change && sink) sink.push(tr.change.view);
            }
          }
        }
      };
      advance(40, null);
      const client = new Map(users.map((u) => [u, viewOf(states.get(u)!)]));
      const events: PresenceView[] = [];
      advance(80, events);
      totalEvents += events.length;
      // delivery: some events twice, order shuffled per pair (network reordering)
      const delivered = events.flatMap((e) => (rand() < 0.2 ? [e, e] : [e]));
      for (let i = delivered.length - 1; i > 0; i--) {
        if (rand() < 0.3) {
          const j = Math.max(0, i - 1 - Math.floor(rand() * 3));
          [delivered[i], delivered[j]] = [delivered[j]!, delivered[i]!];
        }
      }
      for (const e of delivered) applyView(client, e);
      for (const u of users) expect(comparable(client.get(u)!), `seed ${seed} user ${u}`).toEqual(comparable(viewOf(states.get(u)!)));
    }
    // the runs really exercise the event path
    expect(totalEvents).toBeGreaterThan(300 * 20);
  });
});
