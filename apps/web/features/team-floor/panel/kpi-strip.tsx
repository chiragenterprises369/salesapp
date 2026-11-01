'use client';

import { formatNumber } from '@vistar/shared';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import type { FloorKpis } from '../state/selectors';

/** Number that ticks up/down to its new value (instant with reduced motion). */
export function TickNumber({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    if (shown.current === null && ref.current) {
      shown.current = value;
      ref.current.textContent = formatNumber(value);
    }
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current ?? value;
    if (reduced || from === value) {
      shown.current = value;
      el.textContent = formatNumber(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const u = Math.min(1, (t - start) / 450);
      const v = Math.round(from + (value - from) * (1 - (1 - u) ** 3));
      shown.current = v;
      el.textContent = formatNumber(v);
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);

  return <span ref={ref} className={cn('tabular', className)} />;
}

const ITEMS: { key: keyof FloorKpis; label: string; dot?: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'onCall', label: 'On call', dot: 'bg-status-blue-fg' },
  { key: 'idle', label: 'Available', dot: 'bg-status-green-fg' },
  { key: 'busy', label: 'Busy', dot: 'bg-status-amber-fg' },
  { key: 'callsToday', label: 'Calls today' },
  { key: 'leadsWaiting', label: 'Leads waiting', dot: 'bg-accent' },
];

export function KpiStrip({ kpis, className }: { kpis: FloorKpis; className?: string }) {
  return (
    <dl
      aria-label="Team floor summary"
      className={cn('grid grid-cols-3 overflow-hidden rounded-lg border border-border bg-surface shadow-card sm:grid-cols-6', className)}
    >
      {ITEMS.map((item, i) => (
        <div
          key={item.key}
          className={cn(
            'flex min-w-0 flex-col gap-0.5 border-border px-3 py-2.5 sm:px-4',
            i % 3 !== 0 && 'border-l',
            i >= 3 && 'border-t sm:border-t-0',
            i === 3 && 'sm:border-l',
          )}
        >
          <dt className="flex items-center gap-1.5 truncate text-xs text-muted">
            {item.dot && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', item.dot)} />}
            {item.label}
          </dt>
          <dd className="text-2xl font-semibold text-fg">
            <TickNumber value={kpis[item.key]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
