'use client';

import { formatDuration, formatInr } from '@vistar/shared';
import { AlertCircle, BarChart3, RotateCw, Trophy } from 'lucide-react';
import { useMemo } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/session/session';
import { buildWeekCalls } from './my-day-mock';
import { TargetRings } from './targets';
import { Section } from './today-view';
import { useMyDay } from './use-my-day';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** My performance: targets, this month's numbers, calls per day this week, and rank if the company shows it. */
export function PerformanceView() {
  const me = useMe()!;
  const query = useMyDay();
  const week = useMemo(() => buildWeekCalls(me), [me]);
  const max = Math.max(...week, 1);

  return (
    <RequirePermission anyOf={['reports.read']}>
      <PageHeader title="My performance" description="Your progress this month against the targets your manager set." />
      {query.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={<AlertCircle />}
          title="Your numbers did not load"
          description="Check your connection, then try again."
          action={
            <Button size="touch" onClick={() => void query.refetch()}>
              <RotateCw aria-hidden />
              Try again
            </Button>
          }
        />
      ) : (
        // Wide screens (D-066): rank and totals across, then targets | calls per day.
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {query.data.today.stats.rank !== null && (
            <Card className="flex items-center gap-3 p-4 xl:order-1 xl:col-span-2">
              <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent-soft-fg">
                <Trophy className="size-5" />
              </span>
              <p className="text-sm text-fg-secondary">
                You are <span className="text-base font-semibold text-fg">#{query.data.today.stats.rank}</span> on the team leaderboard this month.
              </p>
            </Card>
          )}
          <Section title="Targets this month" icon={<Trophy />} className="xl:order-3">
            <div className="px-2 pb-2">
              <TargetRings targets={query.data.today.targets} />
            </div>
          </Section>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:order-2 xl:col-span-2">
            {[
              { label: 'Calls today', value: String(query.data.today.stats.callsToday) },
              { label: 'Talk time today', value: formatDuration(query.data.today.stats.talkSecToday) },
              { label: 'Calls this week', value: String(week.reduce((a, b) => a + b, 0)) },
              { label: 'Won this month', value: formatInr(query.data.today.stats.wonInrThisMonth, { compact: true }) },
            ].map((s) => (
              <Card key={s.label} className="px-4 py-3">
                <dt className="text-xs text-muted">{s.label}</dt>
                <dd className="text-xl font-semibold text-fg tabular">{s.value}</dd>
              </Card>
            ))}
          </dl>
          <Section title="Calls per day this week" icon={<BarChart3 />} className="xl:order-4">
            <ul className="flex flex-col gap-1.5 px-2 pb-2">
              {week.map((n, i) => (
                <li key={DAYS[i]} className="flex items-center gap-3 text-sm">
                  <span className="w-9 text-xs text-muted">{DAYS[i]}</span>
                  <span className="h-3 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                    <span className="block h-full rounded-full bg-chart-1" style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                  <span className="w-8 text-right text-fg tabular">{n}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </RequirePermission>
  );
}
