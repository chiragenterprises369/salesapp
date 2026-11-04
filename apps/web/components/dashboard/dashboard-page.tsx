'use client';

import { useQuery } from '@tanstack/react-query';
import { formatInr, formatNumber, type MeResponse } from '@vistar/shared';
import { createEventSimulator, DAY_MS, istDayStart } from '@vistar/shared/fixtures';
import { LayoutDashboard, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { animatePageEntrance } from '@/lib/rivet-motion';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';
import { useTeams } from '@/lib/api/directory';
import { useCan, useMe, useSessionStatus } from '@/lib/session/session';
import { Select } from '@/components/leads/primitives/select';
import { EmptyState, ErrorState } from '@/components/leads/states';
import { useLeadWords } from '@/components/leads/use-lead-words';
import { WidgetSlot } from '@/lib/packs';
import { CallsPerHourChart, FunnelChart, SourcesChart } from './charts';
import { KpiCard } from './kpi-card';
import { Leaderboard } from './leaderboard';
import { applyEvents, initLive, type LiveState } from './live';
import { LiveFeed } from './live-feed';
import {
  buildDashboard,
  RANGE_DAYS,
  RANGE_LABEL,
  teamsFor,
  visibleUserIds,
  type DashboardRange,
} from './mock-dashboard';
import { NeedsAttention } from './needs-attention';
import { Panel } from './panel';
import { Segmented } from './segmented';
import { SetupBanner } from '@/components/setup/setup-banner';

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

/**
 * Company dashboard (/app): GET /dashboard/summary (data scope applied by the API), refreshed by
 * realtime events. The test-only mock data mode computes it from the mock world and runs a local
 * event simulator.
 */
export function DashboardPage() {
  const status = useSessionStatus();
  const me = useMe();
  const canRead = useCan('dashboard.read');
  const w = useLeadWords();
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
        description={`Ask a company admin for dashboard access, or open your ${w.leads} instead.`}
      />
    );
  return <Dashboard me={me} />;
}

function useDashboardTeams(me: MeResponse) {
  const mock = isMockData();
  const q = useTeams();
  return useMemo(() => {
    if (mock) return teamsFor(me);
    const all = (q.data ?? []).map((t) => ({ id: t.id, name: t.name, memberIds: t.managerId ? [t.managerId, ...t.memberIds] : t.memberIds }));
    return me.role.dataScope === 'all' ? all : all.filter((t) => t.memberIds.includes(me.user.id));
  }, [mock, me, q.data]);
}

function Dashboard({ me }: { me: MeResponse }) {
  const mock = isMockData();
  const teams = useDashboardTeams(me);
  const [range, setRange] = useState<DashboardRange>('today');
  const [teamId, setTeamId] = useState<string | null>(
    me.role.dataScope === 'all' ? null : (teams[0]?.id ?? null),
  );
  const [paused, setPaused] = useState(false);

  const query = useQuery({
    queryKey: ['dashboard', 'summary', { range, teamId, user: me.user.id }],
    queryFn: async () => {
      if (!mock) {
        const now = Date.now();
        const from = range === 'today' ? istDayStart(now) : now - RANGE_DAYS[range] * DAY_MS;
        return api.call('dashboardSummary', { query: { from: new Date(from).toISOString(), to: new Date(now).toISOString(), ...(teamId ? { teamId } : {}) } });
      }
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
      {/* ---- change #20: config (setup banner until the company setup is complete) */}
      <SetupBanner />
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 my-2">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-faint mb-1 tracking-wide uppercase">
            {me.workspace.name} · {scopeLabel} · {RANGE_LABEL[range]}
          </p>
          <h1 className="text-3xl lg:text-[34px] font-bold tracking-tight text-ink leading-tight">
            {`Good morning, ${me.user.name.split(' ')[0] || 'User'}`}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Date range" value={range} options={RANGES} onChange={setRange} />
          {me.role.dataScope === 'all' ? (
            <Select
              aria-label="Team"
              className="w-36 h-9 text-xs rounded-[10px] border-hair bg-card font-semibold"
              value={teamId ?? ALL_TEAMS}
              onValueChange={(v) => setTeamId(v === ALL_TEAMS ? null : v)}
              options={[
                { value: ALL_TEAMS, label: 'All teams' },
                ...teams.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          ) : (
            <span className="inline-flex h-9 items-center rounded-[10px] border border-hair bg-card px-3 text-xs font-semibold text-dim">
              {scopeLabel}
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={!paused}
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Resume live updates' : 'Pause live updates'}
            title={paused ? 'Resume live updates' : 'Pause live updates'}
            className="h-9 px-3 rounded-[10px] font-semibold gap-2"
          >
            {paused ? (
              <Play aria-hidden className="size-3.5" />
            ) : (
              <span aria-hidden className="relative inline-flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
                <span className="relative size-2 rounded-full bg-accent" />
              </span>
            )}
            <span className="hidden sm:inline">{paused ? 'Paused' : 'Live'}</span>
            {!paused && <Pause aria-hidden className="hidden size-3.5 text-faint sm:inline" />}
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
          visible={mock ? visibleUserIds(me, teamId) : null}
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
  // Mock data mode only; in API mode realtime events refresh the summary query instead.
  const [sim] = useState(() => (isMockData() ? createEventSimulator({ seed: 99 }) : null));
  const w = useLeadWords();

  // Simulated realtime stream (mock mode). Skips ticks while paused or the tab is hidden.
  useEffect(() => {
    if (paused || !sim) return;
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
        label: `New ${w.leads}`,
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
    [kpis, callsLabel, w.leads],
  );

  const dashboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dashboardRef.current) {
      animatePageEntrance(dashboardRef.current);
    }
  }, []);

  return (
    <div
      ref={dashboardRef}
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
            description={`${w.Leads} that reached each stage, with deal value`}
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
          {/* Industry pack widgets (render nothing when no active pack adds one). */}
          <WidgetSlot
            slot="dashboard.main"
            className="order-3 md:grid-cols-2 xl:order-none md:[&>[data-size=lg]]:col-span-2"
          />
          <div className="order-5 grid gap-4 lg:grid-cols-2 xl:order-none">
            <Panel title="Leaderboard" description="Won deal value this period">
              {() => <Leaderboard entries={leaderboard} />}
            </Panel>
            <Panel title={`${w.Leads} by source`} description={`New ${w.leads} this period`}>
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
          <WidgetSlot slot="dashboard.side" className="order-1 xl:order-none" />
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
