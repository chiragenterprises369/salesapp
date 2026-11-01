'use client';

import type { Lead } from '@vistar/shared';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const R = 22;
const C = 2 * Math.PI * R;

/** Lead score 0-100 as a ring. The stroke uses the temperature tone; the number is the label. */
export function ScoreRing({
  score,
  temperature,
  size = 56,
}: {
  score: number;
  temperature: Lead['temperature'];
  size?: number;
}) {
  const reduced = useReducedMotion();
  const tone =
    temperature === 'hot'
      ? 'stroke-status-red-fg'
      : temperature === 'warm'
        ? 'stroke-status-amber-fg'
        : 'stroke-status-blue-fg';
  const offset = C * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 56 56" width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx="28" cy="28" r={R} fill="none" strokeWidth="5" className="stroke-surface-3" />
        <motion.circle
          cx="28"
          cy="28"
          r={R}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={reduced ? false : { strokeDashoffset: C }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
          className={tone}
        />
      </svg>
      <span className={cn('tabular absolute text-sm font-semibold')}>{score}</span>
    </span>
  );
}

export function ScoreBreakdown({ breakdown }: { breakdown: Lead['scoreBreakdown'] }) {
  if (breakdown.length === 0)
    return <p className="text-xs text-muted">No scoring rules matched yet.</p>;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {breakdown.map((b) => (
        <li key={b.rule} className="flex items-center justify-between gap-3">
          <span className="text-fg-secondary">{b.rule}</span>
          <span
            className={cn(
              'tabular font-medium',
              b.points > 0 ? 'text-success-text' : b.points < 0 ? 'text-danger-text' : 'text-muted',
            )}
          >
            {b.points > 0 ? `+${b.points}` : b.points}
          </span>
        </li>
      ))}
    </ul>
  );
}
