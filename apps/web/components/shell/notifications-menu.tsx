'use client';

import type { Notification, NotificationType } from '@vistar/shared';
import { mockLeads } from '@vistar/shared/fixtures';
import { formatDistanceStrict } from 'date-fns';
import { AlertTriangle, Bell, CheckCheck, Clock, MessageCircle, UserPlus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/common/popover';
import { useNow } from '@/components/common/use-now';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useCan } from '@/lib/session/session';

const LOADED_AT = Date.now();
const leads = mockLeads(6, 7);

const ICON: Partial<Record<NotificationType, LucideIcon>> = {
  lead_assigned: UserPlus,
  message_received: MessageCircle,
  task_overdue: Clock,
  workflow_failed: AlertTriangle,
};

/** Wave 1 mock inbox; Wave 3 reads GET /notifications and live `notification.created` events. */
function mockNotifications(base: '/app' | '/me', includeWorkflow: boolean): Notification[] {
  const at = (min: number) => new Date(LOADED_AT - min * 60_000).toISOString();
  const [a, b, c] = leads;
  const list: Notification[] = [
    {
      id: 'n1',
      type: 'lead_assigned',
      title: `New lead assigned: ${a!.name}`,
      body: `${a!.companyName ?? 'IndiaMART enquiry'}, ${a!.city ?? 'India'}`,
      href: `${base}/leads?lead=${a!.id}`,
      data: {},
      readAt: null,
      createdAt: at(4),
    },
    {
      id: 'n2',
      type: 'task_overdue',
      title: `Overdue: call back ${b!.name}`,
      body: 'Due 20 minutes ago',
      href: `${base}/tasks`,
      data: {},
      readAt: null,
      createdAt: at(21),
    },
    {
      id: 'n3',
      type: 'message_received',
      title: `WhatsApp reply from ${c!.name}`,
      body: '“Please share best price with GST.”',
      href: `${base}/inbox`,
      data: {},
      readAt: at(50),
      createdAt: at(95),
    },
  ];
  if (includeWorkflow) {
    list.splice(2, 0, {
      id: 'n4',
      type: 'workflow_failed',
      title: 'Workflow step failed: Quote reminder',
      body: 'WhatsApp template quote_reminder is paused by Meta.',
      href: '/app/workflows/quote_reminder',
      data: {},
      readAt: null,
      createdAt: at(62),
    });
  }
  return list;
}

/** Top-bar bell with unread count and a short list (mock). */
export function NotificationsMenu({ base }: { base: '/app' | '/me' }) {
  const canSeeWorkflows = useCan('workflows.read');
  const [items, setItems] = useState(() => mockNotifications(base, canSeeWorkflows));
  const now = useNow(60_000);
  const unread = items.filter((n) => !n.readAt).length;

  const markAllRead = () => setItems((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
  const markRead = (id: string) => setItems((list) => list.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className="relative">
          <Bell aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-2xs font-semibold text-accent-fg tabular ring-2 ring-surface"
            >
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" aria-label="Notifications">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button size="sm" variant="ghost" onClick={markAllRead} disabled={unread === 0}>
            <CheckCheck aria-hidden />
            Mark all as read
          </Button>
        </div>
        {items.length === 0 ? (
          <EmptyState size="sm" className="m-3" title="You are all caught up" description="New leads, replies and overdue tasks show up here." />
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {items.map((n) => {
              const Icon = ICON[n.type] ?? Bell;
              return (
                <li key={n.id}>
                  <PopoverClose asChild>
                    <Link
                      href={n.href ?? base}
                      onClick={() => markRead(n.id)}
                      className="focus-ring flex gap-3 px-3 py-2.5 outline-offset-[-2px] hover:bg-surface-2"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                          n.type === 'workflow_failed' ? 'bg-status-red-bg text-status-red-fg' : 'bg-surface-3 text-fg-secondary',
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-sm', n.readAt ? 'text-fg-secondary' : 'font-medium text-fg')}>{n.title}</span>
                        {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                        <span className="mt-0.5 block text-2xs text-muted">
                          {now > 0 ? `${formatDistanceStrict(new Date(n.createdAt), now)} ago` : ''}
                          {!n.readAt && <span className="sr-only">, unread</span>}
                        </span>
                      </span>
                      {!n.readAt && <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-accent" />}
                    </Link>
                  </PopoverClose>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
