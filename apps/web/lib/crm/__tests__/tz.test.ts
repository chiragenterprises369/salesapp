import { describe, expect, it } from 'vitest';
import { addDays, addMonths, dayKeyIn, instantAt, minutesInDay, monthGrid, startOfWeek, tzOffsetMinutes, weekdayOf, zonedParts, zonedToUtc } from '../tz';

describe('time zone helpers', () => {
  it('reads wall-clock parts in Asia/Kolkata', () => {
    const p = zonedParts('2026-11-03T04:30:00Z', 'Asia/Kolkata');
    expect(p).toMatchObject({ year: 2026, month: 11, day: 3, hour: 10, minute: 0, weekday: 2 });
  });

  it('computes offsets and round-trips wall-clock times', () => {
    expect(tzOffsetMinutes(new Date('2026-11-03T00:00:00Z'), 'Asia/Kolkata')).toBe(330);
    expect(zonedToUtc({ year: 2026, month: 11, day: 3, hour: 10, minute: 0 }, 'Asia/Kolkata').toISOString()).toBe('2026-11-03T04:30:00.000Z');
    expect(instantAt('2026-11-03', 9 * 60 + 15, 'Asia/Kolkata').toISOString()).toBe('2026-11-03T03:45:00.000Z');
    expect(minutesInDay('2026-11-03T03:45:00Z', 'Asia/Kolkata')).toBe(555);
  });

  it('handles a zone with daylight saving (Europe/London)', () => {
    expect(zonedToUtc({ year: 2026, month: 7, day: 1, hour: 9 }, 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc({ year: 2026, month: 12, day: 1, hour: 9 }, 'Europe/London').toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });

  it('does calendar arithmetic on day keys', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(weekdayOf('2026-11-03')).toBe(2);
    expect(startOfWeek('2026-11-03')).toBe('2026-11-02');
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02');
    expect(dayKeyIn('2026-11-02T20:00:00Z', 'Asia/Kolkata')).toBe('2026-11-03');
  });

  it('builds a six-week month grid starting on Monday', () => {
    const grid = monthGrid('2026-11-15');
    expect(grid).toHaveLength(6);
    expect(grid[0]![0]).toBe('2026-10-26');
    expect(grid.flat()).toContain('2026-11-30');
  });
});
