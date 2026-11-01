'use client';

import type { FeedItem } from '@vistar/shared';
import {
  ArrowRightLeft,
  CheckCircle2,
  MessageCircle,
  PhoneCall,
  Sparkles,
  UserRoundPlus,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { timeAgo } from '@/components/leads/lead-meta';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const ICON: Record<FeedItem['kind'], LucideIcon> = {
  lead_created: Sparkles,
  lead_assigned: UserRoundPlus,
  call_ended: PhoneCall,
  stage_moved: ArrowRightLeft,
  message_received: MessageCircle,
  task_completed: CheckCircle2,
  workflow_failed: Workflow,
};

/** Live activity feed. New items slide in at the top with a short highlight. */
export function LiveFeed({ items, fresh }: { items: FeedItem[]; fresh: ReadonlySet<string> }) {
  const reduced = useReducedMotion();
  if (items.length === 0)
    return (
      <p className="py-8 text-center text-sm text-muted">
        Activity from your team appears here as it happens.
      </p>
    );
  return (
    <ol className="flex flex-col">
      <AnimatePresence initial={false}>
        {items.map((f) => {
          const Icon = ICON[f.kind];
          const isNew = fresh.has(f.id);
          return (
            <motion.li
              key={f.id}
              layout={reduced ? false : 'position'}
              initial={reduced ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
              className={cn(
                '-mx-2 flex gap-3 rounded-md px-2 py-2',
                isNew && !reduced && 'animate-[row-highlight_1.6s_var(--easing)]',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-muted-strong',
                  f.kind === 'workflow_failed' && 'bg-status-red-bg text-status-red-fg',
                )}
              >
                <Icon aria-hidden className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">{f.text}</p>
                <time dateTime={f.createdAt} className="text-2xs text-muted">
                  {timeAgo(f.createdAt)}
                </time>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
