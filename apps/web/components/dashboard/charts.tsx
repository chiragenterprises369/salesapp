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
import { useLeadWords } from '@/components/leads/use-lead-words';
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

/** Funnel by stage: Rivet-styled rounded bars, vibrant lime gradient. */
export function FunnelChart({ funnel }: { funnel: DashboardSummary['funnel'] }) {
  const w = useLeadWords();
  const top = funnel[0]?.count || 1;
  return (
    <div>
      <ol className="flex flex-col gap-3" aria-hidden>
        {funnel.map((s, i) => {
          const pct = (s.count / top) * 100;
          return (
            <li
              key={s.stageId}
              className="grid grid-cols-[80px_minmax(0,1fr)_40px] sm:grid-cols-[100px_minmax(0,1fr)_44px_120px] items-center gap-3 text-xs"
            >
              <span className="truncate font-semibold text-ink text-[12.5px]">{s.name}</span>
              <span className="relative h-5 overflow-hidden rounded-full bg-well shadow-[inset_0_0_0_1px_var(--hair)]">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent to-accent-hi transition-[width] duration-500 ease-[var(--ease)] shadow-[0_0_12px_rgba(212,255,63,0.35)]"
                  style={{ width: `${Math.max(pct, s.count ? 2 : 0)}%` }}
                />
              </span>
              <span className="tabular text-right font-bold text-ink text-xs">
                {formatNumber(s.count)}
              </span>
              <span className="tabular hidden truncate text-right font-semibold text-faint sm:block text-xs">
                {formatInr(s.valueInr, { compact: true })} · {Math.round(pct)}%
              </span>
            </li>
          );
        })}
      </ol>
      <SrTable
        caption={`${w.Leads} by stage`}
        head={['Stage', w.Leads, 'Value', 'Share of first stage']}
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
  const w = useLeadWords();
  const data = sources
    .map((s) => ({ name: SOURCE_LABEL[s.source], count: s.count, won: s.wonValueInr }))
    .sort((a, b) => b.count - a.count);
  if (data.length === 0)
    return <p className="py-8 text-center text-sm text-muted">No new {w.leads} in this period.</p>;
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
            <Tooltip {...tip} formatter={(v) => [formatNumber(Number(v)), w.Leads]} />
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
        caption={`${w.Leads} by source`}
        head={['Source', w.Leads, 'Won value']}
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
              radius={[0, 0, 4, 4]}
              isAnimationActive={!reduced}
              animationDuration={350}
            />
            <Bar
              dataKey="missed"
              name="Missed"
              stackId="c"
              fill={p['chart-2']}
              radius={[4, 4, 0, 0]}
              isAnimationActive={!reduced}
              animationDuration={350}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div aria-hidden className="mt-3 flex items-center gap-4 text-xs font-semibold text-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-accent" /> Answered
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#3ef2ff]" /> Missed
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
