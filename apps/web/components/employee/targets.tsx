import { formatInr, formatNumber, type MyToday, type TargetMetric } from '@vistar/shared';
import { ProgressRing } from '@/components/common/progress-ring';

export const TARGET_LABEL: Record<TargetMetric, string> = {
  revenue_inr: 'Revenue',
  deals_won: 'Deals won',
  calls: 'Calls',
  leads_converted: 'Leads converted',
};

const fmt = (metric: TargetMetric, n: number) => (metric === 'revenue_inr' ? formatInr(n, { compact: true }) : formatNumber(n));

/** Monthly target rings with "achieved of target" captions. */
export function TargetRings({ targets }: { targets: MyToday['targets'] }) {
  if (targets.length === 0) return <p className="text-sm text-muted">No targets set for this month. Your manager sets them.</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {targets.map((t) => {
        const pct = t.target > 0 ? (t.achieved / t.target) * 100 : 0;
        return (
          <li key={t.metric} className="flex flex-col items-center gap-1.5 rounded-md bg-surface-2 p-3 text-center">
            <ProgressRing value={pct} label={`${TARGET_LABEL[t.metric]}: ${fmt(t.metric, t.achieved)} of ${fmt(t.metric, t.target)}, ${Math.round(pct)} percent`} />
            <span className="text-xs font-medium text-fg">{TARGET_LABEL[t.metric]}</span>
            <span className="text-2xs text-muted-strong tabular" aria-hidden>
              {fmt(t.metric, t.achieved)} of {fmt(t.metric, t.target)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
