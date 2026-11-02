'use client';

import type { Meeting } from '@vistar/shared';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { NativeSelect } from '@/components/common/native-select';
import { PageHeader } from '@/components/common/page-header';
import { useNow } from '@/components/common/use-now';
import { Segmented } from '@/components/dashboard/segmented';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useScopedUserList } from '@/lib/api/directory';
import { useAvailability, useMeeting, useMeetings, useRescheduleMeeting } from '@/lib/crm/calendar';
import { useAccount, useContact } from '@/lib/crm/parties';
import { useDeal } from '@/lib/crm/deals';
import { useLead } from '@/lib/leads/data';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { addDays, addMonths, dayKeyIn, dayLabel, instantAt, startOfWeek } from '@/lib/crm/tz';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { useCan, useMe } from '@/lib/session/session';
import { CalendarViews, viewRange, type CalendarItem, type CalendarViewMode } from './calendar-views';
import { MeetingFormSheet, type MeetingSeed } from './meeting-form';
import { MeetingView } from './meeting-view';

const UUID = /^[0-9a-f-]{36}$/i;
const keyOf = (m: Pick<Meeting, 'id' | 'occurrenceStart'>) => `${m.id}|${m.occurrenceStart ?? ''}`;

export function CalendarPage() {
  return (
    <RequirePermission anyOf={['calendar.read']}>
      <Calendar />
    </RequirePermission>
  );
}

