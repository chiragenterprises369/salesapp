/**
 * Office zone engine (SPEC 29.11, contract b302671). Pure and deterministic: no I/O, the caller passes
 * `now` (server receive time). Decides WHERE in the office a person is, at room / zone level, from the
 * Android app's signals, and keeps that decision stable so a person does not flicker between zones.
 *
 * SIGNALS -> OBSERVATIONS (resolveSignal)
 * - ble    beacons seen (uuid/major/minor + RSSI) are mapped to zones through OfficeMarker rows (kind
 *          ble_beacon). Per zone the strongest beacon counts: RSSI -60 dBm or stronger 0.95, -95 dBm or
 *          weaker 0.35, linear between. Two zones within 0.1 of each other: the best is lowered by 0.1
 *          (ambiguous, e.g. a door between two rooms).
 * - wifi   access points seen (BSSID + RSSI) through wifi_ap markers: -55 dBm 0.7, -85 dBm 0.35.
 *          Wi-Fi is coarse (room to floor level): it never overrides a fresh precise zone (BLE, QR, NFC,
 *          manual), it only confirms it or sets a zone when nothing precise is known.
 * - qr/nfc a scanned marker token: that zone, confidence 1, switches at once.
 * - manual the employee's own pick: confidence 0.8, switches at once; no zoneId = "not in a zone".
 * A scan that sees no marker of its kind is evidence that the person left the current zone, but only
 * when the current zone HAS a marker of that kind (an empty BLE scan says nothing about a QR-only room).
 *
 * SMOOTHING (reduceZone)
 * - Explicit signals (qr, nfc, manual) switch immediately and start an EXPLICIT_HOLD_MS hold.
 * - Automatic signals (ble, wifi) for another zone become a candidate; the zone switches when the same
 *   candidate wins DWELL_HITS consecutive observations spanning at least DWELL_MS (inside a hold:
 *   EXPLICIT_HITS / EXPLICIT_DWELL_MS). A different zone must beat the current zone in the same scan
 *   by HYSTERESIS to count. An observation confirming the current zone resets the candidate.
 * - Leaving (no marker of a kind that marks the current zone): LEAVE_HITS observations over LEAVE_MS.
 * - Without any supporting signal the confidence decays after ZONE_FRESH_MS and the zone clears at
 *   ZONE_EXPIRE_MS (the sweeper deadline). Going offline clears it (clearZone).
 * - Signals older than the newest one processed, or older than SIGNAL_MAX_AGE_MS, are ignored.
 * A zone change (zoneId differs) is what `employee.zone_changed` publishes; confidence and the time of the
 * last signal move without events (like lastSeenAt), clients decay with `decayedConfidence`.
 */

/** Literals equal packages/shared ZONE_SIGNAL_SOURCES / OFFICE_MARKER_KINDS. */
export const ZONE_SOURCES = ['ble', 'wifi', 'qr', 'nfc', 'manual'] as const;
export type ZoneSource = (typeof ZONE_SOURCES)[number];
export const MARKER_KINDS = ['ble_beacon', 'wifi_ap', 'qr', 'nfc'] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

export const DWELL_MS = 8_000;
export const DWELL_HITS = 2;
export const EXPLICIT_HOLD_MS = 120_000;
export const EXPLICIT_DWELL_MS = 60_000;
export const EXPLICIT_HITS = 3;
export const LEAVE_MS = 45_000;
export const LEAVE_HITS = 3;
export const HYSTERESIS = 0.15;
/** A candidate not seen again within this long starts over (consecutive observations only). */
export const CANDIDATE_GAP_MS = 60_000;
export const ZONE_FRESH_MS = 90_000;
export const ZONE_EXPIRE_MS = 10 * 60_000;
export const SIGNAL_MAX_AGE_MS = 5 * 60_000;
export const MANUAL_CONFIDENCE = 0.8;
export const EXACT_CONFIDENCE = 1;
/** Confidence that a person is in none of the marked zones after an empty scan. */
const LEAVE_CONFIDENCE: Record<'ble' | 'wifi', number> = { ble: 0.7, wifi: 0.5 };
const AMBIGUITY = 0.1;

export interface ZoneCurrent {
  zoneId: string;
  source: ZoneSource;
  /** At the last supporting signal (0..1); see decayedConfidence. */
  confidence: number;
  since: number;
  /** Server time of the last supporting signal. */
  at: number;
}

