'use client';

import { formatDuration, formatInr, minutesInTimeZone, type LeadListItem, type Task } from '@vistar/shared';
import { formatDistanceStrict } from 'date-fns';
import { AlertCircle, CalendarClock, ListTodo, Phone, RotateCw, Sparkles, Trophy } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AndroidAppCard } from '@/components/common/android-app-card';
import { EmptyState } from '@/components/common/empty-state';
import { formatDateTimeIn, formatTimeIn } from '@/components/common/time';
import { useNow } from '@/components/common/use-now';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { WidgetSlot } from '@/lib/packs';
import { useMe } from '@/lib/session/session';
import { TargetRings } from './targets';
import { useClickToCall, useMyDay } from './use-my-day';

function greeting(minutes: number) {
  if (minutes < 12 * 60) return 'Good morning';
  if (minutes < 17 * 60) return 'Good afternoon';
  return 'Good evening';
}

export function DueChip({ dueAt, now, timeZone }: { dueAt: string | null; now: number; timeZone: string }) {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  if (now > 0 && due < now) {
    return (
      <Chip tone="red" dot>
        Overdue {formatDistanceStrict(due, now)}
      </Chip>
    );
  }
  const sameDay = now > 0 && new Intl.DateTimeFormat('en-CA', { timeZone }).format(due) === new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  return <Chip tone="neutral">{sameDay || now === 0 ? formatTimeIn(dueAt, timeZone) : formatDateTimeIn(dueAt, timeZone)}</Chip>;
}

