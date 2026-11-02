import { DEFAULT_BUSINESS_HOURS } from '@vistar/shared';
import { describe, expect, it } from 'vitest';
import { initialState, PRESENCE_TIMEOUT_MS, reduce, viewOf, type PresenceContext, type PresenceInput, type PresenceState } from './status-engine.js';
import {
  bleConfidence,
  CANDIDATE_GAP_MS,
  decayedConfidence,
  DWELL_MS,
  EMPTY_ZONE,
  EXPLICIT_DWELL_MS,
  LEAVE_MS,
  reduceZone,
  resolveSignal,
  SIGNAL_MAX_AGE_MS,
  wifiConfidence,
  ZONE_EXPIRE_MS,
  ZONE_FRESH_MS,
  zoneDeadline,
  type MarkerRef,
  type ZoneChange,
  type ZoneObservation,
  type ZoneState,
} from './zone-engine.js';

const S = 1000;
/** Monday 2026-11-02 11:00 IST. */
const T0 = Date.parse('2026-11-02T05:30:00Z');
const B = (minor: number) => ({ uuid: 'f7826da6-4fa2-4e98-8024-bc5b71e0893e', major: 1, minor });
const markers: MarkerRef[] = [
  { kind: 'ble_beacon', zoneId: 'sales', beacon: B(1) },
  { kind: 'ble_beacon', zoneId: 'meeting', beacon: B(2) },
  { kind: 'ble_beacon', zoneId: 'cabin', beacon: B(3) },
  { kind: 'wifi_ap', zoneId: 'sales', bssid: 'aa:bb:cc:dd:ee:01' },
  { kind: 'wifi_ap', zoneId: 'pantry', bssid: 'AA:BB:CC:DD:EE:02' },
  { kind: 'qr', zoneId: 'meeting' },
];

const ble = (at: number, seen: Array<[number, number]>): ZoneObservation[] => resolveSignal({ source: 'ble', at, beacons: seen.map(([minor, rssi]) => ({ ...B(minor), rssi })) }, markers);
const wifi = (at: number, seen: Array<[string, number]>): ZoneObservation[] => resolveSignal({ source: 'wifi', at, wifi: seen.map(([bssid, rssi]) => ({ bssid, rssi })) }, markers);
const qr = (at: number, zoneId: string) => resolveSignal({ source: 'qr', at, zoneId }, markers);
const manual = (at: number, zoneId: string | null) => resolveSignal({ source: 'manual', at, zoneId }, markers);

/** Feeds observations at server time = signal time and records the changes. */
class Zone {
  state: ZoneState = EMPTY_ZONE;
  changes: ZoneChange[] = [];
  feed(obs: ZoneObservation[], now: number) {
    let last = null as ReturnType<typeof reduceZone> | null;
    for (const o of obs) {
      last = reduceZone(this.state, o, now);
      this.state = last.state;
      if (last.change) this.changes.push(last.change);
    }
    return last;
  }
  get zone() {
    return this.state.current?.zoneId ?? null;
  }
}

describe('signal resolution', () => {
  it('maps RSSI to confidence (BLE 0.35..0.95, Wi-Fi 0.35..0.7) and markers to zones', () => {
    expect(bleConfidence(-50)).toBe(0.95);
    expect(bleConfidence(-100)).toBe(0.35);
    expect(bleConfidence(-77.5)).toBeCloseTo(0.65, 2);
    expect(wifiConfidence(-40)).toBe(0.7);
    expect(wifiConfidence(-90)).toBe(0.35);
    const [o] = ble(T0, [[1, -60], [2, -90], [99, -40]]);
    expect(o).toMatchObject({ kind: 'scan', source: 'ble', scores: { sales: 0.95, meeting: bleConfidence(-90) } });
    expect(o && o.kind === 'scan' ? o.scores : {}).not.toHaveProperty('unknown');
  });

  it('BSSIDs match case-insensitively; unknown access points are ignored', () => {
    const [o] = wifi(T0, [['aa:bb:cc:dd:ee:02', -55], ['11:22:33:44:55:66', -30]]);
    expect(o).toMatchObject({ kind: 'scan', source: 'wifi', scores: { pantry: 0.7 } });
  });

  it('two zones within 0.1: the best one is marked ambiguous (lowered)', () => {
    const [o] = ble(T0, [[1, -60], [2, -62]]);
    const scores = o && o.kind === 'scan' ? o.scores : {};
    expect(scores.sales).toBeCloseTo(0.85, 2);
  });

  it('a kind the company does not use yields nothing; qr/nfc/manual are explicit', () => {
    expect(resolveSignal({ source: 'wifi', at: T0, wifi: [] }, [{ kind: 'qr', zoneId: 'a' }])).toEqual([]);
    expect(qr(T0, 'meeting')).toEqual([{ kind: 'explicit', source: 'qr', signalAt: T0, zoneId: 'meeting', confidence: 1 }]);
    expect(manual(T0, null)).toEqual([{ kind: 'explicit', source: 'manual', signalAt: T0, zoneId: null, confidence: 0.8 }]);
  });
});

