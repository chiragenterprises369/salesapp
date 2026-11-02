import { LOCATION_INTERVAL_SEC, localClock, type BusinessHours, type GeoFix } from '@vistar/shared';

/**
 * Pure helpers of the web attendance pages (D-063). Unit tested in logic.test.ts.
 */

/** Minutes after the start of working hours before a check-in counts as late. */
export const LATE_GRACE_MIN = 15;
/** A position older than two location intervals is stale (same rule as FieldLivePosition.stale). */
export const STALE_AFTER_MS = 2 * LOCATION_INTERVAL_SEC * 1000;

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Today (YYYY-MM-DD) in the workspace timezone. */
export function todayIn(timezone: string, now = Date.now()): string {
  return localClock(new Date(now), timezone).date;
}

/** Shift a YYYY-MM-DD date by whole days (calendar arithmetic, timezone free). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days);
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Late check-in: minutes after the start of the first working slot of that day (in the workspace
 * timezone). null when there is no slot that day or the check-in is on time (within the grace).
 */
export function lateMinutes(checkInIso: string | null, hours: BusinessHours, timezone: string, graceMin = LATE_GRACE_MIN): number | null {
  if (!checkInIso) return null;
  const at = Date.parse(checkInIso);
  if (!Number.isFinite(at)) return null;
  const clock = localClock(new Date(at), timezone);
  const slots = hours[clock.weekday] ?? [];
  const first = slots.map((s) => toMinutes(s.start)).sort((a, b) => a - b)[0];
  if (first === undefined) return null;
  const late = clock.minutes - first;
  return late > graceMin ? late : null;
}

/** "7 h 25 min", "45 min", "0 min". */
export function formatWorked(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "1.4 km" or "850 m". */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

/** "19.07601, 72.87765 (±12 m)". */
export function formatPlace(fix: Pick<GeoFix, 'lat' | 'lng'> & { accuracy?: number | null }): string {
  const acc = fix.accuracy !== null && fix.accuracy !== undefined ? ` (±${Math.round(fix.accuracy)} m)` : '';
  return `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}${acc}`;
}

/** Great-circle distance in metres. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface RoutePoint {
  lat: number;
  lng: number;
  at: string;
  sessionId: string;
  accuracy?: number | null;
}

export interface RouteStop {
  /** 1, 2, 3 ... in time order. */
  index: number;
  lat: number;
  lng: number;
  from: string;
  to: string;
  durationMin: number;
  points: number;
}

/**
 * Stops: runs of consecutive points (same session) that stay within `radiusM` of the run's first point
 * for at least `minMinutes`. The stop position is the mean of the run.
 */
export function detectStops(points: readonly RoutePoint[], opts: { radiusM?: number; minMinutes?: number } = {}): RouteStop[] {
  const radius = opts.radiusM ?? 100;
  const minMs = (opts.minMinutes ?? 10) * 60_000;
  const stops: RouteStop[] = [];
  let i = 0;
  while (i < points.length) {
    const start = points[i]!;
    let j = i + 1;
    while (j < points.length && points[j]!.sessionId === start.sessionId && haversineM(start, points[j]!) <= radius) j++;
    const last = points[j - 1]!;
    const span = Date.parse(last.at) - Date.parse(start.at);
    if (j - i >= 2 && span >= minMs) {
      const run = points.slice(i, j);
      stops.push({
        index: stops.length + 1,
        lat: run.reduce((s, p) => s + p.lat, 0) / run.length,
        lng: run.reduce((s, p) => s + p.lng, 0) / run.length,
        from: start.at,
        to: last.at,
        durationMin: Math.round(span / 60_000),
        points: run.length,
      });
      i = j;
    } else i += 1;
  }
  return stops;
}

/** Polylines: one per session, points in time order. */
export function splitBySession(points: readonly RoutePoint[]): Array<{ sessionId: string; points: Array<[number, number]> }> {
  const out: Array<{ sessionId: string; points: Array<[number, number]> }> = [];
  for (const p of points) {
    const lastLine = out[out.length - 1];
    if (lastLine && lastLine.sessionId === p.sessionId) lastLine.points.push([p.lat, p.lng]);
    else out.push({ sessionId: p.sessionId, points: [[p.lat, p.lng]] });
  }
  return out;
}

/** Stale when the last point is older than two location intervals (or the server says so). */
export function isStale(at: string, now: number, serverStale = false): boolean {
  if (serverStale) return true;
  const t = Date.parse(at);
  return !Number.isFinite(t) || now - t > STALE_AFTER_MS;
}

/** Initials for a map pin ("Priya Sharma" -> "PS"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}
