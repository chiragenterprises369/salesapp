'use client';

import type { Kpi } from '@vistar/shared';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { AnimatedNumber } from './animated-number';
import { useChartPalette } from './panel';

export interface KpiCardProps {
  label: string;
  kpi: Kpi;
  format: (n: number) => string;
  /** Lower is better (e.g. response time): a drop is shown as good. */
  lowerIsBetter?: boolean;
  /** Chart series token, e.g. "chart-1". */
  series?: 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'chart-6';
}

/** KPI with a tick-up number, change vs the previous period and a live sparkline. */
export function KpiCard({ label, kpi, format, lowerIsBetter, series = 'chart-1' }: KpiCardProps) {
  const palette = useChartPalette();
  const reduced = useReducedMotion();
  const color = palette[series];
  const delta = kpi.previous
    ? ((kpi.value - kpi.previous) / Math.max(1, Math.abs(kpi.previous))) * 100
    : null;
  const good = delta === null ? null : lowerIsBetter ? delta <= 0 : delta >= 0;
  const data = kpi.sparkline.map((v, i) => ({ i, v }));

  return (
    <Card className="flex min-w-0 flex-col gap-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 data-slot="kpi-label" className="truncate text-xs font-medium text-muted">{label}</h3>
        {delta !== null && Number.isFinite(delta) && (
          <Chip
            tone={good ? 'green' : 'red'}
            aria-label={`${delta >= 0 ? 'Up' : 'Down'} ${Math.abs(delta).toFixed(0)}% versus the previous period`}
          >
            {delta >= 0 ? <ArrowUpRight aria-hidden /> : <ArrowDownRight aria-hidden />}
            {Math.abs(delta).toFixed(0)}%
          </Chip>
        )}
      </div>
      <div data-slot="kpi-value" className="text-2xl font-semibold">
        <AnimatedNumber value={kpi.value} format={format} />
      </div>
      <div aria-hidden className="-mx-1 h-9">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={1.5}
              fill={color}
              fillOpacity={0.1}
              isAnimationActive={!reduced}
              animationDuration={250}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
