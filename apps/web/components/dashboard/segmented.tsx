'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { animateNavPill } from '@/lib/rivet-motion';

/** Rivet-styled fluid segmented control with sliding pill indicator (dual easing). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const firstRender = useRef(true);

  useEffect(() => {
    if (!containerRef.current || !pillRef.current) return;
    const activeIdx = options.findIndex((o) => o.value === value);
    const target = refs.current[activeIdx] ?? null;
    animateNavPill(pillRef.current, containerRef.current, target, firstRender.current, 8);
    firstRender.current = false;
  }, [value, options]);

  const onKeyDown = (e: KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value);
    const n = options.length;
    const map: Record<string, number> = {
      ArrowRight: (i + 1) % n,
      ArrowDown: (i + 1) % n,
      ArrowLeft: (i - 1 + n) % n,
      ArrowUp: (i - 1 + n) % n,
      Home: 0,
      End: n - 1,
    };
    const next = map[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      data-slot="segmented"
      className={cn(
        'relative inline-flex h-9 shrink-0 items-center rounded-[var(--r-ctl,10px)] border border-hair bg-card p-[3px] gap-1',
        className,
      )}
    >
      {/* Fluid sliding pill indicator */}
      <span
        ref={pillRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[8px] bg-well-2 shadow-[inset_0_0_0_1px_var(--hair-2)] opacity-0"
      />

      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              'focus-ring relative z-[1] inline-flex h-full items-center justify-center rounded-[8px] px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-200',
              active ? 'text-ink' : 'text-faint hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
