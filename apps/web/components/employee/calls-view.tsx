'use client';

import { formatDuration, type Call, type CallOutcome, type ChipTone } from '@vistar/shared';
import { formatDistanceStrict } from 'date-fns';
import { AlertCircle, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, RotateCw } from 'lucide-react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { useNow } from '@/components/common/use-now';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/session/session';
import { Row, Section, TaskList } from './today-view';
import { formatPhone, useClickToCall, useMyDay, useRecentCalls } from './use-my-day';

const OUTCOME: Record<CallOutcome, { label: string; tone: ChipTone }> = {
  answered: { label: 'Answered', tone: 'blue' },
  interested: { label: 'Interested', tone: 'green' },
  not_interested: { label: 'Not interested', tone: 'grey' },
  callback: { label: 'Call back', tone: 'amber' },
  missed: { label: 'Missed', tone: 'red' },
  wrong_number: { label: 'Wrong number', tone: 'grey' },
  voicemail: { label: 'Voicemail', tone: 'grey' },
};

function DirectionIcon({ call }: { call: Call }) {
  const Icon = call.status === 'missed' ? PhoneMissed : call.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing;
  const label = call.status === 'missed' ? 'Missed call' : call.direction === 'inbound' ? 'Incoming call' : 'Outgoing call';
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg-secondary" title={label}>
      <Icon aria-hidden className="size-4" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Calls: who to call now (click-to-call) and the calls you made or missed today. */
export function CallsView() {
  const me = useMe()!;
  const tz = me.workspace.timezone;
  const now = useNow(60_000);
  const day = useMyDay();
  const recent = useRecentCalls();
  const call = useClickToCall();

  return (
    <RequirePermission anyOf={['calls.read']}>
      <PageHeader title="Calls" description="Tap to call. Your phone rings first, then Vistar connects the lead and logs the call." />
      <div className="flex flex-col gap-4">
        <Section title="To call" count={day.data ? day.data.today.callsToMake.length + day.data.today.followUps.length : undefined} icon={<Phone />}>
          {day.isPending ? (
            <ListSkeleton />
          ) : day.isError ? (
            <RetryRow onRetry={() => void day.refetch()} />
          ) : (
            <>
              <TaskList tasks={day.data.today.callsToMake} phones={day.data.phones} now={now} timeZone={tz} empty="No call tasks right now." />
              {day.data.today.followUps.length > 0 && (
                <ul>
                  {day.data.today.followUps.map((l) => (
                    <Row
                      key={l.id}
                      name={l.name}
                      title={l.name}
                      subtitle={`Follow-up · ${formatPhone(l.phone)}`}
                      href={`/me/leads?lead=${l.id}`}
                      action={
                        <Button size="icon-touch" variant="ghost" aria-label={`Call ${l.name}`} disabled={!l.phone} onClick={() => call({ name: l.name, phone: l.phone })}>
                          <Phone aria-hidden />
                        </Button>
                      }
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </Section>

        <Section title="Recent calls" icon={<PhoneOutgoing />}>
          {recent.isPending ? (
            <ListSkeleton />
          ) : recent.isError ? (
            <RetryRow onRetry={() => void recent.refetch()} />
          ) : recent.data.length === 0 ? (
            <EmptyState size="sm" className="border-none" title="No calls yet today" description="Calls you make from Vistar show up here with outcome and duration." />
          ) : (
            <ul>
              {recent.data.map((c) => {
                const number = c.direction === 'inbound' ? c.from : c.to;
                return (
                  <li key={c.id} className="flex min-h-14 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-2">
                    <DirectionIcon call={c} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{c.leadName ?? formatPhone(number)}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {c.outcome && <Chip tone={OUTCOME[c.outcome].tone}>{OUTCOME[c.outcome].label}</Chip>}
                        <span className="tabular">{c.durationSec > 0 ? formatDuration(c.durationSec) : 'No answer'}</span>
                        <span aria-hidden>·</span>
                        <span>{now > 0 ? `${formatDistanceStrict(Date.parse(c.startedAt), now)} ago` : ''}</span>
                      </span>
                    </span>
                    <Button size="icon-touch" variant="ghost" aria-label={`Call ${c.leadName ?? formatPhone(number)} back`} onClick={() => call({ name: c.leadName ?? formatPhone(number), phone: number })}>
                      <Phone aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </RequirePermission>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-2 py-2" aria-busy="true">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function RetryRow({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 px-2 py-3 text-sm text-danger-text" role="alert">
      <AlertCircle aria-hidden className="size-4" />
      <span className="flex-1">This list did not load.</span>
      <Button size="touch" onClick={onRetry}>
        <RotateCw aria-hidden />
        Try again
      </Button>
    </div>
  );
}
