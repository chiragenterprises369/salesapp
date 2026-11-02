'use client';

import { formatDuration, ROLE_KIND_LABELS, type AttentionItem, type ChipTone } from '@vistar/shared';
import { ExternalLink, ListTodo, MapPin, MessageCircle, MessageSquare, Monitor, Phone, PhoneCall, Smartphone, UserPlus, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { useUsers } from '@/lib/api/directory';
import { cn } from '@/lib/cn';
import { useCan, useMe } from '@/lib/session/session';
import { useWorldCalls, useWorldTasks } from '@/lib/world/hooks';
import { TargetRing } from '../panel/employee-panel';
import { NeedsYouItem } from '../panel/needs-you-list';
import { durationLabel, timeAgo } from '../panel/time';
import { useNow } from '../state/env';
import { firstName } from '../state/reducer';
import { AssignLeadDialog } from './assign-lead-dialog';
import { telUrl, whatsappUrl, zonedDayStartIso } from './contact';
import {
  clientLabel,
  confidenceLabel,
  SCREEN_LABEL,
  SOURCE_LABEL,
  statusView,
  ZONE_SOURCE_LABEL,
  type LiveFloorEmployee,
  type LivePresence,
} from './live-presence';
import { MessageDialog } from './message-dialog';
import type { ModuleId } from './store';

const TONE_DOT: Record<ChipTone, string> = {
  neutral: 'bg-muted',
  indigo: 'bg-status-indigo-fg',
  blue: 'bg-status-blue-fg',
  green: 'bg-status-green-fg',
  amber: 'bg-status-amber-fg',
  grey: 'bg-status-grey-fg',
  red: 'bg-status-red-fg',
};

export interface PersonPanelProps {
  employee: LiveFloorEmployee;
  live: LivePresence | undefined;
  attention: AttentionItem[];
  /** Employee floor or a read-only session: status only, no actions. */
  readOnly: boolean;
  onClose: () => void;
  /** Inside the small-screen dialog: no own close button or card chrome. */
  embedded: boolean;
  onResolve: (item: AttentionItem) => void;
  onOpenLead: (leadId: string) => void;
  /** Open their leads in the Leads panel (owner filter). */
  onShowLeads: (userId: string) => void;
  onOpenModule: (m: ModuleId) => void;
  /** Mock mode: animate an assignment locally (API mode gets lead.assigned from the socket). */
  onAssigned?: (lead: { id: string; name: string }, fromUserId: string | null, toUserId: string) => void;
}

/**
 * Person panel of the floor workspace (SPEC 29.11): live status with its source, where in the office,
 * what they are doing (call, lead, screen, app), today's numbers, open tasks and today's calls, and the
 * actions (call, WhatsApp, message, assign a lead, open their leads, tasks and calls).
 */
export function PersonPanel(props: PersonPanelProps) {
  const { employee: e, live, attention, readOnly, onClose, embedded } = props;
  const me = useMe();
  const now = useNow();
  const titleId = useId();
  const canTeam = useCan('team.read');
  const canAssign = useCan('leads.assign') && !readOnly;
  const canTasks = useCan('tasks.read');
  const canCalls = useCan('calls.read');
  const seesTeam = !!me && me.role.dataScope !== 'own' && canTeam;
  const isMe = me?.user.id === e.id;
  const [dialog, setDialog] = useState<'assign' | 'message' | null>(null);

  const users = useUsers();
  const phone = useMemo(() => users.data?.find((u) => u.id === e.id)?.phone ?? null, [users.data, e.id]);
  const tel = telUrl(phone);
  const wa = whatsappUrl(phone);

  const status = statusView(live, e.status);
  const activity = live?.activity ?? e.activity ?? null;
  const onCall = e.status === 'on_call';
  const callStart = e.activeCall?.startedAt ?? (activity?.callStartedAt ? Date.parse(activity.callStartedAt) : null);
  const callLead = e.activeCall?.leadName ?? activity?.leadName ?? null;
  const since = live?.since ?? e.statusSince;
  const offline = (live?.status ?? null) === 'offline' || e.status === 'offline';
  const leadId = e.currentLeadId ?? activity?.leadId ?? null;
  const leadName = e.currentLeadName ?? activity?.leadName ?? null;
  const zone = live?.zone ?? null;
  const screen = activity?.screen ?? null;
  const client = clientLabel(activity);

  return (
    <section
      aria-labelledby={titleId}
      data-person-panel={e.id}
      data-presence={live?.status ?? e.status}
      data-zone={zone?.zoneId ?? undefined}
      data-screen={screen ?? undefined}
      className={cn('flex min-h-0 flex-col', !embedded && 'rounded-lg border border-border bg-surface shadow-card')}
      onKeyDown={(ev) => {
        if (ev.key === 'Escape' && !embedded && !ev.defaultPrevented) {
          ev.stopPropagation();
          onClose();
        }
      }}
    >
      <header data-slot="panel-head" className={cn('flex items-start gap-3 border-b border-border', embedded ? 'px-5 pt-5 pr-12 pb-4' : 'px-4 py-3')}>
        <Avatar name={e.name} size="lg" status={e.status} />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="truncate text-base font-semibold text-fg">
            {e.name}
            {isMe && <span className="ml-1.5 text-xs font-normal text-muted-strong">(you)</span>}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>{ROLE_KIND_LABELS[e.role]}</span>
            <Chip tone={status.tone} dot>
              {status.label}
            </Chip>
            {live?.isFieldStaff && <Chip tone="neutral">Field staff</Chip>}
          </p>
        </div>
        {!embedded && (
          <Button size="icon-sm" variant="ghost" aria-label="Close employee details" title={`Close ${e.name} details (Esc)`} onClick={onClose}>
            <X aria-hidden />
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Block label="Status">
          {onCall ? (
            <p className="flex items-center gap-1.5 text-sm text-fg">
              <PhoneCall aria-hidden className="size-4 text-status-blue-fg" />
              On a call{callLead ? ` with ${callLead}` : ''}
              {callStart && now ? <span className="tabular ml-auto font-medium">{formatDuration((now - callStart) / 1000)}</span> : null}
            </p>
          ) : (
            <p className="text-sm text-fg">
              {status.label}
              {since && now && !offline ? <span className="text-muted"> for {durationLabel(now - since)}</span> : null}
            </p>
          )}
          {activity?.note && <p className="text-sm text-fg-secondary">“{activity.note}”</p>}
          {offline ? (
            <p className="text-xs text-muted-strong">{live?.lastSeenAt && now ? `Last seen ${timeAgo(live.lastSeenAt, now)}` : 'Not seen today'}</p>
          ) : (
            live?.source && <p className="text-xs text-muted-strong">Source: {SOURCE_LABEL[live.source]}</p>
          )}
          {onCall && activity?.client === 'android' && (
            <p className="text-xs text-muted-strong">SIM call: “On a call” starts at dialling. The talk time comes from the call log after the call.</p>
          )}
        </Block>

        <Block label="Where">
          {zone ? (
            <>
              <p className="flex items-center gap-1.5 text-sm text-fg">
                <MapPin aria-hidden className="size-4 text-muted" />
                {zone.zoneName ?? 'A room on the floor'}
              </p>
              <p className="text-xs text-muted-strong">
                {ZONE_SOURCE_LABEL[zone.source]} · {confidenceLabel(zone.source, zone.confidence)} confidence
                {now ? ` · last signal ${timeAgo(zone.at, now)}` : ''}
              </p>
            </>
          ) : live?.isFieldStaff && live.checkedIn ? (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg">
              Out in the field (checked in)
              {seesTeam && (
                <Link href="/app/attendance/live" data-floor-leave="" className="focus-ring rounded-sm text-sm text-accent-text underline-offset-4 hover:underline">
                  See the field map
                </Link>
              )}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">{offline ? 'Not in' : 'Room not known'}</p>
              {!offline && <p className="text-xs text-muted-strong">Rooms come from office beacons, Wi-Fi or a QR or NFC scan in the Android app.</p>}
            </>
          )}
        </Block>

        <Block label="Doing now">
          {leadName ? (
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium text-fg">{leadName}</p>
              {leadId && (
                <Button size="sm" variant="ghost" onClick={() => props.onOpenLead(leadId)}>
                  Open
                  <ExternalLink aria-hidden />
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">No lead open</p>
          )}
          {!offline && (screen || client) && (
            <p className="flex items-center gap-1.5 text-xs text-muted-strong">
              {activity?.client === 'android' ? <Smartphone aria-hidden className="size-3.5" /> : <Monitor aria-hidden className="size-3.5" />}
              {[screen ? `Screen: ${SCREEN_LABEL[screen]}` : null, client].filter(Boolean).join(' · ')}
            </p>
          )}
        </Block>

        <dl className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <div>
            <dt className="text-xs text-muted-strong">Calls today</dt>
            <dd className="tabular text-xl font-semibold text-fg">{e.callsToday}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-strong">Avg talk time</dt>
            <dd className="tabular text-xl font-semibold text-fg">{formatDuration(e.avgTalkSec)}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="sr-only">Monthly calls target</dt>
            <dd>
              <TargetRing pct={e.targetPct} />
            </dd>
          </div>
        </dl>

        {attention.length > 0 && (
          <Block label="Needs you">
            <ul className="divide-y divide-border">
              {attention.map((item) => (
                <NeedsYouItem key={item.id} item={item} who={null} readOnly={readOnly} onResolve={props.onResolve} compact />
              ))}
            </ul>
          </Block>
        )}

        {seesTeam && !isMe && canTasks && <PersonTasks userId={e.id} onOpenLead={props.onOpenLead} onMore={() => props.onOpenModule('tasks')} />}
        {seesTeam && !isMe && canCalls && <PersonCalls userId={e.id} timezone={me?.workspace.timezone ?? 'Asia/Kolkata'} onMore={() => props.onOpenModule('calls')} />}

        <Block label="Recent activity">
          {e.recent.length === 0 ? (
            <p className="text-sm text-muted">Nothing new since you opened the floor.</p>
          ) : (
            <ol className="space-y-1.5">
              {e.recent.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-sm">
                  <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', TONE_DOT[a.tone])} />
                  <span className="min-w-0 flex-1 text-fg-secondary">{a.text}</span>
                  <span className="shrink-0 text-xs text-muted-strong">{now ? timeAgo(a.at, now) : ''}</span>
                </li>
              ))}
            </ol>
          )}
        </Block>
      </div>

      {!readOnly && seesTeam && !isMe && (
        <footer className="flex flex-wrap gap-2 border-t border-border px-4 py-3" aria-label={`Actions for ${e.name}`}>
          <ContactButton href={tel} icon={<Phone aria-hidden />} label="Call" missing={users.isPending ? 'Loading the phone number' : `${firstName(e.name)} has no phone number in Team and roles`} />
          <ContactButton href={wa} external icon={<MessageCircle aria-hidden />} label="WhatsApp" missing={users.isPending ? 'Loading the phone number' : `${firstName(e.name)} has no phone number in Team and roles`} />
          {!tel && !users.isPending && <p className="w-full text-xs text-muted-strong">Add a phone number for {firstName(e.name)} in Team and roles to call or WhatsApp from here.</p>}
          <Button size="sm" onClick={() => setDialog('message')}>
            <MessageSquare aria-hidden />
            Message
          </Button>
          {canAssign && (
            <Button size="sm" onClick={() => setDialog('assign')}>
              <UserPlus aria-hidden />
              Assign a lead
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => props.onShowLeads(e.id)}>
            <Users aria-hidden />
            Their leads
          </Button>
          {canTasks && (
            <Button size="sm" variant="ghost" onClick={() => props.onOpenModule('tasks')}>
              <ListTodo aria-hidden />
              Tasks
            </Button>
          )}
          {canCalls && (
            <Button size="sm" variant="ghost" onClick={() => props.onOpenModule('calls')}>
              <Phone aria-hidden />
              Calls
            </Button>
          )}
        </footer>
      )}

      {dialog === 'message' && (
        <MessageDialog person={{ id: e.id, name: e.name }} leadId={leadId} leadName={leadName} open onOpenChange={(o) => !o && setDialog(null)} />
      )}
      {dialog === 'assign' && (
        <AssignLeadDialog
          person={{ id: e.id, name: e.name }}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          onAssigned={(lead, from) => props.onAssigned?.({ id: lead.id, name: lead.name }, from, e.id)}
        />
      )}
    </section>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-strong">{label}</p>
      {children}
    </div>
  );
}

function ContactButton({ href, external, icon, label, missing }: { href: string | null; external?: boolean; icon: ReactNode; label: string; missing: string }) {
  if (!href)
    return (
      <Button size="sm" disabled title={missing}>
        {icon}
        {label}
        <span className="sr-only">: {missing}</span>
      </Button>
    );
  return (
    <Button size="sm" asChild>
      <a href={href} data-floor-leave="" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {icon}
        {label}
        {external && <span className="sr-only"> (opens in a new tab)</span>}
      </a>
    </Button>
  );
}

function PersonTasks({ userId, onOpenLead, onMore }: { userId: string; onOpenLead: (leadId: string) => void; onMore: () => void }) {
  const tasks = useWorldTasks({ scope: 'team', assigneeId: userId, status: ['open'], limit: 50 });
  const now = useNow();
  const items = tasks.data?.items ?? [];
  return (
    <Block label={`Open tasks${tasks.data ? ` (${items.length}${tasks.data.nextCursor ? '+' : ''})` : ''}`}>
      {tasks.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : tasks.isError ? (
        <p className="text-sm text-danger-text">Tasks did not load.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No open tasks.</p>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 5).map((t) => {
            const due = t.dueAt ? Date.parse(t.dueAt) : null;
            const overdue = due !== null && now > 0 && due < now;
            return (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-fg-secondary">{t.title}</span>
                {overdue && <Chip tone="red">Overdue</Chip>}
                {t.leadId && (
                  <Button size="sm" variant="ghost" onClick={() => onOpenLead(t.leadId!)} aria-label={`Open the lead of ${t.title}`}>
                    <ExternalLink aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
          {items.length > 5 && (
            <li>
              <Button size="sm" variant="link" onClick={onMore}>
                See all in the Tasks panel
              </Button>
            </li>
          )}
        </ul>
      )}
    </Block>
  );
}

function PersonCalls({ userId, timezone, onMore }: { userId: string; timezone: string; onMore: () => void }) {
  const [from] = useState(() => zonedDayStartIso(timezone));
  const calls = useWorldCalls({ userId, from, limit: 50 });
  const items = calls.data?.items ?? [];
  return (
    <Block label="Today's calls">
      {calls.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : calls.isError ? (
        <p className="text-sm text-danger-text">Calls did not load.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No calls yet today.</p>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 5).map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-fg-secondary">{c.leadName ?? (c.phone || 'Unknown number')}</span>
              <span className="tabular shrink-0 text-xs text-muted-strong">{c.endedAt ? formatDuration(c.durationSec) : 'Live'}</span>
            </li>
          ))}
          {items.length > 5 && (
            <li>
              <Button size="sm" variant="link" onClick={onMore}>
                See all in the Calls panel
              </Button>
            </li>
          )}
        </ul>
      )}
    </Block>
  );
}
