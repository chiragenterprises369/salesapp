import type { TargetMetric } from '@vistar/shared';
import { DAY_MS, istMonthStart, istPeriod, type MockTarget } from '@vistar/shared/fixtures';

/** Targets page helpers: progress, month pace, current vs previous month rows. Tested in ./logic.test.ts. */

export const METRICS: readonly TargetMetric[] = ['revenue_inr', 'deals_won', 'calls', 'leads_converted'];

export const pct = (achieved: number, target: number) => (target > 0 ? Math.round((achieved / target) * 100) : 0);

/** "YYYY-MM" of this month and the previous one (IST). */
export function periodsFor(now: number): { current: string; previous: string } {
  return { current: istPeriod(now), previous: istPeriod(istMonthStart(now, -1) + DAY_MS) };
}

/** How far through the month we are (IST). A past period is complete (100%). */
export function monthElapsed(period: string, now: number): { day: number; days: number; pct: number; complete: boolean } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const start = Date.UTC(y, m - 1, 1) - 330 * 60_000;
  const end = Date.UTC(y, m, 1) - 330 * 60_000;
  const days = Math.round((end - start) / DAY_MS);
  if (now >= end) return { day: days, days, pct: 100, complete: true };
  const day = Math.max(1, Math.ceil((now - start) / DAY_MS));
  return { day, days, pct: Math.round(((now - start) / (end - start)) * 100), complete: false };
}

export type Pace = 'hit' | 'ahead' | 'on_track' | 'behind' | 'missed';

/** Compare progress with the share of the month gone: within 10 points = on track. */
export function paceOf(progress: number, elapsedPct: number, complete: boolean): Pace {
  if (progress >= 100) return 'hit';
  if (complete) return 'missed';
  if (progress >= elapsedPct + 10) return 'ahead';
  if (progress >= elapsedPct - 10) return 'on_track';
  return 'behind';
}

export interface MetricProgress {
  target: number;
  achieved: number;
  pct: number;
  /** The same metric's final progress in the previous month (null if no target then). */
  prevPct: number | null;
  prevAchieved: number | null;
}

export interface SubjectRow {
  subjectType: 'user' | 'team';
  subjectId: string;
  subjectName: string;
  metrics: Partial<Record<TargetMetric, MetricProgress>>;
}

/** One row per person or team that has targets in `period`, with the previous period for comparison. Teams first, then by revenue progress. */
export function targetRows(targets: readonly MockTarget[], period: string, previous: string): SubjectRow[] {
  const prev = new Map(targets.filter((t) => t.period === previous).map((t) => [`${t.subjectId}:${t.metric}`, t]));
  const rows = new Map<string, SubjectRow>();
  for (const t of targets) {
    if (t.period !== period) continue;
    const row = rows.get(t.subjectId) ?? { subjectType: t.subjectType, subjectId: t.subjectId, subjectName: t.subjectName, metrics: {} };
    const p = prev.get(`${t.subjectId}:${t.metric}`);
    row.metrics[t.metric] = { target: t.target, achieved: t.achieved, pct: pct(t.achieved, t.target), prevPct: p ? pct(p.achieved, p.target) : null, prevAchieved: p ? p.achieved : null };
    rows.set(t.subjectId, row);
  }
  return [...rows.values()].sort((a, b) => {
    if (a.subjectType !== b.subjectType) return a.subjectType === 'team' ? -1 : 1;
    return (b.metrics.revenue_inr?.pct ?? 0) - (a.metrics.revenue_inr?.pct ?? 0) || a.subjectName.localeCompare(b.subjectName);
  });
}

/** Totals of the people rows for one metric (sum of targets and achieved). */
export function sumMetric(rows: readonly SubjectRow[], metric: TargetMetric): { target: number; achieved: number; pct: number } {
  let target = 0;
  let achieved = 0;
  for (const r of rows) {
    if (r.subjectType !== 'user') continue;
    const m = r.metrics[metric];
    if (!m) continue;
    target += m.target;
    achieved += m.achieved;
  }
  return { target, achieved, pct: pct(achieved, target) };
}

/** "2026-01" -> "2025-12". */
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
