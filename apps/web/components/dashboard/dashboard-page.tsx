'use client';

import { useQuery } from '@tanstack/react-query';
import { formatInr, formatNumber, type MeResponse } from '@vistar/shared';
import { createEventSimulator } from '@vistar/shared/fixtures';
import { LayoutDashboard, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useCan, useMe, useSessionStatus } from '@/lib/session/session';
import { Select } from '@/components/leads/primitives/select';
import { EmptyState, ErrorState } from '@/components/leads/states';
import { CallsPerHourChart, FunnelChart, SourcesChart } from './charts';
import { KpiCard } from './kpi-card';
import { Leaderboard } from './leaderboard';
import { applyEvents, initLive, type LiveState } from './live';
import { LiveFeed } from './live-feed';
import {
  buildDashboard,
  RANGE_LABEL,
  teamsFor,
  visibleUserIds,
  type DashboardRange,
} from './mock-dashboard';
import { NeedsAttention } from './needs-attention';
import { Panel } from './panel';
import { Segmented } from './segmented';

const TICK_MS = 2000;
const ALL_TEAMS = '__all';
const RANGES: ReadonlyArray<{ value: DashboardRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

const pct = (n: number) => `${Math.round(n)}%`;
const pct1 = (n: number) => `${n.toFixed(1)}%`;
const inrCompact = (n: number) => formatInr(Math.round(n), { compact: true });
const num = (n: number) => formatNumber(Math.round(n));
const seconds = (n: number) => {
  const s = Math.round(n);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

/** Company dashboard (/app). Mock data + a local event simulator until the realtime stream lands. */
export function DashboardPage() {
  const status = useSessionStatus();
  const me = useMe();
  const canRead = useCan('dashboard.read');
  if (status === 'loading' || (status === 'authenticated' && !me)) return <DashboardSkeleton />;
  if (!me)
    return (
      <EmptyState
        title="Sign in to see the dashboard"
        description="Your session ended. Sign in again to continue."
      />
    );
  if (!canRead)
    return (
      <EmptyState
        icon={<LayoutDashboard aria-hidden />}
        title="The dashboard is not part of your role"
        description="Ask a company admin for dashboard access, or open your leads instead."
      />
    );
  return <Dashboard me={me} />;
}

function Dashboard({ me }: { me: MeResponse }) {
  const teams = teamsFor(me);
  const [range, setRange] = useState<DashboardRange>('today');
  const [teamId, setTeamId] = useState<string | null>(
    me.role.dataScope === 'all' ? null : (teams[0]?.id ?? null),
  );
  const [paused, setPaused] = useState(false);

  const query = useQuery({
    queryKey: ['dashboard', 'summary', { range, teamId, user: me.user.id }],
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 450));
      return buildDashboard(me, range, teamId);
    },
    staleTime: 30_000,
  });

  const scopeLabel = teamId
    ? (teams.find((t) => t.id === teamId)?.name ?? 'Your team')
    : 'All teams';

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pt-4 pb-8 md:px-6 md:pt-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-strong">
            {me.workspace.name} · {scopeLabel} · {RANGE_LABEL[range]}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented label="Date range" value={range} options={RANGES} onChange={setRange} />
          {me.role.dataScope === 'all' ? (
            <Select
              aria-label="Team"
              className="w-40"
              value={teamId ?? ALL_TEAMS}
              onValueChange={(v) => setTeamId(v === ALL_TEAMS ? null : v)}
              options={[
                { value: ALL_TEAMS, label: 'All teams' },
                ...teams.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          ) : (
            <span className="inline-flex h-8 items-center rounded-md border border-border bg-surface px-2.5 text-sm text-fg-secondary">
              {scopeLabel}
            </span>
          )}
          <Button
            aria-pressed={!paused}
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Resume live updates' : 'Pause live updates'}
            title={paused ? 'Resume live updates' : 'Pause live updates'}
          >
            {paused ? (
              <Play aria-hidden />
            ) : (
              <span aria-hidden className="relative inline-flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
                <span className="relative size-2 rounded-full bg-success" />
              </span>
            )}
            <span className="hidden sm:inline">{paused ? 'Paused' : 'Live'}</span>
            {!paused && <Pause aria-hidden className="hidden text-muted sm:inline" />}
          </Button>
        </div>
      </header>

      {query.isPending ? (
        <DashboardSkeleton bare />
      ) : query.isError || !query.data ? (
        <Card>
          <ErrorState
            title="Dashboard did not load"
            onRetry={() => void query.refetch()}
            retrying={query.isRefetching}
          />
        </Card>
      ) : (
        <LiveDashboard
          key={`${range}:${teamId ?? 'all'}:${query.dataUpdatedAt}`}
          initial={query.data}
          visible={visibleUserIds(me, teamId)}
          paused={paused}
          range={range}
          refreshing={query.isFetching}
        />
      )}
    </div>
  );
}

