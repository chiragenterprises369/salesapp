'use client';

import type { NotificationType } from '@vistar/shared';
import { formatDistanceStrict } from 'date-fns';
import { AlertTriangle, AtSign, Bell, CalendarClock, CheckCheck, Clock, FileUp, Info, ListTodo, MessageCircle, UserPlus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/common/empty-state';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/common/popover';
import { useNow } from '@/components/common/use-now';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useMarkNotificationsRead, useNotifications } from '@/lib/world/hooks';

const ICON: Record<NotificationType, LucideIcon> = {
  lead_assigned: UserPlus,
  message_received: MessageCircle,
  task_due: ListTodo,
  task_overdue: Clock,
  workflow_failed: AlertTriangle,
  mention: AtSign,
  import_completed: FileUp,
  system: Info,
  meeting_reminder: CalendarClock,
};

/**
 * Top-bar bell with the real unread count and the latest notifications of the signed-in user
 * (mock world, 25-40 per user; read marks persist in the mock DB). Wave 3 reads GET /notifications
 * and live `notification.created` events through the same hook.
 */
export function NotificationsMenu({ base }: { base: '/app' | '/me' }) {
  const query = useNotifications();
  const markRead = useMarkNotificationsRead();
  const items = query.data ?? [];
  const now = useNow(60_000);
  const unread = items.filter((n) => !n.readAt).length;

  const markAllRead = () => markRead.mutate(undefined);
  const markOne = (id: string) => markRead.mutate([id]);

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
        {query.isPending ? (
          <div className="flex flex-col gap-2 p-3" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <EmptyState size="sm" className="m-3" title="Notifications did not load" description="Check your connection, then open the menu again." />
        ) : items.length === 0 ? (
          <EmptyState size="sm" className="m-3" title="You are all caught up" description="New leads, replies and overdue tasks show up here." />
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {items.map((n) => {
              const Icon = ICON[n.type] ?? Bell;
              return (
                <li key={n.id}>
                  <PopoverClose asChild>
                    <Link
                      href={n.href ? `${base}${n.href}` : base}
                      onClick={() => markOne(n.id)}
                      className="focus-ring flex gap-3 px-3 py-2.5 outline-offset-[-2px] hover:bg-surface-2"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                          n.type === 'workflow_failed' || n.type === 'task_overdue' ? 'bg-status-red-bg text-status-red-fg' : 'bg-surface-3 text-fg-secondary',
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
