import type { BusinessHours } from '@vistar/shared';
import { describe, expect, it } from 'vitest';
import { addDays, detectStops, formatDistance, formatPlace, formatWorked, haversineM, initials, isStale, lateMinutes, splitBySession, STALE_AFTER_MS, todayIn, type RoutePoint } from './logic';

/** Attendance helpers (D-063). Run: pnpm --filter @vistar/web test (Kiro Crew). */

const TZ = 'Asia/Kolkata';
const HOURS: BusinessHours = {
  mon: [{ start: '09:30', end: '18:30' }],
  tue: [{ start: '09:30', end: '18:30' }],
  wed: [{ start: '09:30', end: '18:30' }],
  thu: [{ start: '09:30', end: '18:30' }],
  fri: [{ start: '09:30', end: '18:30' }],
  sat: [{ start: '10:00', end: '14:00' }],
  sun: [],
};

describe('lateMinutes', () => {
  // 2026-11-03 is a Tuesday. 09:30 IST = 04:00 UTC.
  it('is null within the 15 minute grace and counts minutes after the start beyond it', () => {
    expect(lateMinutes('2026-11-03T04:10:00.000Z', HOURS, TZ)).toBeNull();
    expect(lateMinutes('2026-11-03T04:15:00.000Z', HOURS, TZ)).toBeNull();
    expect(lateMinutes('2026-11-03T04:25:00.000Z', HOURS, TZ)).toBe(25);
  });
  it('is null on closed days and without a check-in', () => {
    expect(lateMinutes('2026-11-08T06:00:00.000Z', HOURS, TZ)).toBeNull();
    expect(lateMinutes(null, HOURS, TZ)).toBeNull();
  });
  it('uses the workspace timezone, not the browser clock', () => {
    // 10:20 IST on Saturday (start 10:00): 20 min late.
    expect(lateMinutes('2026-11-07T04:50:00.000Z', HOURS, TZ)).toBe(20);
  });
});

describe('dates and formats', () => {
  it('todayIn and addDays', () => {
    expect(todayIn(TZ, Date.parse('2026-11-02T20:00:00.000Z'))).toBe('2026-11-03');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('formats hours, distances and places', () => {
    expect(formatWorked(0)).toBe('0 min');
    expect(formatWorked(45)).toBe('45 min');
    expect(formatWorked(120)).toBe('2 h');
    expect(formatWorked(445)).toBe('7 h 25 min');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(4230)).toBe('4.2 km');
    expect(formatPlace({ lat: 19.076, lng: 72.8777, accuracy: 12.4 })).toBe('19.07600, 72.87770 (±12 m)');
    expect(initials('Priya Sharma')).toBe('PS');
    expect(initials('Ravi')).toBe('R');
  });
});

describe('geometry', () => {
  it('haversine: about 1.1 km for 0.01 degree of latitude', () => {
    const d = haversineM({ lat: 19, lng: 72.8 }, { lat: 19.01, lng: 72.8 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1125);
  });

  const at = (min: number) => new Date(Date.parse('2026-11-03T05:00:00.000Z') + min * 60_000).toISOString();
  const walk: RoutePoint[] = [
    { lat: 19.0, lng: 72.8, at: at(0), sessionId: 's1' },
    { lat: 19.005, lng: 72.8, at: at(2), sessionId: 's1' },
    // 14 minutes in one place (within 100 m)
    { lat: 19.01, lng: 72.8, at: at(4), sessionId: 's1' },
    { lat: 19.0102, lng: 72.8001, at: at(10), sessionId: 's1' },
    { lat: 19.0101, lng: 72.8002, at: at(18), sessionId: 's1' },
    { lat: 19.02, lng: 72.81, at: at(20), sessionId: 's1' },
    // new session after a check-out and check-in
    { lat: 19.03, lng: 72.82, at: at(60), sessionId: 's2' },
    { lat: 19.031, lng: 72.82, at: at(62), sessionId: 's2' },
  ];

  it('finds stops of at least 10 minutes within 100 m, in order', () => {
    const stops = detectStops(walk);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ index: 1, from: at(4), to: at(18), durationMin: 14, points: 3 });
  });

  it('never joins points of two sessions into one stop', () => {
    const stops = detectStops([
      { lat: 19.0, lng: 72.8, at: at(0), sessionId: 'a' },
      { lat: 19.0, lng: 72.8, at: at(30), sessionId: 'b' },
    ]);
    expect(stops).toHaveLength(0);
  });

  it('splits the polyline per session', () => {
    const lines = splitBySession(walk);
    expect(lines.map((l) => [l.sessionId, l.points.length])).toEqual([
      ['s1', 6],
      ['s2', 2],
    ]);
  });
});

describe('isStale', () => {
  it('after two location intervals, or when the server says so', () => {
    const now = Date.parse('2026-11-03T05:00:00.000Z');
    expect(isStale(new Date(now - STALE_AFTER_MS + 1000).toISOString(), now)).toBe(false);
    expect(isStale(new Date(now - STALE_AFTER_MS - 1000).toISOString(), now)).toBe(true);
    expect(isStale(new Date(now).toISOString(), now, true)).toBe(true);
  });
});