export interface ZoneCandidate {
  /** null = "left the marked zones". */
  zoneId: string | null;
  source: ZoneSource;
  confidence: number;
  firstAt: number;
  lastAt: number;
  hits: number;
}

export interface ZoneState {
  current: ZoneCurrent | null;
  candidate: ZoneCandidate | null;
  /** Device time of the newest signal processed (ordering of one phone's signals). */
  lastSignalAt: number | null;
  /** Server time of the last explicit (qr, nfc, manual) signal. */
  explicitAt: number | null;
}

/** One resolved observation: what a signal says about the zones. */
export type ZoneObservation =
  | { kind: 'explicit'; source: 'qr' | 'nfc' | 'manual'; signalAt: number; zoneId: string | null; confidence: number }
  | {
      kind: 'scan';
      source: 'ble' | 'wifi';
      signalAt: number;
      /** zoneId -> confidence in this scan; empty = no known marker of this kind seen */
      scores: Record<string, number>;
      /** Zones that have a marker of this kind (an empty scan only argues against these). */
      observable: readonly string[];
    };

export interface ZoneChange {
  zoneId: string | null;
  previousZoneId: string | null;
  source: ZoneSource;
  confidence: number;
  at: number;
}

export interface ZoneResult {
  state: ZoneState;
  change: ZoneChange | null;
  /** True when the observation carried no usable fact (stale, out of order, nothing observable). */
  ignored: boolean;
}

export const EMPTY_ZONE: ZoneState = Object.freeze({ current: null, candidate: null, lastSignalAt: null, explicitAt: null });

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) => (x <= x0 ? y0 : x >= x1 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));

export const bleConfidence = (rssi: number) => round2(lerp(rssi, -95, -60, 0.35, 0.95));
export const wifiConfidence = (rssi: number) => round2(lerp(rssi, -85, -55, 0.35, 0.7));

/** Confidence of the current zone at `now`: full while fresh, then linear down to 0 at expiry. */
export function decayedConfidence(z: Pick<ZoneCurrent, 'confidence' | 'at'>, now: number): number {
  const age = now - z.at;
  if (age <= ZONE_FRESH_MS) return round2(z.confidence);
  return round2(clamp01(z.confidence * (1 - (age - ZONE_FRESH_MS) / (ZONE_EXPIRE_MS - ZONE_FRESH_MS))));
}

// ---------------------------------------------------------------- resolution

export interface MarkerRef {
  kind: MarkerKind;
  zoneId: string;
  beacon?: { uuid: string; major: number; minor: number } | null;
  bssid?: string | null;
}

export interface RawZoneSignal {
  source: ZoneSource;
  at: number;
  beacons?: ReadonlyArray<{ uuid: string; major: number; minor: number; rssi: number }>;
  wifi?: ReadonlyArray<{ bssid: string; rssi: number }>;
  /** qr / nfc: zone of the marker whose token was read (looked up by the caller); manual: the pick. */
  zoneId?: string | null;
}

export const beaconKey = (b: { uuid: string; major: number; minor: number }) => `${b.uuid.toLowerCase()}:${b.major}:${b.minor}`;
export const normBssid = (s: string) => s.toLowerCase();

function scan(source: 'ble' | 'wifi', signalAt: number, seen: Array<{ zoneId: string; confidence: number }>, observable: Set<string>): ZoneObservation | null {
  if (observable.size === 0) return null; // the company marks no zone this way: nothing to learn
  const scores: Record<string, number> = {};
  for (const s of seen) scores[s.zoneId] = Math.max(scores[s.zoneId] ?? 0, s.confidence);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0]![1] - ranked[1]![1] < AMBIGUITY) scores[ranked[0]![0]] = round2(Math.max(0.3, ranked[0]![1] - AMBIGUITY));
  return { kind: 'scan', source, signalAt, scores, observable: [...observable].sort() };
}

/**
 * Observations of one raw signal (pure). Beacons and access points in one signal give one scan each
 * (BLE first); qr / nfc / manual give one explicit observation.
 */
