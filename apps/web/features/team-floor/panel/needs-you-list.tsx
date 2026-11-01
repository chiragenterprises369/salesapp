'use client';

import type { AttentionItem } from '@vistar/shared';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { useNow } from '../state/env';
import { timeAgo } from './time';

const ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info } as const;
const ICON_TONE = { critical: 'text-danger-text', warning: 'text-warning-text', info: 'text-accent-text' } as const;

export interface NeedsYouItemProps {
  item: AttentionItem;
  who: string | null;
  readOnly: boolean;
  onResolve: (item: AttentionItem) => void;
  onShow?: (item: AttentionItem) => void;
  compact?: boolean;
}

export function NeedsYouItem({ item, who, readOnly, onResolve, onShow, compact }: NeedsYouItemProps) {
  const now = useNow();
  const Icon = ICON[item.severity];
  const created = Date.parse(item.createdAt);
  return (
    <li className={cn('flex gap-2.5 py-2.5', !compact && 'px-4')}>
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', ICON_TONE[item.severity])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{item.title}</p>
        <p className="mt-0.5 text-xs text-muted">
          {[who, item.subtitle, Number.isFinite(created) && now ? timeAgo(created, now) : null].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {onShow && item.userId && (
            <Button size="sm" variant="ghost" onClick={() => onShow(item)}>
              Show on floor
            </Button>
          )}
          {item.href && (
            <Button size="sm" variant="ghost" asChild>
              <Link href={item.href}>Open</Link>
            </Button>
          )}
          {!readOnly && (
            <Button size="sm" onClick={() => onResolve(item)}>
              Resolve
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function NeedsYouList({
  items,
  nameOf,
  readOnly,
  onResolve,
  onShow,
  className,
}: {
  items: AttentionItem[];
  nameOf: (userId: string | null) => string | null;
  readOnly: boolean;
  onResolve: (item: AttentionItem) => void;
  onShow: (item: AttentionItem) => void;
  className?: string;
}) {
  return (
    <section aria-labelledby="needs-you-title" className={cn('flex min-h-0 flex-col rounded-lg border border-border bg-surface shadow-card', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 id="needs-you-title" className="text-sm font-semibold text-fg">
          Needs you
        </h3>
        {items.length > 0 && (
          <Chip tone={items.some((i) => i.severity === 'critical') ? 'red' : 'amber'} size="md">
            {items.length}
          </Chip>
        )}
      </header>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <CheckCircle2 aria-hidden className="size-5 text-success-text" />
          <p className="text-sm font-medium text-fg">Nothing needs you right now</p>
          <p className="text-xs text-muted">Overdue tasks and missed calls show up here as they happen.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {items.map((item) => (
            <NeedsYouItem key={item.id} item={item} who={nameOf(item.userId)} readOnly={readOnly} onResolve={onResolve} onShow={onShow} />
          ))}
        </ul>
      )}
    </section>
  );
}
