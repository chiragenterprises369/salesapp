'use client';

import { LEADS_VIEW_MODES, type LeadsViewMode } from '@vistar/shared';
import { Columns3, Table2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { animateNavPill } from '@/lib/rivet-motion';

const META: Record<LeadsViewMode, { label: string; icon: LucideIcon }> = {
  board: { label: 'Board', icon: Columns3 },
  table: { label: 'Table', icon: Table2 },
};

/**
 * Rivet fluid segmented control for Leads view switch (Board | Table)
 */
export function ViewSwitch({
  value,
  onChange,
  className,
}: {
  value: LeadsViewMode;
  onChange: (m: LeadsViewMode) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const refs = useRef<Partial<Record<LeadsViewMode, HTMLButtonElement | null>>>({});
  const firstRender = useRef(true);

  useEffect(() => {
    if (!containerRef.current || !pillRef.current) return;
    const target = refs.current[value] ?? null;
    animateNavPill(pillRef.current, containerRef.current, target, firstRender.current, 8);
    firstRender.current = false;
  }, [value]);

  const onKeyDown = (e: KeyboardEvent) => {
    const i = LEADS_VIEW_MODES.indexOf(value);
    const n = LEADS_VIEW_MODES.length;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? LEADS_VIEW_MODES[(i + 1) % n]
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? LEADS_VIEW_MODES[(i - 1 + n) % n]
          : e.key === 'Home'
            ? LEADS_VIEW_MODES[0]
            : e.key === 'End'
              ? LEADS_VIEW_MODES[n - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    if (next !== value) onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label="Leads view"
      onKeyDown={onKeyDown}
      className={cn(
        'relative inline-flex h-9 shrink-0 items-center rounded-[var(--r-ctl,10px)] border border-hair bg-card p-[3px] gap-1',
        className,
      )}
    >
      <span
        ref={pillRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[8px] bg-well-2 shadow-[inset_0_0_0_1px_var(--hair-2)] opacity-0"
      />
      {LEADS_VIEW_MODES.map((m) => {
        const { label, icon: Icon } = META[m];
        const active = m === value;
        return (
          <button
            key={m}
            ref={(el) => {
              refs.current[m] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => !active && onChange(m)}
            className={cn(
              'focus-ring relative z-[1] inline-flex h-full items-center gap-1.5 rounded-[8px] px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-200',
              active ? 'text-ink' : 'text-faint hover:text-ink',
            )}
          >
            <Icon aria-hidden className={cn('size-4 transition-colors', active ? 'text-accent-text' : 'text-faint')} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