function Calendar() {
  useCrmRealtime();
  const router = useRouter();
  const params = useSearchParams();
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const now = useNow(60_000);
  const today = now ? dayKeyIn(now, tz) : null;
  const [mode, setMode] = useState<CalendarViewMode>('week');
  const [anchorState, setAnchor] = useState<string | null>(null);
  const anchor = anchorState ?? today;
  const [who, setWho] = useState<string>('me');
  const users = useScopedUserList();
  const canCreate = useCan('calendar.create');
  const canUpdate = useCan('calendar.update');
  const scope = me?.role.dataScope ?? 'own';
  const [open, setOpen] = useState<Meeting | null>(null);
  const [editing, setEditing] = useState<{ meeting?: Meeting; seed?: MeetingSeed; scope?: 'series' | 'occurrence' } | null>(null);
  const reschedule = useRescheduleMeeting();

  const range = anchor ? viewRange(mode, anchor) : null;
  const query = range ? { from: instantAt(range.from, 0, tz).toISOString(), to: instantAt(addDays(range.to, 1), 0, tz).toISOString(), userId: [who], status: ['scheduled', 'completed', 'cancelled'] as Meeting['status'][] } : null;
  const meetings = useMeetings(query as Parameters<typeof useMeetings>[0]);
  const meId = me?.user.id;
  const items = useMemo<CalendarItem[]>(
    () =>
      (meetings.data?.items ?? []).map((mt) => ({
        id: keyOf(mt),
        title: mt.title,
        startAt: mt.startAt,
        endAt: mt.endAt,
        allDay: mt.allDay,
        tone: mt.status === 'cancelled' ? 'grey' : mt.status === 'completed' ? 'green' : mt.mode === 'video' ? 'blue' : mt.mode === 'phone' ? 'amber' : 'indigo',
        subtitle: [mt.lead?.name ?? mt.contact?.name ?? mt.account?.name, mt.location, mt.organizer && mt.organizer.id !== meId ? mt.organizer.name : null].filter(Boolean).join(' · ') || undefined,
        canMove: canUpdate && mt.status === 'scheduled',
        muted: mt.status === 'cancelled',
      })),
    [meetings.data, canUpdate, meId],
  );
  const byKey = useMemo(() => new Map((meetings.data?.items ?? []).map((mt) => [keyOf(mt), mt])), [meetings.data]);

  // Deep links: ?meeting=<id> opens it; ?new=1&leadId|contactId|accountId|dealId starts a linked meeting.
  const linkMeetingId = params.get('meeting');
  const deepMeeting = useMeeting(linkMeetingId && UUID.test(linkMeetingId) ? linkMeetingId : null);
  const [handledLink, setHandledLink] = useState<string | null>(null);
  if (linkMeetingId && deepMeeting.data && handledLink !== linkMeetingId) {
    setHandledLink(linkMeetingId);
    setOpen(deepMeeting.data);
    setAnchor(dayKeyIn(deepMeeting.data.startAt, tz));
  }
  const wantsNew = params.get('new') === '1';
  const idParam = (k: string) => {
    const v = params.get(k);
    return v && UUID.test(v) ? v : null;
  };
  const seedLead = useLead(wantsNew ? idParam('leadId') : null);
  const seedContact = useContact(wantsNew ? idParam('contactId') : null);
  const seedAccount = useAccount(wantsNew ? idParam('accountId') : null);
  const seedDeal = useDeal(wantsNew ? idParam('dealId') : null);
  const [handledNew, setHandledNew] = useState(false);
  const seedsReady = [[idParam('leadId'), seedLead], [idParam('contactId'), seedContact], [idParam('accountId'), seedAccount], [idParam('dealId'), seedDeal]].every(([id, q]) => !id || (q as { data?: unknown; isError: boolean }).data || (q as { isError: boolean }).isError);
  if (wantsNew && !handledNew && seedsReady && today && canCreate) {
    setHandledNew(true);
    const name = seedLead.data?.name ?? seedContact.data?.name ?? seedAccount.data?.name ?? seedDeal.data?.title;
    setEditing({
      seed: {
        startAt: instantAt(addDays(today, 1), 11 * 60, tz).toISOString(),
        title: name ? `Meeting with ${name}` : '',
        lead: seedLead.data ? { id: seedLead.data.id, label: seedLead.data.name } : null,
        contact: seedContact.data ? { id: seedContact.data.id, label: seedContact.data.name } : null,
        account: seedAccount.data ? { id: seedAccount.data.id, label: seedAccount.data.name } : null,
        deal: seedDeal.data ? { id: seedDeal.data.id, label: seedDeal.data.title } : null,
      },
    });
  }

  const shift = (dir: -1 | 1) => {
    if (!anchor) return;
    setAnchor(mode === 'month' ? addMonths(anchor, dir) : mode === 'week' ? addDays(anchor, 7 * dir) : mode === 'agenda' ? addDays(anchor, 30 * dir) : addDays(anchor, dir));
  };
  const title = !anchor
    ? ''
    : mode === 'month'
      ? dayLabel(anchor, { month: 'long', year: 'numeric' })
      : mode === 'week'
        ? `${dayLabel(startOfWeek(anchor), { day: 'numeric', month: 'short' })} – ${dayLabel(addDays(startOfWeek(anchor), 6), { day: 'numeric', month: 'short', year: 'numeric' })}`
        : mode === 'day'
          ? dayLabel(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          : `Next 30 days from ${dayLabel(anchor, { day: 'numeric', month: 'short' })}`;

  const closeDeepLink = () => {
    if (params.get('meeting') || params.get('new')) router.replace('/app/calendar');
  };

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <PageHeader
        title="Calendar"
        description={`Meetings with leads, contacts and the team. Times in ${tz}.`}
        actions={
          canCreate && (
            <Button variant="primary" disabled={!today} onClick={() => today && setEditing({ seed: { startAt: instantAt(anchor ?? today, 11 * 60, tz).toISOString() } })}>
              <Plus aria-hidden />
              New meeting
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => setAnchor(today)} disabled={!today}>
          Today
        </Button>
        <Button size="icon" variant="ghost" aria-label="Previous" onClick={() => shift(-1)}>
          <ChevronLeft aria-hidden />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Next" onClick={() => shift(1)}>
          <ChevronRight aria-hidden />
        </Button>
        <h2 className="min-w-48 text-base font-semibold text-fg" aria-live="polite">
          {title}
        </h2>
        <Segmented
          label="Calendar view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
            { value: 'day', label: 'Day' },
            { value: 'agenda', label: 'Agenda' },
          ]}
        />
        {scope !== 'own' && (
          <NativeSelect aria-label="Whose calendar" wrapperClassName="w-52 ml-auto" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="me">My calendar</option>
            <option value="all">{scope === 'team' ? 'My team' : 'Everyone'}</option>
            {users
              .filter((u) => u.id !== me?.user.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </NativeSelect>
        )}
      </div>
      {meetings.isError && (
        <div role="alert" className="mb-3 flex items-center justify-between gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
          Meetings did not load. Check your connection.
          <Button size="sm" onClick={() => void meetings.refetch()}>
            Try again
          </Button>
        </div>
      )}
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        {anchor ? (
          <CalendarViews
            mode={mode}
            anchor={anchor}
            timeZone={tz}
            items={items}
            loading={meetings.isFetching}
            onOpen={(it) => {
              const mt = byKey.get(it.id);
              if (mt) setOpen(mt);
            }}
            onMove={(it, startAt, endAt) => {
              const mt = byKey.get(it.id);
              if (!mt) return;
              reschedule.mutate(
                { meeting: mt, startAt, endAt },
                {
                  onSuccess: () => toast.success(`${mt.title} moved to ${dayLabel(dayKeyIn(startAt, tz))}`),
                  onError: (e) => toast.error(formErrorMessage(e, `${mt.title} could not be moved. It is back in its slot.`)),
                },
              );
            }}
            onCreateAt={canCreate ? (startAt) => setEditing({ seed: { startAt } }) : undefined}
            onPickDay={(k) => {
              setAnchor(k);
              setMode('day');
            }}
          />
        ) : (
          <Skeleton className="h-96 w-full rounded-lg" />
        )}
        {scope !== 'own' && today && <AvailabilityPanel today={today} tz={tz} />}
      </div>
      {open && !editing && (
        <MeetingView
          meeting={open}
          onClose={() => {
            setOpen(null);
            closeDeepLink();
          }}
          onEdit={(s) => {
            setEditing({ meeting: open, scope: s });
            setOpen(null);
          }}
        />
      )}
      {editing && (
        <MeetingFormSheet
          meeting={editing.meeting}
          seed={editing.seed}
          scope={editing.scope}
          onClose={() => {
            setEditing(null);
            closeDeepLink();
          }}
        />
      )}
    </div>
  );
}

/** Who is free now and today's busy blocks (working hours, time off, meetings, live status). */
function AvailabilityPanel({ today, tz }: { today: string; tz: string }) {
  const q = useAvailability({ from: instantAt(today, 0, tz).toISOString(), to: instantAt(addDays(today, 1), 0, tz).toISOString() });
  const list = q.data?.items ?? [];
  return (
    <Card className="flex flex-col self-start p-4">
      <h2 data-slot="panel-head" className="mb-3 text-sm font-semibold text-fg">
        Availability today
      </h2>
      {q.isPending ? (
        <div role="status" aria-label="Loading availability" className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <p className="text-sm text-muted-strong">
          Availability did not load.{' '}
          <Button size="sm" variant="link" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-strong">No team members in your scope.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {list.map((a) => {
            const busy = a.busy.filter((b) => b.kind === 'meeting').length;
            const off = a.busy.some((b) => b.kind === 'time_off');
            return (
              <li key={a.user.id} className="flex items-center gap-2">
                <Avatar name={a.user.name} size="sm" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{a.user.name}</p>
                  <p className="truncate text-xs text-muted-strong">
                    {a.workingHours.length === 0 ? 'Not working today' : `${a.workingHours.map((w) => `${timeOf(w.start, tz)}–${timeOf(w.end, tz)}`).join(', ')}`}
                    {busy ? ` · ${busy} ${busy === 1 ? 'meeting' : 'meetings'}` : ''}
                  </p>
                </div>
                {off ? <Chip tone="grey">On leave</Chip> : a.availableNow ? <Chip tone="green">Free now</Chip> : <Chip tone="amber">Busy</Chip>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(':00', '');
