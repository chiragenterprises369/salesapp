'use client';

import type { Conversation } from '@vistar/shared';
import { Clock, MessageCircle, SearchX } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ShowMore } from '@/components/reports/page-kit';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import { listTime, windowState } from './logic';

/** Conversation list (listbox-like list of buttons): avatar, name, preview, time, unread count, window and assignee. */
export function ConversationList({
  items,
  total,
  selectedId,
  onSelect,
  onMore,
  now,
  timeZone,
  showAssignee,
  filtered,
  touch,
}: {
  items: readonly Conversation[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMore: () => void;
  now: number;
  timeZone: string;
  showAssignee: boolean;
  filtered: boolean;
  touch?: boolean;
}) {
  if (total === 0)
    return (
      <EmptyState
        size="sm"
        className="m-3 border-none"
        icon={filtered ? <SearchX /> : <MessageCircle />}
        title={filtered ? 'No chats match' : 'No conversations yet'}
        description={filtered ? 'Clear the search or pick another filter.' : 'When a lead messages the company on WhatsApp, the chat shows up here.'}
      />
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <ul aria-label="Conversations">
        {items.map((c) => {
          const active = c.id === selectedId;
          const w = windowState(c, now);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'focus-ring flex w-full items-start gap-2.5 border-b border-border px-3 text-left transition-colors duration-150',
                  touch ? 'py-3' : 'py-2.5',
                  active ? 'bg-accent-soft neon:edge-glow' : 'hover:bg-surface-2',
                )}
              >
                <Avatar name={c.contactName} size={touch ? 'lg' : 'md'} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn('min-w-0 flex-1 truncate text-sm', c.unreadCount ? 'font-semibold text-fg' : 'font-medium text-fg')}>{c.contactName}</span>
                    <span className={cn('tabular shrink-0 text-2xs', c.unreadCount ? 'font-semibold text-accent-text' : active ? 'text-muted-strong' : 'text-muted')}>{listTime(c.lastMessageAt, now, timeZone)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className={cn('min-w-0 flex-1 truncate text-xs', c.unreadCount ? 'text-fg-secondary' : active ? 'text-muted-strong' : 'text-muted')}>{c.lastMessagePreview ?? 'No messages yet'}</span>
                    {c.unreadCount > 0 && (
                      <span className="tabular inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-2xs font-semibold text-accent-fg">
                        {c.unreadCount}
                        <span className="sr-only"> unread</span>
                      </span>
                    )}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-strong">
                    {w.open && (
                      <span className="inline-flex items-center gap-1 text-success-text">
                        <Clock aria-hidden className="size-3" />
                        24h window open
                      </span>
                    )}
                    {showAssignee && <span className="truncate">{c.assignee ? c.assignee.name : 'Unassigned'}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <ShowMore shown={items.length} total={total} onMore={onMore} noun="chats" />
    </div>
  );
}
