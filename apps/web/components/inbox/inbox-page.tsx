'use client';

import { MessageCircle } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useMemo, useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { useMediaQuery } from '@/components/common/use-media-query';
import { useNow } from '@/components/common/use-now';
import { useScopedUsers } from '@/components/leads/lead-meta';
import { ErrorBlock, FilterPills, ListSkeleton, PANEL, SearchField } from '@/components/reports/page-kit';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { useCan, useMe } from '@/lib/session/session';
import { ChatView } from './chat-view';
import { ConversationList } from './conversation-list';
import { useInbox, useInboxViewer } from './data';
import { filterConversations, inboxViews, viewCounts, type InboxStatusFilter, type InboxView } from './logic';

const PAGE = 50;
const VIEW_LABEL: Record<InboxView, string> = { mine: 'Mine', unassigned: 'Unassigned', all: 'All' };

/**
 * WhatsApp inbox, shared by /app/inbox (company) and /me/inbox (employee, touch-first). Conversation
 * list with unread counts, search and Mine / Unassigned / All views by permission and scope; chat
 * view with ticks, templates, internal notes, 24 h window, assign / transfer and a local composer.
 * The open chat is in the URL (?c=<id>) so back and deep links work.
 */
export function InboxPage({ panel }: { panel: 'company' | 'employee' }) {
  const me = useMe();
  const viewer = useInboxViewer();
  const now = useNow(30_000);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wide = useMediaQuery('(min-width: 1024px)');
  const touch = panel === 'employee';
  const views = inboxViews(viewer);
  const [view, setView] = useState<InboxView>(views.includes('all') ? 'all' : 'mine');
  const [status, setStatus] = useState<InboxStatusFilter>('any');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const deferredQ = useDeferredValue(q);
  const inbox = useInbox();
  const assignees = useScopedUsers();
  const readOnly = !!me?.impersonation?.readOnly;
  const canSend = useCan('messages.send') && !readOnly;
  const canAssign = useCan('messages.team_inbox') && !readOnly;
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const leadsBase = panel === 'company' ? '/app/leads' : '/me/leads';

  const rows = useMemo(() => (inbox.data ? filterConversations(inbox.data, { view, status, q: deferredQ }, viewer) : []), [inbox.data, view, status, deferredQ, viewer]);
  const unread = useMemo(() => (inbox.data ? viewCounts(inbox.data, viewer) : null), [inbox.data, viewer]);
  const param = params.get('c');
  const selectedId = param ?? (wide ? (rows[0]?.id ?? null) : null);
  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('c', id);
    else next.delete('c');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const reset = () => setLimit(PAGE);
  const showList = wide || !param;
  const showChat = wide || !!param;
  const height = panel === 'company' ? 'h-[calc(100dvh-10.5rem)] min-h-[28rem]' : 'h-[calc(100dvh-13.5rem)] min-h-[24rem] lg:h-[calc(100dvh-10rem)]';

  const list = () => {
    if (inbox.isPending || !now) return <ListSkeleton rows={8} className="p-3" />;
    if (inbox.isError) return <ErrorBlock className="m-3" title="Conversations did not load" onRetry={() => void inbox.refetch()} />;
    return (
      <ConversationList
        items={rows.slice(0, limit)}
        total={rows.length}
        selectedId={selectedId}
        onSelect={(id) => select(id)}
        onMore={() => setLimit((l) => l + PAGE)}
        now={now}
        timeZone={tz}
        showAssignee={view !== 'mine'}
        filtered={!!q || status !== 'any'}
        touch={touch}
      />
    );
  };

  return (
    <RequirePermission anyOf={['messages.read']}>
      <div className="flex flex-col gap-3">
        <PageHeader
          title="Inbox"
          description={panel === 'company' ? 'WhatsApp conversations with your leads, shared by the team.' : 'WhatsApp chats with your leads.'}
          meta={unread && unread[view] > 0 ? <Chip tone="indigo">{unread[view].toLocaleString('en-IN')} unread</Chip> : undefined}
          className="mb-0"
        />
        <Card className={cn('flex min-h-0 overflow-hidden', PANEL, height)}>
          {showList && (
            <div className={cn('flex min-h-0 flex-col border-border', wide ? 'w-80 shrink-0 border-r xl:w-96' : 'w-full')}>
              <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
                <SearchField
                  value={q}
                  onChange={(v) => {
                    setQ(v);
                    reset();
                  }}
                  label="Search chats"
                  placeholder="Search name, number or message"
                />
                {views.length > 1 && (
                  <FilterPills
                    label="Whose chats"
                    value={view}
                    onChange={(v) => {
                      setView(v);
                      reset();
                    }}
                    options={views.map((v) => ({ value: v, label: v === 'all' && viewer.visible !== null ? 'Team' : VIEW_LABEL[v], count: unread?.[v] }))}
                  />
                )}
                <FilterPills
                  label="Status"
                  value={status}
                  onChange={(v) => {
                    setStatus(v);
                    reset();
                  }}
                  options={[
                    { value: 'any', label: 'All' },
                    { value: 'unread', label: 'Unread' },
                    { value: 'open', label: 'Needs reply' },
                    { value: 'pending', label: 'Waiting' },
                    { value: 'closed', label: 'Closed' },
                  ]}
                />
              </div>
              {list()}
            </div>
          )}
          {showChat && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {selectedId && now ? (
                <ChatView
                  key={selectedId}
                  conversationId={selectedId}
                  now={now}
                  timeZone={tz}
                  leadsBase={leadsBase}
                  me={me ? { id: me.user.id, name: me.user.name, role: me.user.role, status: me.user.status, avatar: me.user.avatar } : null}
                  canSend={canSend}
                  readOnlyReason={readOnly ? 'This support session is read-only. Replies are turned off.' : undefined}
                  canAssign={canAssign}
                  assignees={assignees}
                  canUnassign={viewer.visible === null}
                  onBack={wide ? undefined : () => select(null)}
                  touch={touch}
                />
              ) : (
                <EmptyState className="m-4 flex-1 justify-center" icon={<MessageCircle />} title="Pick a conversation" description="Chats with unread messages are at the top of the list." />
              )}
            </div>
          )}
        </Card>
      </div>
    </RequirePermission>
  );
}
