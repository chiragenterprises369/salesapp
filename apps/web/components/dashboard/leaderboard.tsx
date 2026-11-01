'use client';

import { formatInr, formatNumber, type LeaderboardEntry } from '@vistar/shared';
import { Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const PODIUM_ORDER = [1, 0, 2] as const; // 2nd, 1st, 3rd
const STEP_HEIGHT = ['h-20', 'h-14', 'h-10'] as const; // by rank index 0..2

/** Leaderboard: podium for the top 3, then a ranked list. Revenue = won deal value in the period. */
export function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  const reduced = useReducedMotion();
  if (entries.length === 0)
    return (
      <p className="py-8 text-center text-sm text-muted">No sales activity for this team yet.</p>
    );
  const top = entries.slice(0, 3);
  const rest = entries.slice(3, 10);

  return (
    <div className="flex flex-col gap-4">
      <ol aria-label="Top 3" className="grid grid-cols-3 items-end gap-2">
        {PODIUM_ORDER.filter((i) => top[i]).map((i) => {
          const e = top[i]!;
          return (
            <li key={e.user.id} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
              <span className="relative">
                <Avatar name={e.user.name} size={i === 0 ? 'xl' : 'lg'} aria-hidden />
                {i === 0 && (
                  <span
                    aria-hidden
                    className="absolute -top-2 -right-2 inline-flex size-6 items-center justify-center rounded-full border border-border bg-surface shadow-card"
                  >
                    <Trophy className="size-3.5 text-warning-text" />
                  </span>
                )}
              </span>
              <span className="w-full truncate text-xs font-medium">{e.user.name}</span>
              <span className="tabular text-xs text-muted">
                {formatInr(e.revenueInr, { compact: true })}
              </span>
              <motion.span
                initial={reduced ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{
                  duration: 0.25,
                  ease: [0.2, 0, 0, 1],
                  delay: reduced ? 0 : 0.06 * (2 - i),
                }}
                style={{ transformOrigin: 'bottom' }}
                className={cn(
                  'tabular flex w-full items-start justify-center rounded-t-md border border-b-0 pt-1.5 text-sm font-semibold',
                  STEP_HEIGHT[i],
                  i === 0
                    ? 'border-status-indigo-border bg-accent-soft text-accent-soft-fg'
                    : 'border-border bg-surface-2 text-fg-secondary',
                )}
              >
                <span className="sr-only">Rank </span>
                {e.rank}
              </motion.span>
            </li>
          );
        })}
      </ol>
      {rest.length > 0 && (
        <ol
          aria-label="Other ranks"
          start={4}
          className="flex flex-col divide-y divide-border border-t border-border"
        >
          {rest.map((e) => (
            <li
              key={e.user.id}
              className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 py-2 text-sm"
            >
              <span className="tabular text-xs text-muted">{e.rank}</span>
              <span className="flex min-w-0 items-center gap-2">
                <Avatar name={e.user.name} size="xs" aria-hidden />
                <span className="truncate">{e.user.name}</span>
              </span>
              <span className="tabular flex items-center gap-3 text-xs text-fg-secondary">
                <span title="Won value">{formatInr(e.revenueInr, { compact: true })}</span>
                <span className="hidden text-muted sm:inline">{formatNumber(e.dealsWon)} won</span>
                <span className="text-muted">{formatNumber(e.calls)} calls</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
