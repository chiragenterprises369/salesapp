'use client';

import { formatInr, formatNumber, type DashboardSummary } from '@vistar/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { SOURCE_LABEL } from '@/components/leads/lead-meta';
import { useChartPalette } from './panel';

const SERIES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'] as const;

function useTooltipStyle() {
  const p = useChartPalette();
  return {
    contentStyle: {
      background: p.surface,
      border: `1px solid ${p.border}`,
      borderRadius: 8,
      boxShadow: p['elevation-3'],
      fontSize: 12,
      color: p.fg,
    },
    labelStyle: { color: p.fg, fontWeight: 500 },
    itemStyle: { color: p['fg-secondary'] },
    cursor: { fill: p['surface-3'] },
  };
}

/** Text equivalent for screen readers (charts are aria-hidden). */
function SrTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: Array<Array<string | number>>;
}) {
  // Wrapped in a div: tables ignore the 1px width of sr-only and would overflow narrow viewports.
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[0])}>
              {r.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={i}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Funnel by stage: horizontal bars, share of the first stage on the right. */
export function FunnelChart({ funnel }: { funnel: DashboardSummary['funnel'] }) {
  const top = funnel[0]?.count || 1;
  return (
    <div>
      <ol className="flex flex-col gap-2" aria-hidden>
        {funnel.map((s, i) => {
          const pct = (s.count / top) * 100;
          return (
            <li
              key={s.stageId}
              className="grid grid-cols-[72px_minmax(0,1fr)_36px] sm:grid-cols-[80px_minmax(0,1fr)_36px_112px] items-center gap-3 text-xs"
            >
              <span className="truncate text-fg-secondary">{s.name}</span>
              <span className="relative h-5 overflow-hidden rounded-sm bg-surface-2">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm bg-chart-1 transition-[width] duration-250 ease-standard"
                  style={{ width: `${Math.max(pct, s.count ? 2 : 0)}%`, opacity: 1 - i * 0.14 }}
                />
              </span>
              <span className="tabular text-right font-medium text-fg">
                {formatNumber(s.count)}
              </span>
              <span className="tabular hidden truncate text-right text-muted sm:block">
                {formatInr(s.valueInr, { compact: true })} · {Math.round(pct)}%
              </span>
            </li>
          );
        })}
      </ol>
      <SrTable
        caption="Leads by stage"
        head={['Stage', 'Leads', 'Value', 'Share of first stage']}
        rows={funnel.map((s) => [
          s.name,
          s.count,
          formatInr(s.valueInr),
          `${Math.round((s.count / top) * 100)}%`,
        ])}
      />
    </div>
  );
}

export function SourcesChart({ sources }: { sources: DashboardSummary['sources'] }) {
  const p = useChartPalette();
  const reduced = useReducedMotion();
  const tip = useTooltipStyle();
  const data = sources
    .map((s) => ({ name: SOURCE_LABEL[s.source], count: s.count, won: s.wonValueInr }))
    .sort((a, b) => b.count - a.count);
  if (data.length === 0)
    return <p className="py-8 text-center text-sm text-muted">No new leads in this period.</p>;
  return (
    <div>
      <div aria-hidden style={{ height: Math.max(140, data.length * 32) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={84}
              tickLine={false}
              axisLine={false}
              tick={{ fill: p['chart-axis'], fontSize: 12 }}
            />
            <Tooltip {...tip} formatter={(v) => [formatNumber(Number(v)), 'Leads']} />
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              barSize={16}
              isAnimationActive={!reduced}
              animationDuration={250}
            >
              {data.map((d, i) => (
                <Cell key={d.name} fill={p[SERIES[i % SERIES.length] ?? 'chart-1']} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SrTable
        caption="Leads by source"
        head={['Source', 'Leads', 'Won value']}
        rows={data.map((d) => [d.name, d.count, formatInr(d.won)])}
      />
    </div>
  );
}

export function CallsPerHourChart({ data }: { data: DashboardSummary['callsPerHour'] }) {
  const p = useChartPalette();
  const reduced = useReducedMotion();
  const tip = useTooltipStyle();
  const label = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
  const rows = data.map((d) => ({ ...d, label: label(d.hour) }));
  return (
    <div>
      <div aria-hidden className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 4, right: 4, bottom: 0, left: -16 }}
            accessibilityLayer={false}
          >
            <CartesianGrid vertical={false} stroke={p['chart-grid']} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: p['chart-axis'], fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={6}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: p['chart-axis'], fontSize: 11 }}
              allowDecimals={false}
            />
            <Tooltip {...tip} />
            <Bar
              dataKey="answered"
              name="Answered"
              stackId="c"
              fill={p['chart-1']}
              isAnimationActive={!reduced}
              animationDuration={250}
            />
            <Bar
              dataKey="missed"
              name="Missed"
              stackId="c"
              fill={p['chart-5']}
              radius={[3, 3, 0, 0]}
              isAnimationActive={!reduced}
              animationDuration={250}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div aria-hidden className="mt-2 flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-chart-1" /> Answered
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-chart-5" /> Missed
        </span>
      </div>
      <SrTable
        caption="Calls per hour"
        head={['Hour', 'Answered', 'Missed']}
        rows={rows.map((r) => [r.label, r.answered, r.missed])}
      />
    </div>
  );
}
