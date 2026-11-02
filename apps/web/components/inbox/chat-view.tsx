'use client';

import type { ChipTone, Conversation, UserSummary } from '@vistar/shared';
import { ArrowLeft, Clock, ExternalLink, Lock, UserRoundCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/common/menu';
import { formatPhone } from '@/components/leads/lead-meta';
import { ErrorBlock, ListSkeleton, TOUCH } from '@/components/reports/page-kit';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { Composer } from './composer';
import { useInboxStore, useSendMessage, useThread, type Outgoing } from './data';
import { dayGroups, dayLabel, formatLeft, windowState } from './logic';
import { MessageBubble } from './message-bubble';

const STATUS: Record<Conversation['status'], { label: string; tone: ChipTone }> = {
  open: { label: 'Needs reply', tone: 'amber' },
  pending: { label: 'Waiting on customer', tone: 'blue' },
  closed: { label: 'Closed', tone: 'grey' },
};

/** Chat view: header (contact, lead link, assign / transfer), 24 h window, messages and the composer. */
export function ChatView({
  conversationId,
  now,
  timeZone,
  leadsBase,
  me,
  canSend,
  readOnlyReason,
  canAssign,
  assignees,
  canUnassign,
  onBack,
  touch,
}: {
  conversationId: string;
  now: number;
  timeZone: string;
  leadsBase: string;
  me: UserSummary | null;
  canSend: boolean;
  /** Shown instead of the composer when sending is not allowed. */
  readOnlyReason?: string;
  canAssign: boolean;
  assignees: readonly UserSummary[];
  canUnassign: boolean;
  onBack?: () => void;
  touch?: boolean;
}) {
  const thread = useThread(conversationId);
  const send = useSendMessage(thread.data?.conversation ?? null, me);
  const markRead = useInboxStore((s) => s.markRead);
  const assign = useInboxStore((s) => s.assign);
  const scroller = useRef<HTMLDivElement>(null);
  const count = thread.data?.messages.length ?? 0;

  useEffect(() => {
    if (thread.data) markRead(conversationId);
  }, [thread.data, conversationId, markRead]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, conversationId]);

  if (thread.isPending) return <ListSkeleton rows={6} className="p-4" />;
  if (thread.isError || !thread.data) return <ErrorBlock className="m-4" title="This chat did not load" onRetry={() => void thread.refetch()} />;

  const { conversation: c, messages } = thread.data;
  const w = windowState(c, now);
  const doSend = (o: Outgoing) =>
    send.mutate(o, {
      onError: () => toast.error('Message not sent', { description: 'Check your connection, then send it again.' }),
    });
  const transfer = (u: UserSummary | null) => {
    const previous = c.assignee;
    assign(c.id, u);
    toast.success(u ? `Chat assigned to ${u.name}` : 'Chat unassigned', { action: { label: 'Undo', onClick: () => assign(c.id, previous) } });
  };

  return (
    <section aria-label={`Chat with ${c.contactName}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        {onBack && (
          <Button variant="ghost" size={touch ? 'icon-touch' : 'icon'} className={TOUCH} aria-label="Back to conversations" onClick={onBack}>
            <ArrowLeft aria-hidden />
          </Button>
        )}
        <Avatar name={c.contactName} size="md" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-fg">{c.contactName}</h2>
          <p className="tabular truncate text-xs text-muted">{formatPhone(c.contactPhone)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Chip>
          {c.optIn === 'opted_out' ? <Chip tone="red">Opted out</Chip> : c.optIn === 'opted_in' ? <Chip tone="green">Opted in</Chip> : <Chip tone="amber">No opt-in</Chip>}
          {c.leadId && (
            <Button asChild variant="ghost" size="sm" className={TOUCH}>
              <Link href={`${leadsBase}?lead=${c.leadId}`}>
                <ExternalLink aria-hidden />
                Open lead
              </Link>
            </Button>
          )}
          {canAssign ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className={TOUCH}>
                  <UserRoundCheck aria-hidden />
                  {c.assignee ? c.assignee.name : 'Unassigned'}
                  <span className="sr-only">: assign or transfer</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-80 overflow-y-auto">
                <DropdownMenuLabel>Assign or transfer to</DropdownMenuLabel>
                {assignees.map((u) => (
                  <DropdownMenuItem key={u.id} disabled={u.id === c.assignee?.id} onSelect={() => transfer(u)}>
                    <Avatar name={u.name} size="xs" />
                    {u.name}
                    {u.id === me?.id ? ' (you)' : ''}
                  </DropdownMenuItem>
                ))}
                {canUnassign && c.assignee && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => transfer(null)}>Unassign</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            c.assignee && <span className="text-xs text-muted">Assigned to {c.assignee.id === me?.id ? 'you' : c.assignee.name}</span>
          )}
        </div>
      </header>
      <div className={cn('flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs', w.open ? 'bg-status-green-bg text-status-green-fg' : 'bg-status-amber-bg text-status-amber-fg')} role="status">
        <Clock aria-hidden className="size-3.5" />
        {w.open ? `24 h window open · closes in ${formatLeft(w.msLeft)}` : w.neverInbound ? 'No customer message yet · templates only' : '24 h window closed · templates only'}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-bg py-3 spatial:bg-transparent">
        {messages.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-strong">No messages yet. Send a template to start the chat.</p>
        ) : (
          <div role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions">
            {dayGroups(messages).map((g) => (
              <div key={g.day} className="mb-2">
                <p className="sticky top-0 z-10 my-2 flex justify-center">
                  <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-2xs font-medium text-fg-secondary shadow-card">{dayLabel(g.day, now, timeZone)}</span>
                </p>
                <ul className="flex flex-col gap-1.5">
                  {g.messages.map((m) => (
                    <MessageBubble key={m.id} m={m} timeZone={timeZone} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
      {canSend ? (
        <Composer conversation={c} window={w} onSend={doSend} sending={send.isPending} touch={touch} />
      ) : (
        <p className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-3 text-xs text-muted-strong">
          <Lock aria-hidden className="size-3.5" />
          {readOnlyReason ?? 'You can read this chat. Replies need the Send messages permission.'}
        </p>
      )}
    </section>
  );
}