describe('zone smoothing', () => {
  it('the first zone is taken at once; a stronger other zone needs two scans over the dwell time', () => {
    const z = new Zone();
    z.feed(ble(T0, [[1, -60]]), T0);
    expect(z.zone).toBe('sales');
    expect(z.changes).toEqual([{ zoneId: 'sales', previousZoneId: null, source: 'ble', confidence: 0.95, at: T0 }]);
    z.feed(ble(T0 + 2 * S, [[2, -58], [1, -85]]), T0 + 2 * S);
    expect(z.zone).toBe('sales');
    z.feed(ble(T0 + 4 * S, [[2, -58], [1, -85]]), T0 + 4 * S);
    expect(z.zone, 'two hits but under the dwell time').toBe('sales');
    z.feed(ble(T0 + 2 * S + DWELL_MS, [[2, -58]]), T0 + 2 * S + DWELL_MS);
    expect(z.zone).toBe('meeting');
    expect(z.changes.at(-1)).toMatchObject({ zoneId: 'meeting', previousZoneId: 'sales', source: 'ble' });
  });

  it('does not flicker at a door between two rooms (alternating strongest beacon)', () => {
    const z = new Zone();
    z.feed(ble(T0, [[1, -60]]), T0);
    for (let i = 1; i <= 30; i++) {
      const at = T0 + i * 3 * S;
      z.feed(ble(at, i % 2 ? [[2, -62], [1, -66]] : [[1, -62], [2, -66]]), at);
    }
    expect(z.changes).toHaveLength(1);
    expect(z.zone).toBe('sales');
  });

  it('hysteresis: another zone only slightly stronger than the current one confirms the current zone', () => {
    const z = new Zone();
    z.feed(ble(T0, [[1, -60]]), T0);
    for (let i = 1; i <= 10; i++) z.feed(ble(T0 + i * 5 * S, [[2, -68], [1, -72]]), T0 + i * 5 * S);
    expect(z.zone).toBe('sales');
  });

  it('a candidate that disappears for longer than the gap starts over', () => {
    const z = new Zone();
    z.feed(ble(T0, [[1, -60]]), T0);
    z.feed(ble(T0 + S, [[2, -55]]), T0 + S);
    const later = T0 + S + CANDIDATE_GAP_MS + S;
    z.feed(ble(later, [[2, -55]]), later);
    expect(z.zone).toBe('sales');
    expect(z.state.candidate?.hits).toBe(1);
  });

  it('QR and manual switch at once and hold against BLE for a minute', () => {
    const z = new Zone();
    z.feed(ble(T0, [[1, -60]]), T0);
    z.feed(qr(T0 + S, 'meeting'), T0 + S);
    expect(z.zone).toBe('meeting');
    expect(z.state.current).toMatchObject({ source: 'qr', confidence: 1 });
    for (let i = 1; i <= 5; i++) z.feed(ble(T0 + S + i * 5 * S, [[1, -55]]), T0 + S + i * 5 * S);
    expect(z.zone, 'within the hold BLE needs a minute').toBe('meeting');
    const after = T0 + S + EXPLICIT_DWELL_MS + 5 * S;
    z.feed(ble(after, [[1, -55]]), after);
    expect(z.zone).toBe('sales');
    z.feed(manual(after + S, null), after + S);
    expect(z.zone).toBeNull();
    expect(z.changes.at(-1)).toMatchObject({ zoneId: null, previousZoneId: 'sales', source: 'manual' });
  });

  it('Wi-Fi never moves a fresh precise zone, confirms it, and sets a zone when nothing is known', () => {
    const z = new Zone();
    z.feed(ble(T0, [[3, -60]]), T0);
    z.feed(wifi(T0 + 5 * S, [['aa:bb:cc:dd:ee:02', -50]]), T0 + 5 * S);
    z.feed(wifi(T0 + 30 * S, [['aa:bb:cc:dd:ee:02', -50]]), T0 + 30 * S);
    expect(z.zone).toBe('cabin');
    const fresh = new Zone();
    fresh.feed(wifi(T0, [['aa:bb:cc:dd:ee:01', -60]]), T0);
    expect(fresh.zone).toBe('sales');
    expect(fresh.state.current?.source).toBe('wifi');
  });

  it('leaving: empty BLE scans over 45 s clear a BLE-marked zone; they say nothing about a QR-only zone', () => {
    const z = new Zone();
    z.feed(ble(T0, [[1, -60]]), T0);
    for (let i = 1; i <= 3; i++) z.feed(ble(T0 + i * 10 * S, []), T0 + i * 10 * S);
    expect(z.zone, 'three empty scans but only 20 s since the first').toBe('sales');
    z.feed(ble(T0 + 10 * S + LEAVE_MS, []), T0 + 10 * S + LEAVE_MS);
    expect(z.zone).toBeNull();
    const q = new Zone();
    q.feed(resolveSignal({ source: 'qr', at: T0, zoneId: 'reception' }, markers), T0);
    for (let i = 1; i <= 10; i++) q.feed(ble(T0 + i * 10 * S, []), T0 + i * 10 * S);
    expect(q.zone).toBe('reception');
  });

  it('ignores out-of-order and too-old signals', () => {
    const z = new Zone();
    z.feed(ble(T0, [[1, -60]]), T0);
    expect(reduceZone(z.state, qr(T0 - S, 'meeting')[0]!, T0 + S).ignored).toBe(true);
    expect(reduceZone(z.state, qr(T0 + S - SIGNAL_MAX_AGE_MS - S, 'meeting')[0]!, T0 + S).ignored).toBe(true);
    expect(z.zone).toBe('sales');
  });

  it('confidence decays after 90 s and the zone expires after 10 min without a signal', () => {
    const z = new Zone();
    z.feed(ble(T0, [[1, -60]]), T0);
    const cur = z.state.current!;
    expect(decayedConfidence(cur, T0 + ZONE_FRESH_MS)).toBe(0.95);
    expect(decayedConfidence(cur, T0 + (ZONE_FRESH_MS + ZONE_EXPIRE_MS) / 2)).toBeCloseTo(0.48, 1);
    expect(decayedConfidence(cur, T0 + ZONE_EXPIRE_MS)).toBe(0);
    expect(zoneDeadline(z.state)).toBe(T0 + ZONE_EXPIRE_MS);
  });
});