function LiveDashboard({
  initial,
  visible,
  paused,
  range,
  refreshing,
}: {
  initial: Parameters<typeof initLive>[0];
  visible: Set<string> | null;
  paused: boolean;
  range: DashboardRange;
  refreshing: boolean;
}) {
  const [state, dispatch] = useReducer(
    (s: LiveState, events: Parameters<typeof applyEvents>[1]) => applyEvents(s, events, visible),
    initial,
    initLive,
  );
  const [sim] = useState(() => createEventSimulator({ seed: 99 }));

  // Simulated realtime stream (Wave 1). Skips ticks while paused or the tab is hidden.
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      dispatch(sim.next());
    }, TICK_MS);
    return () => clearInterval(id);
  }, [paused, sim]);

  const { kpis, funnel, sources, callsPerHour, leaderboard, feed, attention } = state.summary;
  const callsLabel = range === 'today' ? 'Calls today' : 'Calls';
  const kpiCards = useMemo(
    () => [
      {
        key: 'newLeads',
        label: 'New leads',
        kpi: kpis.newLeads,
        format: num,
        series: 'chart-1' as const,
      },
      {
        key: 'calls',
        label: callsLabel,
        kpi: kpis.callsToday,
        format: num,
        series: 'chart-2' as const,
      },
      {
        key: 'answered',
        label: 'Answered',
        kpi: kpis.answeredPct,
        format: pct,
        series: 'chart-3' as const,
      },
      {
        key: 'conversion',
        label: 'Conversion',
        kpi: kpis.conversionPct,
        format: pct1,
        series: 'chart-4' as const,
      },
      {
        key: 'revenue',
        label: 'Revenue won',
        kpi: kpis.revenueInr,
        format: inrCompact,
        series: 'chart-1' as const,
      },
      {
        key: 'response',
        label: 'Avg response',
        kpi: kpis.avgResponseSec,
        format: seconds,
        series: 'chart-6' as const,
        lowerIsBetter: true,
      },
    ],
    [kpis, callsLabel],
  );

  return (
    <div
      className={cn(
        'flex flex-col gap-4 transition-opacity duration-150',
        refreshing && 'opacity-80',
      )}
    >
      <section
        aria-label="Key numbers"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        {kpiCards.map((k) => (
          <KpiCard
            key={k.key}
            label={k.label}
            kpi={k.kpi}
            format={k.format}
            series={k.series}
            lowerIsBetter={k.lowerIsBetter}
          />
        ))}
      </section>

      {/* Below xl the column wrappers dissolve (contents) so panels can be ordered for small screens. */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="contents xl:col-span-2 xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
          <Panel
            title="Funnel by stage"
            description="Leads that reached each stage, with deal value"
            className="order-2 xl:order-none"
          >
            {() => <FunnelChart funnel={funnel} />}
          </Panel>
          <Panel
            title="Calls per hour"
            description="Answered and missed, workspace time"
            className="order-3 xl:order-none"
          >
            {() => <CallsPerHourChart data={callsPerHour} />}
          </Panel>
          <div className="order-5 grid gap-4 lg:grid-cols-2 xl:order-none">
            <Panel title="Leaderboard" description="Won deal value this period">
              {() => <Leaderboard entries={leaderboard} />}
            </Panel>
            <Panel title="Leads by source" description="New leads this period">
              {() => <SourcesChart sources={sources} />}
            </Panel>
          </div>
        </div>
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
          <Panel
            title="Needs attention"
            description="Act on these first"
            className="order-1 xl:order-none"
          >
            {() => <NeedsAttention items={attention} />}
          </Panel>
          <Panel
            title="Live activity"
            description={paused ? 'Paused' : 'Updates as it happens'}
            className="order-4 xl:order-none xl:flex-1"
          >
            {() => (
              <div className="max-h-[640px] overflow-y-auto">
                <LiveFeed items={feed} fresh={state.fresh} />
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton({ bare = false }: { bare?: boolean }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading dashboard"
      className={cn('flex flex-col gap-4', !bare && 'px-4 pt-4 md:px-6 md:pt-5')}
    >
      {!bare && (
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="ml-auto h-8 w-64" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[118px] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-64 rounded-lg xl:col-span-2" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg xl:col-span-2" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}
