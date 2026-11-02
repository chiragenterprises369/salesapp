import { DEFAULT_BUSINESS_HOURS, type BusinessHours } from '@vistar/shared';
import { describe, expect, it } from 'vitest';
import { checkWorkingHours, firstWindowOnDate, isWithinWorkingHours, localDateOf, nextLocalMidnight, windowsOnDate } from './working-hours.js';

const IST = 'Asia/Kolkata';
const t = (iso: string) => Date.parse(iso);
const cfg = (hours: BusinessHours = DEFAULT_BUSINESS_HOURS, extra: { timezone?: string; holidays?: string[] } = {}) => ({ hours, timezone: extra.timezone ?? IST, holidays: extra.holidays ?? [] });

// 2026-11-02 is a Monday. IST = UTC+05:30. Default hours: Mon-Fri 09:30-18:30, Sat 10:00-14:00, Sun closed.
describe('working-hours gate (Asia/Kolkata)', () => {
  it('opens at 09:30 IST exactly (04:00 UTC) and not a minute before', () => {
    expect(isWithinWorkingHours(t('2026-11-02T03:59:59.999Z'), cfg())).toBe(false);
    expect(isWithinWorkingHours(t('2026-11-02T04:00:00.000Z'), cfg())).toBe(true);
  });

  it('end is exclusive: 18:30 IST (13:00 UTC) is outside', () => {
    expect(isWithinWorkingHours(t('2026-11-02T12:59:59.999Z'), cfg())).toBe(true);
    expect(isWithinWorkingHours(t('2026-11-02T13:00:00.000Z'), cfg())).toBe(false);
  });

  it('returns the window in absolute time', () => {
    const r = checkWorkingHours(t('2026-11-02T06:00:00Z'), cfg());
    expect(r).toEqual({ open: true, window: { start: t('2026-11-02T04:00:00Z'), end: t('2026-11-02T13:00:00Z') } });
  });

  it('uses the IST weekday, not the UTC one, across midnight', () => {
    // Sunday 2026-11-01 20:00 UTC = Monday 01:30 IST (outside, but the day is Monday): next start Mon 09:30
    const r = checkWorkingHours(t('2026-11-01T20:00:00Z'), cfg());
    expect(r).toEqual({ open: false, reason: 'outside_hours', nextStart: t('2026-11-02T04:00:00Z') });
    // Saturday 2026-11-07 18:29 UTC = Saturday 23:59 IST; 18:30 UTC = Sunday 00:00 IST (closed day)
    expect(checkWorkingHours(t('2026-11-07T18:29:00Z'), cfg())).toMatchObject({ open: false, reason: 'outside_hours' });
    expect(checkWorkingHours(t('2026-11-07T18:30:00Z'), cfg())).toMatchObject({ open: false, reason: 'closed_day', nextStart: t('2026-11-09T04:00:00Z') });
  });

  it('Saturday short hours', () => {
    expect(isWithinWorkingHours(t('2026-11-07T04:30:00Z'), cfg())).toBe(true); // 10:00 IST
    expect(isWithinWorkingHours(t('2026-11-07T08:30:00Z'), cfg())).toBe(false); // 14:00 IST
  });

  it('holidays close the day and report the next opening', () => {
    const r = checkWorkingHours(t('2026-11-02T06:00:00Z'), cfg(DEFAULT_BUSINESS_HOURS, { holidays: ['2026-11-02'] }));
    expect(r).toEqual({ open: false, reason: 'holiday', nextStart: t('2026-11-03T04:00:00Z') });
  });

  it('several slots per day (lunch gap)', () => {
    const hours: BusinessHours = { ...DEFAULT_BUSINESS_HOURS, mon: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] };
    expect(isWithinWorkingHours(t('2026-11-02T07:00:00Z'), cfg(hours))).toBe(true); // 12:30
    const gap = checkWorkingHours(t('2026-11-02T08:00:00Z'), cfg(hours)); // 13:30
    expect(gap).toEqual({ open: false, reason: 'outside_hours', nextStart: t('2026-11-02T08:30:00Z') });
  });

  it('overnight slots belong to the start day and run into the next day', () => {
    const hours: BusinessHours = { mon: [{ start: '22:00', end: '06:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    // Mon 23:00 IST = Mon 17:30 UTC
    expect(isWithinWorkingHours(t('2026-11-02T17:30:00Z'), cfg(hours))).toBe(true);
    // Tue 05:59 IST = Tue 00:29 UTC (tail of Monday's slot, although Tuesday is closed)
    expect(isWithinWorkingHours(t('2026-11-03T00:29:00Z'), cfg(hours))).toBe(true);
    // Tue 06:00 IST = end
    expect(isWithinWorkingHours(t('2026-11-03T00:30:00Z'), cfg(hours))).toBe(false);
    // A holiday on Tuesday does not cut Monday's tail
    expect(isWithinWorkingHours(t('2026-11-03T00:00:00Z'), cfg(hours, { holidays: ['2026-11-03'] }))).toBe(true);
  });

  it('other timezones, including DST (Europe/London, clocks back 2026-10-25)', () => {
    const london = cfg(DEFAULT_BUSINESS_HOURS, { timezone: 'Europe/London' });
    // Mon 2026-10-19 (BST, UTC+1): 09:30 local = 08:30 UTC
    expect(isWithinWorkingHours(t('2026-10-19T08:30:00Z'), london)).toBe(true);
    expect(isWithinWorkingHours(t('2026-10-19T08:29:00Z'), london)).toBe(false);
    // Mon 2026-10-26 (GMT, UTC+0): 09:30 local = 09:30 UTC
    expect(isWithinWorkingHours(t('2026-10-26T09:29:00Z'), london)).toBe(false);
    expect(isWithinWorkingHours(t('2026-10-26T09:30:00Z'), london)).toBe(true);
  });

  it('an invalid timezone falls back to Asia/Kolkata', () => {
    expect(isWithinWorkingHours(t('2026-11-02T04:00:00Z'), cfg(DEFAULT_BUSINESS_HOURS, { timezone: 'Mars/Olympus' }))).toBe(true);
  });

  it('a week with no hours never opens', () => {
    const closed: BusinessHours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    expect(checkWorkingHours(t('2026-11-02T06:00:00Z'), cfg(closed))).toEqual({ open: false, reason: 'closed_day', nextStart: null });
  });

  it('malformed slots are skipped, not thrown', () => {
    const bad = { ...DEFAULT_BUSINESS_HOURS, mon: [{ start: '9:30', end: '18:30' }] } as BusinessHours;
    expect(isWithinWorkingHours(t('2026-11-02T06:00:00Z'), cfg(bad))).toBe(false);
  });

  it('local date and next midnight in IST', () => {
    expect(localDateOf(t('2026-11-01T18:29:59Z'), IST)).toBe('2026-11-01');
    expect(localDateOf(t('2026-11-01T18:30:00Z'), IST)).toBe('2026-11-02');
    expect(nextLocalMidnight(t('2026-11-02T06:00:00Z'), IST)).toBe(t('2026-11-02T18:30:00Z'));
  });

  it('windows of a date (attendance register)', () => {
    expect(firstWindowOnDate('2026-11-02', cfg())).toEqual({ start: t('2026-11-02T04:00:00Z'), end: t('2026-11-02T13:00:00Z') });
    expect(firstWindowOnDate('2026-11-08', cfg())).toBeNull(); // Sunday
    expect(windowsOnDate('2026-11-02', cfg(DEFAULT_BUSINESS_HOURS, { holidays: ['2026-11-02'] }))).toEqual([]);
  });
});
