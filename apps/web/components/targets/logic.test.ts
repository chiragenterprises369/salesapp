import type { MockTarget } from '@vistar/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { monthElapsed, paceOf, pct, periodsFor, previousPeriod, sumMetric, targetRows } from './logic';

const t = (o: Partial<MockTarget>): MockTarget => ({ id: 'x', subjectType: 'user', subjectId: 'u1', subjectName: 'Rohit', metric: 'revenue_inr', period: '2026-11', target: 100, achieved: 50, ...o });

describe('targets logic', () => {
  it('progress and periods', () => {
    expect(pct(50, 200)).toBe(25);
    expect(pct(5, 0)).toBe(0);
    expect(periodsFor(Date.parse('2026-11-02T06:30:00Z'))).toEqual({ current: '2026-11', previous: '2026-10' });
    expect(periodsFor(Date.parse('2026-01-01T00:30:00Z'))).toEqual({ current: '2026-01', previous: '2025-12' });
    expect(previousPeriod('2026-01')).toBe('2025-12');
  });

  it('month pace in IST', () => {
    const e = monthElapsed('2026-11', Date.parse('2026-11-16T00:00:00+05:30'));
    expect(e).toMatchObject({ day: 15, days: 30, complete: false });
    expect(e.pct).toBe(50);
    expect(monthElapsed('2026-10', Date.parse('2026-11-02T00:00:00Z'))).toMatchObject({ pct: 100, complete: true, days: 31 });
    expect(paceOf(100, 40, false)).toBe('hit');
    expect(paceOf(55, 40, false)).toBe('ahead');
    expect(paceOf(35, 40, false)).toBe('on_track');
    expect(paceOf(10, 40, false)).toBe('behind');
    expect(paceOf(80, 100, true)).toBe('missed');
  });

  it('rows compare with the previous month and put teams first', () => {
    const rows = targetRows(
      [
        t({}),
        t({ period: '2026-10', achieved: 90 }),
        t({ subjectType: 'team', subjectId: 'team1', subjectName: 'Inside Sales', target: 1000, achieved: 100 }),
        t({ subjectId: 'u2', subjectName: 'Sneha', achieved: 80 }),
      ],
      '2026-11',
      '2026-10',
    );
    expect(rows.map((r) => r.subjectId)).toEqual(['team1', 'u2', 'u1']);
    expect(rows[2]!.metrics.revenue_inr).toMatchObject({ pct: 50, prevPct: 90 });
    expect(rows[1]!.metrics.revenue_inr!.prevPct).toBeNull();
    expect(sumMetric(rows, 'revenue_inr')).toEqual({ target: 200, achieved: 130, pct: 65 });
  });
});
