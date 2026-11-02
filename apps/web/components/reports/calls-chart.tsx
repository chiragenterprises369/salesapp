'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useBrandPalette } from '@/lib/branding/use-brand-palette';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/** Calls per day (answered / missed), lazy-loaded so Recharts stays out of the Reports first load. Decorative: the page renders a table equivalent. */
export default function CallsByDayChart({ data }: { data: Array<{ label: string; answered: number; missed: number }> }) {
  const p = useBrandPalette();
  const reduced = useReducedMotion();
  return (
    <div aria-hidden className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke={p['chart-grid']} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: p['chart-axis'], fontSize: 11 }} interval="preserveStartEnd" minTickGap={10} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: p['chart-axis'], fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: p.surface, border: `1px solid ${p.border}`, borderRadius: 8, boxShadow: p['elevation-3'], fontSize: 12, color: p.fg }}
            labelStyle={{ color: p.fg, fontWeight: 500 }}
            itemStyle={{ color: p['fg-secondary'] }}
            cursor={{ fill: p['surface-3'] }}
          />
          <Bar dataKey="answered" name="Answered" stackId="c" fill={p['chart-1']} isAnimationActive={!reduced} animationDuration={250} />
          <Bar dataKey="missed" name="Missed" stackId="c" fill={p['chart-5']} radius={[3, 3, 0, 0]} isAnimationActive={!reduced} animationDuration={250} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
