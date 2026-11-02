'use client';

import { AlertTriangle, RotateCw, Search, X } from 'lucide-react';
import { useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

/**
 * Small building blocks shared by the Tasks, Calls, Inbox, Team, Targets and Reports pages:
 * filter pills, tabs, search, stat tiles, section cards and list states. Built on the kit; tokens only.
 * Cards use `spatial:glass-panel` so Depth and Neon Space get glass panels and Classic stays plain.
 */

export const PANEL = 'spatial:glass-panel';
/** 44px targets on touch screens (Employee panel, phones, tablets). */
export const TOUCH = 'pointer-coarse:min-h-11 pointer-coarse:min-w-11';

function useRovingKeys(n: number, current: number, select: (i: number) => void, refs: RefObject<Array<HTMLButtonElement | null>>) {
  return (e: KeyboardEvent) => {
    const map: Record<string, number> = {
      ArrowRight: (current + 1) % n,
      ArrowDown: (current + 1) % n,
      ArrowLeft: (current - 1 + n) % n,
      ArrowUp: (current - 1 + n) % n,
      Home: 0,
      End: n - 1,
    };
    const next = map[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(next);
    refs.current[next]?.focus();
  };
}

export interface PillOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  /** Count shown in a danger tone (overdue, failed). */
  alert?: boolean;
}

/** Single-choice filter pills with counts (radio group: arrows, Home, End). */
export function FilterPills<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<PillOption<T>>;
  onChange: (v: T) => void;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const onKeyDown = useRovingKeys(options.length, i, (n) => onChange(options[n]!.value), refs);
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {options.map((o, idx) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              'focus-ring inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 ease-standard',
              'pointer-coarse:h-11 pointer-coarse:px-3.5 pointer-coarse:text-sm',
              active ? 'border-status-indigo-border bg-accent-soft text-accent-soft-fg' : 'border-border bg-surface text-fg-secondary hover:bg-surface-2 hover:text-fg',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn('tabular rounded-full px-1.5 text-2xs', o.alert && o.count > 0 ? 'bg-status-red-bg text-status-red-fg' : active ? 'bg-surface text-fg' : 'bg-surface-2 text-muted-strong')}>
                {o.count.toLocaleString('en-IN')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Tabs (role=tablist) that switch one panel. `panelId` is the id of the controlled element. */
export function Tabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
  panelId,
  className,
}: {
  label: string;
  value: T;
  tabs: ReadonlyArray<{ value: T; label: string; count?: number }>;
  onChange: (v: T) => void;
  panelId: string;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const i = Math.max(0, tabs.findIndex((o) => o.value === value));
  const onKeyDown = useRovingKeys(tabs.length, i, (n) => onChange(tabs[n]!.value), refs);
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn('flex items-end gap-1 border-b border-border', className)}>
      {tabs.map((t, idx) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            type="button"
            role="tab"
            id={`${panelId}-tab-${t.value}`}
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cn(
              'focus-ring -mb-px inline-flex h-9 items-center gap-1.5 rounded-t-md border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150',
              'pointer-coarse:h-11',
              active ? 'border-accent text-fg' : 'border-transparent text-muted-strong hover:text-fg',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="tabular rounded-full bg-surface-2 px-1.5 text-2xs text-muted-strong">{t.count.toLocaleString('en-IN')}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Search box with a visible clear button. */
export function SearchField({ value, onChange, label, placeholder, className }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string }) {
  const id = useId();
  return (
    <div className={cn('relative min-w-0', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? label}
        className={cn(
          'h-8 w-full min-w-0 rounded-md border border-input bg-surface pr-8 pl-8 text-sm text-fg shadow-card placeholder:text-muted',
          'transition-[border-color,box-shadow] duration-150 ease-standard hover:border-fg-secondary focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
          'pointer-coarse:h-11 pointer-coarse:text-base [&::-webkit-search-cancel-button]:hidden',
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="focus-ring absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-fg pointer-coarse:size-9"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Labelled native select row control (filters). */
export function FilterSelect({ label, value, onChange, children, className }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <span className={cn('inline-flex min-w-0 items-center', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className="relative inline-flex w-full min-w-0">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'h-8 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-surface pr-7 pl-2.5 text-sm text-fg shadow-card',
            'transition-[border-color,box-shadow] duration-150 ease-standard hover:border-fg-secondary focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
            'pointer-coarse:h-11 pointer-coarse:text-base',
          )}
        >
          {children}
        </select>
        <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 fill-none stroke-current text-muted" strokeWidth={1.5}>
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  );
}

/** KPI tile for totals strips. */
export function StatTile({ label, value, hint, tone, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad'; className?: string }) {
  return (
    <Card className={cn('flex min-w-0 flex-col gap-0.5 px-4 py-3', PANEL, className)}>
      <span className="truncate text-xs font-medium text-muted">{label}</span>
      <span className="tabular truncate text-xl font-semibold text-fg">{value}</span>
      {hint && <span className={cn('text-xs text-pretty', tone === 'good' ? 'text-success-text' : tone === 'bad' ? 'text-danger-text' : 'text-muted')}>{hint}</span>}
    </Card>
  );
}

export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[74px] rounded-lg" />
      ))}
    </div>
  );
}

/** Titled card section (h2 + description + actions). */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const id = useId();
  return (
    <Card className={cn('flex min-w-0 flex-col', PANEL, className)}>
      <section aria-labelledby={id} className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <h2 id={id} className="text-sm font-semibold text-fg">
              {title}
            </h2>
            {description && <p className="text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
        <div className={cn('min-h-0 flex-1 px-4 pb-4', bodyClassName)}>{children}</div>
      </section>
    </Card>
  );
}

export function ErrorBlock({ title, onRetry, className }: { title: string; onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-2 rounded-lg border border-border bg-surface px-6 py-10 text-center', className)}>
      <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-full bg-status-red-bg text-status-red-fg [&_svg]:size-5">
        <AlertTriangle />
      </span>
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="max-w-sm text-sm text-muted">Check your connection, then try again.</p>
      <Button className={cn('mt-1', TOUCH)} onClick={onRetry}>
        <RotateCw aria-hidden />
        Try again
      </Button>
    </div>
  );
}

export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

/** "Showing 50 of 812" + Show more. */
export function ShowMore({ shown, total, onMore, noun }: { shown: number; total: number; onMore: () => void; noun: string }) {
  if (total <= shown) return total > 0 ? <p className="px-1 py-3 text-center text-xs text-muted-strong">All {total.toLocaleString('en-IN')} {noun} shown</p> : null;
  return (
    <div className="flex flex-col items-center gap-1.5 py-3">
      <p className="text-xs text-muted-strong" aria-live="polite">
        Showing {shown.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')} {noun}
      </p>
      <Button size="sm" onClick={onMore} className={TOUCH}>
        Show {Math.min(50, total - shown)} more
      </Button>
    </div>
  );
}

/** Polite live region for counts and action results (toasts announce themselves too). */
export function LiveText({ children }: { children: ReactNode }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {children}
    </p>
  );
}