export function Section({ title, count, icon, children }: { title: string; count?: number; icon: ReactNode; children: ReactNode }) {
  const id = `sec-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <Card>
      <section aria-labelledby={id}>
        <h2 id={id} className="flex items-center gap-2 px-4 pt-4 pb-2 text-sm font-semibold text-fg [&_svg]:size-4 [&_svg]:text-fg-secondary">
          {icon}
          {title}
          {count !== undefined && <span className="text-xs font-normal text-muted tabular">{count}</span>}
        </h2>
        <div className="px-2 pb-2">{children}</div>
      </section>
    </Card>
  );
}

export function Row({ title, subtitle, href, meta, action, name }: { title: string; subtitle?: ReactNode; href?: string; meta?: ReactNode; action?: ReactNode; name: string }) {
  const body = (
    <>
      <Avatar name={name} size="md" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
        {meta && <span className="mt-1 flex flex-wrap gap-1.5">{meta}</span>}
      </span>
    </>
  );
  return (
    <li className="flex min-h-14 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
      {href ? (
        <Link href={href} className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md py-1">
          {body}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3 py-1">{body}</span>
      )}
      {action}
    </li>
  );
}

function CallButton({ name, phone }: { name: string; phone: string | null }) {
  const call = useClickToCall();
  return (
    <Button size="icon-touch" variant="ghost" aria-label={`Call ${name}`} onClick={() => call({ name, phone })} disabled={!phone}>
      <Phone aria-hidden />
    </Button>
  );
}

const leadHref = (id: string | null) => (id ? `/me/leads?lead=${id}` : undefined);
const SOURCE_LABEL: Record<LeadListItem['source'], string> = {
  indiamart: 'IndiaMART',
  website: 'Website',
  whatsapp: 'WhatsApp',
  manual: 'Added by hand',
  webhook: 'Webhook',
  import: 'Import',
  api: 'API',
};
const sourceLabel = (l: LeadListItem) => SOURCE_LABEL[l.source];

/** Employee Home: what to do today, in order (calls, follow-ups, tasks, new leads), plus targets. */
export function TodayView() {
  const me = useMe()!;
  const tz = me.workspace.timezone;
  const now = useNow(60_000);
  const query = useMyDay();
  const call = useClickToCall();
  const firstName = me.user.name.split(' ')[0];

  if (query.isPending) return <TodaySkeleton />;
  if (query.isError) {
    return (
      <EmptyState
        icon={<AlertCircle />}
        title="Your day did not load"
        description="Check your connection, then try again."
        action={
          <Button size="touch" onClick={() => void query.refetch()}>
            <RotateCw aria-hidden />
            Try again
          </Button>
        }
      />
    );
  }

  const { today, phones } = query.data;
  const next = today.callsToMake[0];
  const s = today.stats;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          {now > 0 ? greeting(minutesInTimeZone(new Date(now), tz)) : 'Hello'}, {firstName}
        </h1>
        <p className="text-sm text-muted-strong">
          {now > 0 && new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(now)}
          {' · '}
          {today.callsToMake.length + today.tasksDue.length} things due today
        </p>
      </header>

      {next && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted">Next call</p>
            <p className="truncate text-base font-semibold text-fg">{next.leadName}</p>
            <p className="truncate text-sm text-fg-secondary">{next.notes ?? next.title}</p>
            <div className="mt-1.5">
              <DueChip dueAt={next.dueAt} now={now} timeZone={tz} />
            </div>
          </div>
          <Button variant="primary" size="touch" className="w-full sm:w-auto" onClick={() => call({ name: next.leadName ?? 'lead', phone: phones[next.leadId ?? ''] ?? null })}>
            <Phone aria-hidden />
            Call {next.leadName?.split(' ')[0]}
          </Button>
        </Card>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Calls today', value: String(s.callsToday) },
          { label: 'Talk time', value: formatDuration(s.talkSecToday) },
          { label: 'Leads contacted', value: String(s.leadsContactedToday) },
          { label: 'Won this month', value: formatInr(s.wonInrThisMonth, { compact: true }) },
        ].map((stat) => (
          <Card key={stat.label} className="px-4 py-3">
            <dt className="text-xs text-muted">{stat.label}</dt>
            <dd className="text-xl font-semibold text-fg tabular">{stat.value}</dd>
          </Card>
        ))}
      </dl>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 3xl:grid-cols-4">
        <Section title="Calls to make" count={today.callsToMake.length} icon={<Phone />}>
          <TaskList tasks={today.callsToMake} phones={phones} now={now} timeZone={tz} empty="No calls due. New call tasks appear here." />
        </Section>
        <Section title="Follow-ups due" count={today.followUps.length} icon={<CalendarClock />}>
          {today.followUps.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">No follow-ups due today.</p>
          ) : (
            <ul>
              {today.followUps.map((l) => (
                <Row
                  key={l.id}
                  name={l.name}
                  title={l.name}
                  subtitle={l.companyName ?? l.city ?? undefined}
                  href={leadHref(l.id)}
                  meta={<DueChip dueAt={l.nextFollowUpAt} now={now} timeZone={tz} />}
                  action={<CallButton name={l.name} phone={l.phone} />}
                />
              ))}
            </ul>
          )}
        </Section>
        <Section title="Tasks due today" count={today.tasksDue.length} icon={<ListTodo />}>
          <TaskList tasks={today.tasksDue} phones={phones} now={now} timeZone={tz} empty="Nothing due today." />
          <div className="px-2 pt-1">
            <Button asChild variant="link" size="sm">
              <Link href="/me/tasks">All tasks</Link>
            </Button>
          </div>
        </Section>
        <Section title="New leads for you" count={today.newAssigned.length} icon={<Sparkles />}>
          {today.newAssigned.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">No new leads in the last 24 hours.</p>
          ) : (
            <ul>
              {today.newAssigned.map((l) => (
                <Row
                  key={l.id}
                  name={l.name}
                  title={l.name}
                  subtitle={[l.companyName, l.city].filter(Boolean).join(', ')}
                  href={leadHref(l.id)}
                  meta={
                    <>
                      <Chip tone="indigo">{sourceLabel(l)}</Chip>
                      {now > 0 && <Chip>{formatDistanceStrict(Date.parse(l.createdAt), now)} ago</Chip>}
                    </>
                  }
                  action={<CallButton name={l.name} phone={l.phone} />}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>

      <WidgetSlot slot="employee.home" className="grid-cols-1 lg:grid-cols-2" />

      <Section title="Targets this month" icon={<Trophy />}>
        <div className="px-2 pb-2">
          <TargetRings targets={today.targets} />
          {s.rank !== null && (
            <p className="mt-3 text-sm text-fg-secondary">
              You are <span className="font-semibold text-fg">#{s.rank}</span> on the team leaderboard this month.
            </p>
          )}
        </div>
      </Section>

      <AndroidAppCard />
    </div>
  );
}

export function TaskList({ tasks, phones, now, timeZone, empty }: { tasks: Task[]; phones: Record<string, string | null>; now: number; timeZone: string; empty: string }) {
  if (tasks.length === 0) return <p className="px-2 py-3 text-sm text-muted">{empty}</p>;
  return (
    <ul>
      {tasks.map((t) => (
        <Row
          key={t.id}
          name={t.leadName ?? t.title}
          title={t.title}
          subtitle={t.notes ?? t.leadName ?? undefined}
          href={leadHref(t.leadId)}
          meta={
            <>
              <DueChip dueAt={t.dueAt} now={now} timeZone={timeZone} />
              {(t.priority === 'high' || t.priority === 'urgent') && <Chip tone={t.priority === 'urgent' ? 'red' : 'amber'}>{t.priority === 'urgent' ? 'Urgent' : 'High'}</Chip>}
            </>
          }
          action={t.leadName ? <CallButton name={t.leadName} phone={phones[t.leadId ?? ''] ?? null} /> : undefined}
        />
      ))}
    </ul>
  );
}

function TodaySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only" role="status">
        Loading your day
      </span>
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 3xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-48 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
