/**
 * Workspace-timezone date helpers (no date library). All functions take and return UTC instants (Date);
 * calendar maths happens in the given IANA timezone, e.g. "Asia/Kolkata".
 */
const FALLBACK_TZ = 'Asia/Kolkata';
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Returns a usable IANA timezone (invalid or empty values fall back to Asia/Kolkata). */
export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return FALLBACK_TZ;
  try {
    formatter(tz);
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(at: Date, tz: string): ZonedParts {
  const parts = formatter(tz).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

/** Offset of `tz` from UTC at instant `at`, in ms (IST = +19_800_000). */
function offsetMs(at: Date, tz: string): number {
  const p = zonedParts(at, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Instant of local midnight on a calendar date in `tz`. Day/month overflow is normalised (day 32 = next month). */
export function zonedMidnight(year: number, month: number, day: number, tz: string): Date {
  const utcGuess = Date.UTC(year, month - 1, day);
  const first = utcGuess - offsetMs(new Date(utcGuess), tz);
  return new Date(utcGuess - offsetMs(new Date(first), tz));
}

export function startOfZonedDay(at: Date, tz: string): Date {
  const p = zonedParts(at, tz);
  return zonedMidnight(p.year, p.month, p.day, tz);
}

/** Local midnight `days` days after the local day containing `at`. */
export function addZonedDays(at: Date, days: number, tz: string): Date {
  const p = zonedParts(at, tz);
  return zonedMidnight(p.year, p.month, p.day + days, tz);
}

export function startOfZonedMonth(at: Date, tz: string): Date {
  const p = zonedParts(at, tz);
  return zonedMidnight(p.year, p.month, 1, tz);
}

export function startOfNextZonedMonth(at: Date, tz: string): Date {
  const p = zonedParts(at, tz);
  return zonedMidnight(p.year, p.month + 1, 1, tz);
}

/** "YYYY-MM" of the local month containing `at` (Target.period format). */
export function zonedMonthKey(at: Date, tz: string): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** Today's bounds [start, end) in the workspace timezone. */
export function zonedToday(tz: string, now = new Date()): { start: Date; end: Date } {
  return { start: startOfZonedDay(now, tz), end: addZonedDays(now, 1, tz) };
}
