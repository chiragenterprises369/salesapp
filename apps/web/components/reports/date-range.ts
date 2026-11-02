import { DAY_MS, istDate, istDayStart, istMonthStart } from '@vistar/shared/fixtures';

/** Date range presets in the workspace calendar (IST). Ranges are half-open: [from, to). */
export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'last_month' | 'custom';

export const RANGE_LABEL: Record<RangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  this_month: 'This month',
  last_month: 'Last month',
  custom: 'Custom',
};

export interface Range {
  from: number;
  to: number;
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now: number): Range {
  const today = istDayStart(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today + DAY_MS };
    case 'yesterday':
      return { from: today - DAY_MS, to: today };
    case '7d':
      return { from: today - 6 * DAY_MS, to: today + DAY_MS };
    case '30d':
      return { from: today - 29 * DAY_MS, to: today + DAY_MS };
    case 'this_month':
      return { from: istMonthStart(now), to: today + DAY_MS };
    case 'last_month':
      return { from: istMonthStart(now, -1), to: istMonthStart(now) };
  }
}

/** The previous range of the same length (comparisons). */
export function previousRange(r: Range): Range {
  return { from: r.from - (r.to - r.from), to: r.from };
}

/** "YYYY-MM-DD" (IST) -> start of that IST day; null when invalid. */
export function parseIstDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}T00:00:00+05:30`);
  return Number.isNaN(t) ? null : t;
}

/** Custom range from two date inputs (inclusive days). Swaps reversed dates. */
export function customRange(fromDate: string, toDate: string): Range | null {
  const a = parseIstDate(fromDate);
  const b = parseIstDate(toDate);
  if (a === null || b === null) return null;
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return { from: lo, to: hi + DAY_MS };
}

export const toDateInput = (t: number) => istDate(t);

export function rangeLabel(r: Range, timeZone = 'Asia/Kolkata'): string {
  const f = new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short' });
  const last = r.to - 1;
  return istDayStart(r.from) === istDayStart(last) ? f.format(r.from) : `${f.format(r.from)} to ${f.format(last)}`;
}
