'use client';

import { LEADS_VIEW_MODES, type LeadsViewMode } from '@vistar/shared';
import { Columns3, Table2, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const META: Record<LeadsViewMode, { label: string; icon: LucideIcon }> = {
  board: { label: 'Board', icon: Columns3 },
  table: { label: 'Table', icon: Table2 },
};

/**
 * Board | Table segmented control with radio group semantics: one tab stop (the checked option),
 * Left/Right/Home/End move and select. Rendered in the same header slot at every width.
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
  const reduced = useReducedMotion();
  const refs = useRef<Partial<Record<LeadsViewMode, HTMLButtonElement | null>>>({});

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
      role="radiogroup"
      aria-label="Leads view"
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex h-8 shrink-0 items-center rounded-md border border-border bg-surface-2 p-0.5',
        className,
      )}
    >
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
              'focus-ring relative inline-flex h-full items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-colors duration-150 ease-standard',
              active ? 'text-fg' : 'text-muted-strong hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId={reduced ? undefined : 'leads-view-pill'}
                transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                aria-hidden
                className="absolute inset-0 rounded-sm border border-border bg-surface shadow-card"
              />
            )}
            <Icon aria-hidden className="relative size-4" />
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
