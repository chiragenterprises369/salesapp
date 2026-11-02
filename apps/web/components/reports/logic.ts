import type { LeadListItem, Stage } from '@vistar/shared';
import type { ReportSummary } from '@/lib/world/read';

/**
 * Report aggregations on top of the scoped `reportSummary()` (lib/world): KPI strip, SLA shares,
 * call totals, workflow success, rep sorting and the stage-weighted revenue forecast, plus the rows
 * each table exports to CSV. Pure; tested in ./logic.test.ts.
 */

export interface ReportKpis {
  leads: number;
  wonDeals: number;
  revenueInr: number;
  /** Leads created in the range that are won, as % of leads created (one decimal). */
  conversionPct: number;
  /** Average first response (minutes), weighted by each rep's leads; null without data. */
  avgResponseMin: number | null;
  calls: number;
  answeredPct: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function reportKpis(s: ReportSummary): ReportKpis {
  const leads = s.sources.reduce((a, r) => a + r.leads, 0);
  const cohortWon = s.sources.reduce((a, r) => a + r.won, 0);
  let wLeads = 0;
  let wSum = 0;
  for (const r of s.reps)
    if (r.avgResponseMin !== null && r.leads > 0) {
      wLeads += r.leads;
      wSum += r.avgResponseMin * r.leads;
    }
  const calls = s.callsByDay.reduce((a, d) => a + d.answered + d.missed, 0);
  const answered = s.callsByDay.reduce((a, d) => a + d.answered, 0);
  return {
    leads,
    wonDeals: s.reps.reduce((a, r) => a + r.won, 0),
    revenueInr: s.reps.reduce((a, r) => a + r.revenueInr, 0),
    conversionPct: leads ? round1((cohortWon / leads) * 100) : 0,
    avgResponseMin: wLeads ? Math.round(wSum / wLeads) : null,
    calls,
    answeredPct: calls ? Math.round((answered / calls) * 100) : 0,
  };
}

/** % change vs the previous period; null when there is nothing to compare with. */
export function change(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export interface SlaShare {
  key: 'within5Min' | 'within30Min' | 'later' | 'untouched';
  label: string;
  count: number;
  pct: number;
}

export const SLA_LABEL: Record<SlaShare['key'], string> = {
  within5Min: 'Within 5 min',
  within30Min: '5 to 30 min',
  later: 'Over 30 min',
  untouched: 'Not contacted yet',
};

/** Response-time SLA buckets with shares that add up to 100 (largest remainder). */
export function slaShares(sla: ReportSummary['responseSla']): SlaShare[] {
  const keys = ['within5Min', 'within30Min', 'later', 'untouched'] as const;
  const total = keys.reduce((a, k) => a + sla[k], 0);
  if (!total) return keys.map((k) => ({ key: k, label: SLA_LABEL[k], count: 0, pct: 0 }));
  const raw = keys.map((k) => (sla[k] / total) * 100);
  const floors = raw.map(Math.floor);
  let rest = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - floors[i]!, i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    floors[i]!++;
    rest--;
  }
  return keys.map((k, i) => ({ key: k, label: SLA_LABEL[k], count: sla[k], pct: floors[i]! }));
}

export const successRate = (w: { runs: number; completed: number; failed: number }) => {
  const finished = w.completed + w.failed;
  return finished ? Math.round((w.completed / finished) * 100) : null;
};

export type RepSortKey = 'name' | 'leads' | 'calls' | 'answeredPct' | 'won' | 'revenueInr' | 'avgResponseMin';

export function sortReps(reps: ReportSummary['reps'], key: RepSortKey, dir: 'asc' | 'desc'): ReportSummary['reps'] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...reps].sort((a, b) => {
    if (key === 'name') return sign * a.user.name.localeCompare(b.user.name);
    const av = a[key] ?? Number.POSITIVE_INFINITY;
    const bv = b[key] ?? Number.POSITIVE_INFINITY;
    return sign * (av - bv) || a.user.name.localeCompare(b.user.name);
  });
}

export interface ForecastRow {
  stageId: string;
  name: string;
  probability: number;
  leads: number;
  valueInr: number;
  weightedInr: number;
}

/**
 * Revenue forecast: open pipeline value per stage weighted by the stage probability. `visible` is the
 * viewer's user ids (null = everyone); unassigned leads count only for everyone. Same rule as
 * reportSummary().forecastInr, broken down by stage.
 */
export function forecastByStage(leads: readonly LeadListItem[], stages: readonly Stage[], visible: ReadonlySet<string> | null): ForecastRow[] {
  const rows = new Map(stages.filter((s) => s.type === 'open').map((s) => [s.id, { stageId: s.id, name: s.name, probability: s.probability ?? 0, leads: 0, valueInr: 0, weightedInr: 0 }]));
  for (const l of leads) {
    if (visible !== null && !(l.owner && visible.has(l.owner.id))) continue;
    const r = rows.get(l.stageId);
    if (!r) continue;
    r.leads++;
    r.valueInr += l.valueInr;
    r.weightedInr += (l.valueInr * r.probability) / 100;
  }
  return [...rows.values()].map((r) => ({ ...r, weightedInr: Math.round(r.weightedInr) }));
}

export function callDayTotals(days: ReportSummary['callsByDay']) {
  const answered = days.reduce((a, d) => a + d.answered, 0);
  const missed = days.reduce((a, d) => a + d.missed, 0);
  const busiest = days.reduce<(typeof days)[number] | null>((best, d) => (!best || d.answered + d.missed > best.answered + best.missed ? d : best), null);
  return { answered, missed, total: answered + missed, answerRate: answered + missed ? Math.round((answered / (answered + missed)) * 100) : 0, busiest };
}
