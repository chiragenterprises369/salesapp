'use client';

import { EMPLOYEE_STATUS_LABEL, formatDuration, formatInr, ROLE_KIND_LABELS, type RoleKind } from '@vistar/shared';
import { Building, ShieldCheck, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { AndroidAppCard } from '@/components/common/android-app-card';
import { PageHeader } from '@/components/common/page-header';
import { ProgressRing } from '@/components/common/progress-ring';
import { ErrorBlock, FilterPills, PANEL, SearchField, StatSkeleton, StatTile, TOUCH } from '@/components/reports/page-kit';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip, StatusChip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useCan, useMe } from '@/lib/session/session';
import type { TeamMemberRow } from '@/lib/world';
import { useTeamMembers } from '@/lib/world/hooks';
import { filterMembers, groupByTeam, totals, type StatusFilter } from './logic';

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-2xs text-muted">{label}</dt>
      <dd className="tabular truncate text-sm font-semibold text-fg">
        {value}
        {sub && <span className="ml-1 text-2xs font-medium text-danger-text">{sub}</span>}
      </dd>
    </div>
  );
}

function MemberCard({ m, isMe }: { m: TeamMemberRow; isMe: boolean }) {
  const role = m.user.role as RoleKind;
  return (
    <li data-member-card>
      <Card interactive className={cn('flex h-full flex-col gap-3 p-4', PANEL)}>
        <div className="flex items-start gap-3">
          <Avatar name={m.user.name} size="lg" status={m.user.status} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-fg">
              {m.user.name}
              {isMe && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
            </h3>
            <p className="truncate text-xs text-muted">{m.title}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <StatusChip status={m.user.status} />
              {m.isManager ? <Chip tone="indigo">Team manager</Chip> : role !== 'employee' && <Chip>{ROLE_KIND_LABELS[role]}</Chip>}
            </div>
          </div>
          {m.targetPct !== null ? (
            <ProgressRing value={m.targetPct} size={56} stroke={5} label={`${m.user.name}: ${m.targetPct}% of this month's revenue target`} />
          ) : (
            <span className="w-14 text-center text-2xs text-muted">No target</span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 sm:grid-cols-4">
          <Metric label="Calls today" value={String(m.stats.callsToday)} />
          <Metric label="Talk time" value={formatDuration(m.stats.talkSecToday)} />
          <Metric label="Open leads" value={m.stats.openLeads.toLocaleString('en-IN')} />
          <Metric label="Open tasks" value={String(m.stats.openTasks)} sub={m.stats.overdueTasks ? `${m.stats.overdueTasks} late` : undefined} />
        </dl>
        <p className="text-xs text-muted">
          Won this month: <span className="tabular font-medium text-fg">{formatInr(m.stats.wonInrThisMonth, { compact: true })}</span> from {m.stats.dealsWonThisMonth} {m.stats.dealsWonThisMonth === 1 ? 'deal' : 'deals'}
        </p>
      </Card>
    </li>
  );
}

/** Team and roles (/app/team): employee cards with live status, today's numbers and target ring, grouped by team. */
export function TeamPage() {
  const me = useMe();
  const query = useTeamMembers();
  const canRoles = useCan('roles.manage');
  const canFloor = useCan('teamfloor.read');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const dq = useDeferredValue(q);
  const rows = useMemo(() => (query.data ? filterMembers(query.data, { q: dq, status }) : []), [query.data, dq, status]);
  const groups = useMemo(() => groupByTeam(rows), [rows]);
  const all = useMemo(() => totals(query.data ?? []), [query.data]);

  const count = (s: StatusFilter) => (query.data ? filterMembers(query.data, { status: s }).length : undefined);

  return (
    <RequirePermission anyOf={['team.read']}>
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Team and roles"
          description={me?.role.dataScope === 'team' ? 'People in your team, their status today and progress against this month’s target.' : 'People in your workspace, the teams they belong to and their progress this month.'}
          meta={query.data ? <Chip>{query.data.length} people</Chip> : undefined}
          actions={
            <>
              {canFloor && (
                <Button asChild className={TOUCH}>
                  <Link href="/app/team-floor">
                    <Building aria-hidden />
                    Live Team Floor
                  </Link>
                </Button>
              )}
              {canRoles && (
                <Button asChild className={TOUCH}>
                  <Link href="/app/settings/roles">
                    <ShieldCheck aria-hidden />
                    Roles and permissions
                  </Link>
                </Button>
              )}
            </>
          }
          className="mb-0"
        />

        {query.isPending ? (
          <StatSkeleton />
        ) : query.isError ? null : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="On call now" value={all.onCall} hint={`${all.available} available · ${all.people} people`} />
            <StatTile label="Calls today" value={all.callsToday.toLocaleString('en-IN')} hint="Finished calls since midnight" />
            <StatTile label="Open leads" value={all.openLeads.toLocaleString('en-IN')} hint={`${all.openTasks} open tasks · ${all.overdueTasks} overdue`} tone={all.overdueTasks ? 'bad' : undefined} />
            <StatTile label="Won this month" value={formatInr(all.wonInr, { compact: true })} hint={all.avgTargetPct !== null ? `${all.avgTargetPct}% of target on average` : `${all.deals} deals`} />
          </div>
        )}

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <FilterPills
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'Everyone', count: count('all') },
              { value: 'on_call', label: EMPLOYEE_STATUS_LABEL.on_call, count: count('on_call') },
              { value: 'idle', label: EMPLOYEE_STATUS_LABEL.idle, count: count('idle') },
              { value: 'busy', label: EMPLOYEE_STATUS_LABEL.busy, count: count('busy') },
              { value: 'away_offline', label: 'Away or offline', count: count('away_offline') },
            ]}
          />
          <SearchField value={q} onChange={setQ} label="Search people" placeholder="Search name, title or team" className="md:w-64" />
        </div>

        {query.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-44 rounded-lg" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorBlock title="The team did not load" onRetry={() => void query.refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<UsersRound />}
            title={query.data.length ? 'Nobody matches' : 'Invite your sales team'}
            description={query.data.length ? 'Clear the search or pick another status.' : 'Add people by email or share an invite link, put them in teams and give each a role.'}
          />
        ) : (
          groups.map((g) => (
            <section key={g.id} aria-labelledby={`team-${g.id}`} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id={`team-${g.id}`} className="text-base font-semibold text-fg">
                  {g.name}
                  <span className="ml-2 text-xs font-normal text-muted-strong">
                    {g.members.length} {g.members.length === 1 ? 'person' : 'people'}
                    {g.manager ? ` · managed by ${g.manager.name}` : ''}
                  </span>
                </h2>
                <p className="tabular text-xs text-muted-strong">
                  {g.totals.callsToday} calls today · {g.totals.openLeads.toLocaleString('en-IN')} open leads · {formatInr(g.totals.wonInr, { compact: true })} won this month
                </p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5">
                {g.members.map((m) => (
                  <MemberCard key={m.user.id} m={m} isMe={m.user.id === me?.user.id} />
                ))}
              </ul>
            </section>
          ))
        )}

        <AndroidAppCard audience="team" />
      </div>
    </RequirePermission>
  );
}