export function resolveSignal(signal: RawZoneSignal, markers: readonly MarkerRef[]): ZoneObservation[] {
  if (signal.source === 'qr' || signal.source === 'nfc') {
    return signal.zoneId ? [{ kind: 'explicit', source: signal.source, signalAt: signal.at, zoneId: signal.zoneId, confidence: EXACT_CONFIDENCE }] : [];
  }
  if (signal.source === 'manual') return [{ kind: 'explicit', source: 'manual', signalAt: signal.at, zoneId: signal.zoneId ?? null, confidence: MANUAL_CONFIDENCE }];
  const out: ZoneObservation[] = [];
  const beacons = new Map<string, string>();
  const aps = new Map<string, string>();
  for (const m of markers) {
    if (m.kind === 'ble_beacon' && m.beacon) beacons.set(beaconKey(m.beacon), m.zoneId);
    if (m.kind === 'wifi_ap' && m.bssid) aps.set(normBssid(m.bssid), m.zoneId);
  }
  // A BLE signal without a beacon list is an empty BLE scan; a Wi-Fi signal without a list an empty Wi-Fi scan.
  const bleList = signal.beacons ?? (signal.source === 'ble' ? [] : undefined);
  const wifiList = signal.wifi ?? (signal.source === 'wifi' ? [] : undefined);
  if (bleList) {
    const seen = bleList.flatMap((b) => {
      const zoneId = beacons.get(beaconKey(b));
      return zoneId ? [{ zoneId, confidence: bleConfidence(b.rssi) }] : [];
    });
    const o = scan('ble', signal.at, seen, new Set(beacons.values()));
    if (o) out.push(o);
  }
  if (wifiList) {
    const seen = wifiList.flatMap((w) => {
      const zoneId = aps.get(normBssid(w.bssid));
      return zoneId ? [{ zoneId, confidence: wifiConfidence(w.rssi) }] : [];
    });
    const o = scan('wifi', signal.at, seen, new Set(aps.values()));
    if (o) out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------- reduction

const PRECISE: ReadonlySet<ZoneSource> = new Set(['ble', 'qr', 'nfc', 'manual']);

function switchTo(s: ZoneState, zoneId: string | null, source: ZoneSource, confidence: number, now: number): ZoneResult {
  const previousZoneId = s.current?.zoneId ?? null;
  const current: ZoneCurrent | null = zoneId === null ? null : { zoneId, source, confidence: round2(confidence), since: now, at: now };
  const state: ZoneState = { ...s, current, candidate: null };
  if (previousZoneId === zoneId) return { state, change: null, ignored: false };
  return { state, change: { zoneId, previousZoneId, source, confidence: round2(confidence), at: now }, ignored: false };
}

/** Drop what time alone has ended: a zone without a signal for ZONE_EXPIRE_MS, a stale candidate. */
export function expireZone(prev: ZoneState | null | undefined, now: number): ZoneResult {
  const s = prev ?? EMPTY_ZONE;
  let state = s;
  if (state.candidate && now - state.candidate.lastAt > CANDIDATE_GAP_MS) state = { ...state, candidate: null };
  if (state.current && now - state.current.at >= ZONE_EXPIRE_MS) {
    const previousZoneId = state.current.zoneId;
    const source = state.current.source;
    return { state: { ...state, current: null, candidate: null }, change: { zoneId: null, previousZoneId, source, confidence: 0, at: now }, ignored: false };
  }
  return { state, change: null, ignored: state === s };
}

/** Forget the zone (the person went offline or logged out). */
export function clearZone(prev: ZoneState | null | undefined, now: number): ZoneResult {
  const s = prev ?? EMPTY_ZONE;
  if (!s.current) return { state: s.candidate ? { ...s, candidate: null } : s, change: null, ignored: true };
  const { zoneId, source } = s.current;
  return { state: { ...s, current: null, candidate: null }, change: { zoneId: null, previousZoneId: zoneId, source, confidence: 0, at: now }, ignored: false };
}

/** Apply one observation. Returns the new zone state and, when the zone changed, the change to publish. */
export function reduceZone(prev: ZoneState | null | undefined, obs: ZoneObservation, now: number): ZoneResult {
  const expired = expireZone(prev, now);
  const s = expired.state;
  const pre = expired.change;
  const finish = (r: ZoneResult): ZoneResult => {
    // An expiry and a switch in one step publish one change from the zone clients last saw.
    if (pre && r.change) return r.change.zoneId === pre.previousZoneId ? { ...r, change: null } : { ...r, change: { ...r.change, previousZoneId: pre.previousZoneId } };
    if (pre && !r.change) return { ...r, change: pre, ignored: false };
    return r;
  };

  if (now - obs.signalAt > SIGNAL_MAX_AGE_MS || (s.lastSignalAt !== null && obs.signalAt < s.lastSignalAt)) {
    return finish({ state: s, change: null, ignored: true });
  }
  const seen: ZoneState = { ...s, lastSignalAt: Math.max(s.lastSignalAt ?? obs.signalAt, obs.signalAt) };

  if (obs.kind === 'explicit') {
    const r = switchTo({ ...seen, explicitAt: now }, obs.zoneId, obs.source, obs.confidence, now);
    return finish(r);
  }

  const cur = seen.current;
  const best = Object.entries(obs.scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;
  const curScore = cur ? (obs.scores[cur.zoneId] ?? null) : null;

  // Wi-Fi never moves a fresh precise zone; it may confirm it.
  if (cur && obs.source === 'wifi' && PRECISE.has(cur.source) && now - cur.at < ZONE_FRESH_MS) {
    if (curScore !== null) return finish({ state: { ...seen, current: { ...cur, at: now } }, change: null, ignored: false });
    return finish({ state: seen, change: null, ignored: true });
  }

  // The scan confirms the current zone (it is the best, or no other zone beats it by the margin).
  if (cur && curScore !== null && (!best || best[0] === cur.zoneId || best[1] - curScore < HYSTERESIS)) {
    const confidence = round2(0.6 * curScore + 0.4 * decayedConfidence(cur, now));
    return finish({ state: { ...seen, candidate: null, current: { ...cur, source: obs.source, confidence, at: now } }, change: null, ignored: false });
  }

  // What this scan argues for: another zone, or "left" (nothing seen, and the current zone is observable this way).
  let target: { zoneId: string | null; confidence: number } | null = null;
  if (best) target = { zoneId: best[0], confidence: best[1] };
  else if (cur && obs.observable.includes(cur.zoneId)) target = { zoneId: null, confidence: LEAVE_CONFIDENCE[obs.source] };
  if (!target) return finish({ state: seen, change: null, ignored: true });

  // Nothing known yet: take the first zone at once (no flicker risk from "unknown").
  if (!cur) {
    if (target.zoneId === null) return finish({ state: seen, change: null, ignored: true });
    return finish(switchTo(seen, target.zoneId, obs.source, target.confidence, now));
  }

  const prevCand = seen.candidate;
  const same = prevCand && prevCand.zoneId === target.zoneId && now - prevCand.lastAt <= CANDIDATE_GAP_MS;
  const candidate: ZoneCandidate = same
    ? { ...prevCand, source: obs.source, confidence: round2(Math.max(prevCand.confidence, target.confidence)), lastAt: now, hits: prevCand.hits + 1 }
    : { zoneId: target.zoneId, source: obs.source, confidence: round2(target.confidence), firstAt: now, lastAt: now, hits: 1 };
  const held = seen.explicitAt !== null && now - seen.explicitAt < EXPLICIT_HOLD_MS;
  const needMs = Math.max(target.zoneId === null ? LEAVE_MS : DWELL_MS, held ? EXPLICIT_DWELL_MS : 0);
  const needHits = Math.max(target.zoneId === null ? LEAVE_HITS : DWELL_HITS, held ? EXPLICIT_HITS : 0);
  if (candidate.hits >= needHits && now - candidate.firstAt >= needMs) {
    return finish(switchTo(seen, candidate.zoneId, candidate.source, candidate.confidence, now));
  }
  return finish({ state: { ...seen, candidate }, change: null, ignored: false });
}

/** When the zone clears with no new signal (sweeper deadline); null = nothing pending. */
export function zoneDeadline(s: ZoneState | null | undefined): number | null {
  return s?.current ? s.current.at + ZONE_EXPIRE_MS : null;
}

/** Apply a published zone change to a client-side map (reference client reducer). */
export function applyZoneChange(map: Map<string, string | null>, userId: string, change: Pick<ZoneChange, 'zoneId'>): void {
  map.set(userId, change.zoneId);
}
