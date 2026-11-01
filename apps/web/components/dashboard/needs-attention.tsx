'use client';

import type { AttentionItem, AttentionKind } from '@vistar/shared';
import {
  AlarmClock,
  ChevronRight,
  Flame,
  PhoneMissed,
  ShieldAlert,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/components/leads/lead-meta';

const GROUPS: Array<{
  kind: AttentionKind;
  label: string;
  icon: LucideIcon;
  href: string;
  cta: string;
}> = [
  {
    kind: 'hot_lead_unassigned',
    label: 'Hot leads unassigned',
    icon: Flame,
    href: '/app/leads?ownerId=unassigned&temperature=hot&view=table',
    cta: 'Assign',
  },
  {
    kind: 'task_overdue',
    label: 'Overdue follow-ups',
    icon: AlarmClock,
    href: '/app/leads?view=table',
    cta: 'Open leads',
  },
  {
    kind: 'workflow_failed',
    label: 'Failed workflow runs',
    icon: Workflow,
    href: '/app/workflows',
    cta: 'Open workflows',
  },
  {
    kind: 'missed_call',
    label: 'Missed calls',
    icon: PhoneMissed,
    href: '/app/calls',
    cta: 'Open calls',
  },
  {
    kind: 'sla_breach',
    label: 'Response time breaches',
    icon: ShieldAlert,
    href: '/app/leads',
    cta: 'Open leads',
  },
];

/** "Needs attention": grouped items that a manager should act on now. */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const groups = GROUPS.map((g) => ({
    ...g,
    items: items.filter((i) => i.kind === g.kind),
  })).filter((g) => g.items.length > 0);
  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        Nothing needs you right now. Hot leads, overdue follow-ups and failed workflows show up
        here.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        const Icon = g.icon;
        return (
          <section key={g.kind} aria-label={g.label} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg-secondary">
                <Icon
                  aria-hidden
                  className={cn(
                    'size-3.5',
                    g.kind === 'task_overdue' ? 'text-warning-text' : 'text-danger-text',
                  )}
                />
                {g.label}
                <Chip tone={g.kind === 'task_overdue' ? 'amber' : 'red'}>{g.items.length}</Chip>
              </h3>
              <Link
                href={g.href}
                className="focus-ring inline-flex items-center rounded-xs text-xs font-medium text-accent-text hover:underline"
              >
                {g.cta}
                <ChevronRight aria-hidden className="size-3.5" />
              </Link>
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {g.items.slice(0, 3).map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    {i.href ? (
                      <Link
                        href={i.href}
                        className="focus-ring block truncate rounded-xs text-sm text-fg hover:underline"
                      >
                        {i.title}
                      </Link>
                    ) : (
                      <p className="truncate text-sm text-fg">{i.title}</p>
                    )}
                    {i.subtitle && <p className="truncate text-xs text-muted">{i.subtitle}</p>}
                  </div>
                  <time dateTime={i.createdAt} className="shrink-0 text-2xs text-muted">
                    {timeAgo(i.createdAt)}
                  </time>
                </li>
              ))}
              {g.items.length > 3 && (
                <li className="px-3 py-1.5 text-xs text-muted">+{g.items.length - 3} more</li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
