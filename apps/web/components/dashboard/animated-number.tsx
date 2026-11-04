'use client';

import { animate } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Number that ticks up (or down) to its new value. The animated text is hidden from assistive
 * tech; the final value is in a visually hidden span so screen readers never hear the count.
 */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current ?? 0;
    if (reduced || from === value) {
      shown.current = value;
      el.textContent = format(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.85,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = format(Number.isInteger(value) ? Math.round(v) : v);
      },
      onComplete: () => {
        shown.current = value;
        el.textContent = format(value);
      },
    });
    return () => controls.stop();
  }, [value, format, reduced]);

  return (
    <span className={className}>
      <span ref={ref} aria-hidden className="tabular">
        {format(reduced ? value : 0)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
