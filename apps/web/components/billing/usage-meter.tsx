'use client';

import { TriangleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { meterPct, meterState, type MeterState } from '@/lib/billing/logic';
import { cn } from '@/lib/cn';

const nf = new Intl.NumberFormat('en-IN');

const BAR: Record<MeterState, string> = { ok: 'bg-accent', warn: 'bg-status-amber-fg', full: 'bg-status-red-fg' };

/**
 * One usage meter: "1,240 of 2,000 leads". The bar is decorative; the numbers and the state are text
 * (role="meter" with aria-valuetext), so the warning does not rely on colour alone.
 */
export function UsageMeter({
  label,
  used,
  limit,
  unit,
  format = (n) => nf.format(n),
  state: given,
  hint,
  action,
}: {
  label: string;
  used: number;
  /** null = unlimited on this plan. */
  limit: number | null;
  /** Plural unit after the numbers ("seats", "messages"). */
  unit?: string;
  format?: (n: number) => string;
  /** State from the API; computed from used and limit when not given. */
  state?: MeterState;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  const id = useId();
  const state = given ?? meterState(used, limit);
  const pct = meterPct(used, limit);
  const text = limit === null ? `${format(used)}${unit ? ` ${unit}` : ''}, unlimited` : `${format(used)} of ${format(limit)}${unit ? ` ${unit}` : ''}`;
  const stateText = state === 'full' ? 'Limit reached' : state === 'warn' ? 'Almost at the limit' : null;
  return (
    <div data-slot="usage-meter" data-state={state} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <span id={`${id}-label`} className="text-sm font-medium text-fg">
          {label}
        </span>
        {pct !== null && (
          <span className={cn('text-xs font-medium tabular-nums', state === 'full' ? 'text-danger-text' : state === 'warn' ? 'text-status-amber-fg' : 'text-muted-strong')}>
            {pct}%
          </span>
        )}
      </div>
      <div
        role="meter"
        aria-labelledby={`${id}-label`}
        aria-valuemin={0}
        aria-valuemax={limit ?? Math.max(used, 1)}
        aria-valuenow={Math.min(used, limit ?? used)}
        aria-valuetext={stateText ? `${text}. ${stateText}` : text}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div className={cn('h-full rounded-full transition-[width] duration-300 ease-standard', BAR[state], limit === null && 'opacity-40')} style={{ width: `${limit === null ? 100 : Math.min(100, pct ?? 0)}%` }} />
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary tabular-nums">
        <span>{text}</span>
        {stateText && (
          <span className={cn('inline-flex items-center gap-1 text-xs font-medium', state === 'full' ? 'text-danger-text' : 'text-status-amber-fg')}>
            <TriangleAlert aria-hidden className="size-3.5" />
            {stateText}
          </span>
        )}
      </p>
      {hint && <p className="text-xs text-muted-strong">{hint}</p>}
      {action}
    </div>
  );
}
