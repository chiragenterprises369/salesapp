'use client';

import { useLayoutEffect, useRef } from 'react';
import { physicsClock } from '@/features/shared/physics';

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Number that ticks to its new value (count chips, INR totals). The ticking text is hidden from
 * assistive tech; the final value sits in a visually hidden span, so screen readers hear it once.
 * `animate: false` (reduced motion, flat mode, first render) shows the value at once.
 */
export function AnimatedNumber({
  value,
  format,
  durationMs,
  animate,
  className,
}: {
  value: number;
  format: (n: number) => string;
  durationMs: number;
  animate: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    if (!animate || from === value || durationMs <= 0) {
      shown.current = value;
      el.textContent = format(value);
      return;
    }
    const duration = physicsClock.ms(durationMs);
    const start = performance.now();
    el.textContent = format(Math.round(from));
    let raf = requestAnimationFrame(function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (value - from) * easeOut(t);
      shown.current = v;
      el.textContent = format(Math.round(v));
      if (t < 1) raf = requestAnimationFrame(frame);
      else shown.current = value;
    });
    return () => {
      cancelAnimationFrame(raf);
      // Interrupted: continue from where the tick stopped, not from the old target.
      shown.current = Math.round(shown.current);
    };
  }, [value, format, durationMs, animate]);

  return (
    <span className={className}>
      {/* Written by the effect only (React never owns this text node, so ticks cannot desync). */}
      <span ref={ref} aria-hidden />
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
