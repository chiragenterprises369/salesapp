'use client';

import { formatInr, type ChipTone, type TargetMetric } from '@vistar/shared';
import { ArrowDownRight, ArrowUpRight, Minus, Target } from 'lucide-react';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { ProgressRing } from '@/components/common/progress-ring';
import { useMediaQuery } from '@/components/common/use-media-query';
import { useNow } from '@/components/common/use-now';
import { ErrorBlock, FilterPills, PANEL, SectionCard, StatSkeleton, StatTile } from '@/components/reports/page-kit';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/session/session';
import { useTargets } from '@/lib/world/hooks';
import { METRICS, monthElapsed, paceOf, periodsFor, previousPeriod, sumMetric, targetRows, type MetricProgress, type Pace, type SubjectRow } from './logic';

export const METRIC_LABEL: Record<TargetMetric, string> = { revenue_inr: 'Revenue', deals_won: 'Deals won', calls: 'Calls', leads_converted: 'Leads converted' };
const fmt = (metric: TargetMetric, v: number) => (metric === 'revenue_inr' ? formatInr(v, { compact: true }) : v.toLocaleString('en-IN'));
const PACE: Record<Pace, { label: string; tone: ChipTone }> = {
  hit: { label: 'Target hit', tone: 'green' },
  ahead: { label: 'Ahead', tone: 'green' },
  on_track: { label: 'On track', tone: 'blue' },
  behind: { label: 'Behind', tone: 'amber' },
  missed: { label: 'Missed', tone: 'red' },
};

function monthName(period: string) {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)));
}

function Delta({ m, compare }: { m: MetricProgress; compare: string }) {
  if (m.prevPct === null) return <span className="text-2xs text-muted">No target in {compare}</span>;
  const d = m.pct - m.prevPct;
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-2xs', d > 0 ? 'text-success-text' : d < 0 ? 'text-danger-text' : 'text-muted')}>
      <Icon aria-hidden className="size-3" />
      {m.prevPct}% in {compare}
      <span className="sr-only">{d === 0 ? ', same progress' : d > 0 ? `, up ${d} points` : `, down ${-d} points`}</span>
    </span>
  );
}

/** Labelled progress bar: text carries the value; the bar is decorative. */
export function MetricBar({ metric, m, compare, elapsedPct }: { metric: TargetMetric; m: MetricProgress; compare?: string; elapsedPct?: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-medium text-fg-secondary">{METRIC_LABEL[metric]}</span>
        <span className="tabular shrink-0 text-fg">
          {fmt(metric, m.achieved)} <span className="text-muted">of {fmt(metric, m.target)}</span> <span className="font-semibold">{m.pct}%</span>
        </span>
      </div>
      <div aria-hidden className="relative h-2 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-250 ease-standard', m.pct >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${Math.min(100, m.pct)}%` }} />
        {elapsedPct !== undefined && elapsedPct < 100 && <div className="absolute inset-y-0 w-px bg-fg-secondary" style={{ left: `${elapsedPct}%` }} />}
      </div>
      {compare && <Delta m={m} compare={compare} />}
    </div>
  );
}

function SubjectCard({ row, compare, elapsed }: { row: SubjectRow; compare: string; elapsed: { pct: number; complete: boolean } }) {
  const rev = row.metrics.revenue_inr;
  const pace = rev ? paceOf(rev.pct, elapsed.pct, elapsed.complete) : null;
  return (
    <Card data-target-subject={row.subjectType} className={cn('flex flex-col gap-3 p-4', PANEL)}>
      <div className="flex items-center gap-3">
        {rev ? <ProgressRing value={rev.pct} size={64} label={`${row.subjectName}: ${rev.pct}% of the revenue target`} /> : <Avatar name={row.subjectName} size="lg" />}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-fg">{row.subjectName}</h3>
          {rev && (
            <p className="tabular text-xs text-muted">
              {formatInr(rev.achieved, { compact: true })} of {formatInr(rev.target, { compact: true })} revenue
            </p>
          )}
          {pace && <Chip tone={PACE[pace].tone} className="mt-1">{PACE[pace].label}</Chip>}
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {METRICS.map((k) => {
          const m = row.metrics[k];
          return m ? <MetricBar key={k} metric={k} m={m} compare={compare} elapsedPct={elapsed.complete ? undefined : elapsed.pct} /> : null;
        })}
      </div>
    </Card>
  );
}

