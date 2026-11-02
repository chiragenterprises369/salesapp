/**
 * Working-hours gate (pure, no I/O). Answers "is this instant inside the working hours" in the
 * workspace timezone (Asia/Kolkata by default) and gives the boundaries around it.
 *
 * Rules
 * - Hours are per weekday (`mon`..`sun`), each a list of `{ start, end }` slots in HH:MM, local time.
 *   An empty list means the day is closed.
 * - A slot whose end is not after its start (e.g. 22:00-06:00) runs overnight: it belongs to the
 *   weekday it starts on and ends on the next local day.
 * - `end` is exclusive: 18:30 is outside a 09:30-18:30 slot.
 * - A holiday (local date `YYYY-MM-DD`) closes the slots that START on that date. The overnight tail of
 *   the previous day's slot still counts.
 * - Instants are absolute (UTC ms); local calendar maths goes through Intl, so offsets such as +05:30
 *   and DST zones are handled without a date library.
 */
import type { BusinessHours, Weekday } from '@vistar/shared';
import { safeTimezone, zonedMidnight, zonedParts } from '../../leads/lib/tz.js';

export type WorkingHoursClosedReason = 'closed_day' | 'holiday' | 'outside_hours';

export interface WorkingWindow {
  /** Slot start (UTC ms). */
  start: number;
  /** Slot end, exclusive (UTC ms). */
  end: number;
}

export type WorkingHoursCheck =
  | { open: true; window: WorkingWindow }
  | { open: false; reason: WorkingHoursClosedReason; nextStart: number | null };

export interface WorkingHoursConfig {
  hours: BusinessHours;
  timezone?: string | null;
  /** Local dates `YYYY-MM-DD`. */
  holidays?: readonly string[];
}

/** JS getUTCDay() order. */
const DAY_KEYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** How far ahead nextStart looks (two weeks covers any weekly pattern plus holidays). */
const LOOKAHEAD_DAYS = 15;

function minutesOf(hhmm: string): number | null {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Local calendar day `offset` days after the day containing `at`. */
function localDay(at: number, tz: string, offset: number) {
  const p = zonedParts(new Date(at), tz);
  const midnight = zonedMidnight(p.year, p.month, p.day + offset, tz).getTime();
  const q = zonedParts(new Date(midnight), tz);
  const weekday = DAY_KEYS[new Date(Date.UTC(q.year, q.month - 1, q.day)).getUTCDay()] as Weekday;
  return { year: q.year, month: q.month, day: q.day, weekday, date: isoDate(q.year, q.month, q.day) };
}

/** Instant of local HH:MM on a local calendar date (minutes may exceed 24h for overnight ends). */
function localInstant(year: number, month: number, day: number, minutes: number, tz: string): number {
  const extraDays = Math.floor(minutes / 1440);
  const rest = minutes - extraDays * 1440;
  const midnight = zonedMidnight(year, month, day + extraDays, tz).getTime();
  // Walk from local midnight; recompute through Intl so DST jumps inside the day are honoured.
  const guess = midnight + rest * 60_000;
  const p = zonedParts(new Date(guess), tz);
  const drift = (p.hour * 60 + p.minute) - rest;
  return drift === 0 || Math.abs(drift) > 180 ? guess : guess - drift * 60_000;
}

/** Slots that START on the local day `offset` days from `at`, as absolute windows. */
function windowsOfDay(at: number, cfg: Required<Pick<WorkingHoursConfig, 'hours'>> & { tz: string; holidays: ReadonlySet<string> }, offset: number): WorkingWindow[] {
  const d = localDay(at, cfg.tz, offset);
  if (cfg.holidays.has(d.date)) return [];
  const slots = cfg.hours[d.weekday] ?? [];
  const out: WorkingWindow[] = [];
  for (const slot of slots) {
    const s = minutesOf(slot.start);
    const e = minutesOf(slot.end);
    if (s === null || e === null) continue;
    const endMinutes = e > s ? e : e + 1440; // overnight
    out.push({ start: localInstant(d.year, d.month, d.day, s, cfg.tz), end: localInstant(d.year, d.month, d.day, endMinutes, cfg.tz) });
  }
  return out.sort((a, b) => a.start - b.start);
}

function normalise(cfg: WorkingHoursConfig) {
  return { hours: cfg.hours, tz: safeTimezone(cfg.timezone), holidays: new Set(cfg.holidays ?? []) };
}

/** Is `at` (UTC ms) inside the working hours? Returns the window or why not and when it opens next. */
export function checkWorkingHours(at: number, cfg: WorkingHoursConfig): WorkingHoursCheck {
  const n = normalise(cfg);
  // Yesterday's overnight slot can still be running; today's slots; then look ahead.
  for (const offset of [-1, 0]) {
    for (const w of windowsOfDay(at, n, offset)) if (at >= w.start && at < w.end) return { open: true, window: w };
  }
  let nextStart: number | null = null;
  for (let offset = 0; offset <= LOOKAHEAD_DAYS && nextStart === null; offset++) {
    for (const w of windowsOfDay(at, n, offset)) {
      if (w.start > at) {
        nextStart = w.start;
        break;
      }
    }
  }
  const today = localDay(at, n.tz, 0);
  const reason: WorkingHoursClosedReason = n.holidays.has(today.date) ? 'holiday' : (n.hours[today.weekday] ?? []).length === 0 ? 'closed_day' : 'outside_hours';
  return { open: false, reason, nextStart };
}

export function isWithinWorkingHours(at: number, cfg: WorkingHoursConfig): boolean {
  return checkWorkingHours(at, cfg).open;
}

/** Local date `YYYY-MM-DD` of `at` in the timezone. */
export function localDateOf(at: number, timezone?: string | null): string {
  const p = zonedParts(new Date(at), safeTimezone(timezone));
  return isoDate(p.year, p.month, p.day);
}

/** Next local midnight after `at` (UTC ms). */
export function nextLocalMidnight(at: number, timezone?: string | null): number {
  const tz = safeTimezone(timezone);
  const p = zonedParts(new Date(at), tz);
  return zonedMidnight(p.year, p.month, p.day + 1, tz).getTime();
}

/** The first working window that starts on the local date `date` (YYYY-MM-DD), if any. Used by the attendance register. */
export function firstWindowOnDate(date: string, cfg: WorkingHoursConfig): WorkingWindow | null {
  const n = normalise(cfg);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const noon = zonedMidnight(y, m, d, n.tz).getTime() + 12 * 3_600_000;
  return windowsOfDay(noon, n, 0)[0] ?? null;
}

/** Every working window that starts on the local date `date`. */
export function windowsOnDate(date: string, cfg: WorkingHoursConfig): WorkingWindow[] {
  const n = normalise(cfg);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const noon = zonedMidnight(y, m, d, n.tz).getTime() + 12 * 3_600_000;
  return windowsOfDay(noon, n, 0);
}