describe('zones inside the presence engine', () => {
  const office: PresenceContext = { workingHours: { hours: DEFAULT_BUSINESS_HOURS, timezone: 'Asia/Kolkata', holidays: [] }, fieldStaff: false };
  const run = () => {
    let state: PresenceState = initialState('u1', T0);
    const zoneChanges: ZoneChange[] = [];
    const feed = (input: PresenceInput, now: number) => {
      const r = reduce(state, input, office, now);
      state = r.state;
      if (r.zoneChange) zoneChanges.push(r.zoneChange);
      return r;
    };
    return { feed, zoneChanges, get state() { return state; } };
  };
  const beat = (at: number, extra: Partial<Extract<PresenceInput, { type: 'heartbeat' }>> = {}): PresenceInput => ({ type: 'heartbeat', deviceId: 'app-1', client: 'android', activity: 'active', sessionId: 's1', at, ...extra });

  it('a zone change does not bump the status version; the view carries the zone', () => {
    const r = run();
    r.feed(beat(T0), T0);
    const v0 = r.state.version;
    const res = r.feed({ type: 'zone', observations: ble(T0 + S, [[1, -60]]) }, T0 + S);
    expect(res.change).toBeNull();
    expect(res.zoneChange).toMatchObject({ zoneId: 'sales', previousZoneId: null });
    expect(r.state.version).toBe(v0);
    expect(viewOf(r.state).zone?.zoneId).toBe('sales');
  });

  it('going offline clears the zone with one zone change (null), and offline signals set nothing', () => {
    const r = run();
    r.feed(beat(T0, { zone: ble(T0, [[2, -60]]) }), T0);
    expect(r.zoneChanges.map((c) => c.zoneId)).toEqual(['meeting']);
    const off = r.feed({ type: 'tick' }, T0 + PRESENCE_TIMEOUT_MS + S);
    expect(off.change?.view.status).toBe('offline');
    expect(off.zoneChange).toMatchObject({ zoneId: null, previousZoneId: 'meeting' });
    const late = r.feed({ type: 'zone', observations: qr(T0 + 50 * S, 'meeting') }, T0 + 50 * S);
    expect(late.zoneChange).toBeNull();
    expect(viewOf(r.state).zone).toBeNull();
  });

  it('screen changes are versioned and published but not history rows', () => {
    const r = run();
    const first = r.feed(beat(T0, { screen: 'leads' }), T0);
    expect(first.change).toMatchObject({ historic: true, view: { status: 'available', activity: { screen: 'leads' } } });
    const same = r.feed(beat(T0 + 15 * S, { screen: 'leads' }), T0 + 15 * S);
    expect(same.change).toBeNull();
    const moved = r.feed(beat(T0 + 20 * S, { screen: 'lead_detail' }), T0 + 20 * S);
    expect(moved.change).toMatchObject({ historic: false, view: { version: first.change!.view.version + 1, activity: { screen: 'lead_detail' } } });
    const kept = r.feed(beat(T0 + 35 * S), T0 + 35 * S);
    expect(kept.change, 'a beat without screen keeps the last one').toBeNull();
    const off = r.feed({ type: 'tick' }, T0 + 35 * S + PRESENCE_TIMEOUT_MS);
    expect(off.change?.view.activity.screen ?? null).toBeNull();
  });

  it('the zone expires through the deadline (sweeper tick) while the person stays online', () => {
    const r = run();
    r.feed(beat(T0, { zone: ble(T0, [[1, -60]]) }), T0);
    for (let t = T0 + 15 * S; t < T0 + ZONE_EXPIRE_MS + 20 * S; t += 15 * S) r.feed(beat(t), t);
    expect(r.zoneChanges.map((c) => c.zoneId)).toEqual(['sales', null]);
    expect(r.state.status).toBe('available');
  });
});
