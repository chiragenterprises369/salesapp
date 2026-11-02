/**
 * Wall-clock helpers in a given IANA time zone (the workspace timezone), without a date library
 * time-zone add-on. Calendar days are "YYYY-MM-DD" keys; arithmetic on keys is pure calendar math.
 */

export interface ZonedParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function zonedParts(at: Date | string | number, timeZone: string): ZonedParts {
  const d = at instanceof Date ? at : new Date(at);
  const parts = formatterFor(timeZone).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  };
}

/** Minutes the zone is ahead of UTC at this instant (Asia/Kolkata = 330). */
export function tzOffsetMinutes(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(at.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

/** Wall-clock time in the zone -> instant. */
export function zonedToUtc(p: { year: number; month: number; day: number; hour?: number; minute?: number }, timeZone: string): Date {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour ?? 0, p.minute ?? 0);
  let offset = tzOffsetMinutes(new Date(guess), timeZone);
  let result = guess - offset * 60_000;
  const check = tzOffsetMinutes(new Date(result), timeZone);
  if (check !== offset) {
    offset = check;
    result = guess - offset * 60_000;
  }
  return new Date(result);
}

const pad = (n: number) => String(n).padStart(2, '0');

export const dayKeyOf = (p: { year: number; month: number; day: number }) => `${p.year}-${pad(p.month)}-${pad(p.day)}`;

export function parseDayKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y ?? 1970, month: m ?? 1, day: d ?? 1 };
}

/** Day key of an instant in the zone. */
export const dayKeyIn = (at: Date | string | number, timeZone: string) => dayKeyOf(zonedParts(at, timeZone));

export function addDays(key: string, n: number): string {
  const { year, month, day } = parseDayKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return dayKeyOf({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

export function addMonths(key: string, n: number): string {
  const { year, month } = parseDayKey(key);
  const d = new Date(Date.UTC(year, month - 1 + n, 1));
  return dayKeyOf({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: 1 });
}

export function weekdayOf(key: string): number {
  const { year, month, day } = parseDayKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Monday-first weeks (Indian business calendars). */
export function startOfWeek(key: string, weekStartsOn = 1): string {
  const wd = weekdayOf(key);
  return addDays(key, -((wd - weekStartsOn + 7) % 7));
}

export const startOfMonth = (key: string) => `${key.slice(0, 7)}-01`;

/** Six weeks of day keys covering the month of `key`. */
export function monthGrid(key: string, weekStartsOn = 1): string[][] {
  const first = startOfWeek(startOfMonth(key), weekStartsOn);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
}

/** Minutes since local midnight of an instant in the zone. */
export function minutesInDay(at: Date | string | number, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  return p.hour * 60 + p.minute;
}

/** Instant at `minutes` after midnight of a day key in the zone. */
export function instantAt(key: string, minutes: number, timeZone: string): Date {
  const { year, month, day } = parseDayKey(key);
  const m = Math.max(0, Math.round(minutes));
  return zonedToUtc({ year, month, day, hour: Math.floor(m / 60), minute: m % 60 }, timeZone);
}

/** Inclusive list of day keys from a to b. */
export function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let k = a; k <= b && out.length < 400; k = addDays(k, 1)) out.push(k);
  return out;
}

/** "Mon, 3 Nov" style label of a day key (independent of the browser zone). */
export function dayLabel(key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  const { year, month, day } = parseDayKey(key);
  return new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/** "2:30 pm" of an instant in the zone. */
export function timeLabel(at: Date | string | number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(at instanceof Date ? at : new Date(at));
}

/** "HH:MM" for <input type="time"> from an instant in the zone. */
export function hhmmIn(at: Date | string | number, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