/** Targets (/app/targets): monthly targets per person and team with rings and bars, this month vs last month. */
export function TargetsPage() {
  const me = useMe();
  const now = useNow(60_000);
  const query = useTargets();
  const wide = useMediaQuery('(min-width: 1024px)');
  const [which, setWhich] = useState<'current' | 'previous'>('current');
  const periods = now ? periodsFor(now) : null;
  const period = periods ? periods[which] : '';
  const compareTo = period ? previousPeriod(period) : '';
  // 96 targets at most: cheap enough to derive on every render.
  const rows = query.data && period ? targetRows(query.data, period, compareTo) : [];
  const teams = rows.filter((r) => r.subjectType === 'team');
  const people = rows.filter((r) => r.subjectType === 'user');
  const elapsed = period && now ? monthElapsed(period, now) : { day: 0, days: 30, pct: 0, complete: false };
  const compareLabel = compareTo ? monthName(compareTo).split(' ')[0]! : '';

  return (
    <RequirePermission anyOf={['targets.read']}>
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Targets"
          description={me?.role.dataScope === 'team' ? 'Monthly revenue, deals, calls and conversion targets for you and your team.' : 'Monthly revenue, deals, calls and conversion targets for each person and team.'}
          actions={
            periods && (
              <FilterPills
                label="Month"
                value={which}
                onChange={setWhich}
                options={[
                  { value: 'current', label: monthName(periods.current) },
                  { value: 'previous', label: monthName(periods.previous) },
                ]}
              />
            )
          }
          className="mb-0"
        />

        {query.isPending || !now ? (
          <>
            <StatSkeleton />
            <Skeleton className="h-64 rounded-lg" />
          </>
        ) : query.isError ? (
          <ErrorBlock title="Targets did not load" onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Target />} title={`No targets for ${monthName(period)}`} description="Set a target per person or team. Progress shows here and on each rep's My performance page." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {METRICS.map((k) => {
                const s = sumMetric(rows, k);
                return <StatTile key={k} label={METRIC_LABEL[k]} value={`${s.pct}%`} hint={`${fmt(k, s.achieved)} of ${fmt(k, s.target)}`} tone={s.pct >= elapsed.pct ? 'good' : undefined} />;
              })}
            </div>
            <p className="text-xs text-muted-strong" aria-live="polite">
              {elapsed.complete ? `${monthName(period)} is complete: final results.` : `Day ${elapsed.day} of ${elapsed.days}: ${elapsed.pct}% of the month has gone. The line on each bar marks where you should be.`}
            </p>

            {teams.length > 0 && (
              <section aria-labelledby="targets-teams" className="flex flex-col gap-2">
                <h2 id="targets-teams" className="text-base font-semibold text-fg">
                  Teams
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {teams.map((r) => (
                    <SubjectCard key={r.subjectId} row={r} compare={compareLabel} elapsed={elapsed} />
                  ))}
                </div>
              </section>
            )}

            <SectionCard title="People" description={`Progress in ${monthName(period)} compared with ${monthName(compareTo)}`} bodyClassName={wide ? 'px-0 pb-0' : undefined}>
              {wide ? (
                <Table aria-label={`Targets by person, ${monthName(period)}`}>
                  <TableHeader sticky={false}>
                    <TableRow className="hover:bg-surface">
                      <TableHead>Person</TableHead>
                      {METRICS.map((k) => (
                        <TableHead key={k}>{METRIC_LABEL[k]}</TableHead>
                      ))}
                      <TableHead>Pace</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {people.map((r) => {
                      const rev = r.metrics.revenue_inr;
                      const pace = rev ? paceOf(rev.pct, elapsed.pct, elapsed.complete) : null;
                      return (
                        <TableRow key={r.subjectId} data-target-subject="user">
                          <TableCell className="py-2">
                            <span className="flex items-center gap-2.5">
                              {rev ? <ProgressRing value={rev.pct} size={40} stroke={4} label={`${r.subjectName}: ${rev.pct}% of revenue target`} /> : <Avatar name={r.subjectName} size="md" />}
                              <span className="font-medium">{r.subjectName}</span>
                            </span>
                          </TableCell>
                          {METRICS.map((k) => {
                            const m = r.metrics[k];
                            return (
                              <TableCell key={k} className="h-auto min-w-40 py-2 whitespace-normal">
                                {m ? <MetricBar metric={k} m={m} compare={compareLabel} elapsedPct={elapsed.complete ? undefined : elapsed.pct} /> : '–'}
                              </TableCell>
                            );
                          })}
                          <TableCell>{pace && <Chip tone={PACE[pace].tone}>{PACE[pace].label}</Chip>}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {people.map((r) => (
                    <SubjectCard key={r.subjectId} row={r} compare={compareLabel} elapsed={elapsed} />
                  ))}
                </div>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </RequirePermission>
  );
}
