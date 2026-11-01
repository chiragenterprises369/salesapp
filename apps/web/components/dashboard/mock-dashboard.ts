import {
  LEAD_SOURCES,
  type AttentionItem,
  type DashboardSummary,
  type FeedItem,
  type Kpi,
  type MeResponse,
} from '@vistar/shared';
import {
  COMPANY_FIXTURES,
  createRng,
  EMPLOYEE_FIXTURES,
  int,
  mockLeads,
  mockPipeline,
  mockUsers,
  type Rng,
} from '@vistar/shared/fixtures';

/**
 * Deterministic dashboard data for Wave 1 (shape = DashboardSummarySchema). Uses the same mock
 * leads as the Leads page and applies the caller's data scope + team filter, like GET /dashboard.
 */
export type DashboardRange = 'today' | '7d' | '30d';
export const RANGE_DAYS: Record<DashboardRange, number> = { today: 1, '7d': 7, '30d': 30 };
export const RANGE_LABEL: Record<DashboardRange, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

const users = mockUsers();
const pipeline = mockPipeline();
const allLeads = mockLeads(240, 7);

export interface DashboardTeam {
  id: string;
  name: string;
  memberIds: string[];
}

const idByKey = new Map(EMPLOYEE_FIXTURES.map((e, i) => [e.key, users[i]!.id]));
export const DASHBOARD_TEAMS: DashboardTeam[] = COMPANY_FIXTURES[0]!.teams.map((t, i) => ({
  id: `0190f5a0-0000-7000-8000-4000000000${i}0`,
  name: t.name,
  memberIds: [t.managerKey, ...t.memberKeys]
    .map((k) => idByKey.get(k))
    .filter((x): x is string => !!x),
}));

/** User ids whose data the caller may see (data scope), narrowed by an optional team. Null = everyone. */
export function visibleUserIds(me: MeResponse, teamId: string | null): Set<string> | null {
  let ids: Set<string> | null = null;
  if (me.role.dataScope === 'own') ids = new Set([me.user.id]);
  else if (me.role.dataScope === 'team') ids = new Set([me.user.id, ...me.teamMemberIds]);
  const team = teamId ? DASHBOARD_TEAMS.find((t) => t.id === teamId) : null;
  if (team) ids = new Set([...(ids ?? team.memberIds)].filter((id) => team.memberIds.includes(id)));
  return ids;
}

/** Teams the caller can filter by (managers only see their own team). */
export function teamsFor(me: MeResponse): DashboardTeam[] {
  if (me.role.dataScope === 'all') return DASHBOARD_TEAMS;
  return DASHBOARD_TEAMS.filter((t) => t.memberIds.includes(me.user.id));
}

const seeded = (key: string) => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return createRng(h >>> 0);
};

function spark(rng: Rng, end: number, n = 12, jitter = 0.25): number[] {
  const out: number[] = [];
  let v = end * (0.7 + rng() * 0.2);
  for (let i = 0; i < n - 1; i++) {
    out.push(Math.max(0, Math.round(v)));
    v = v + (end - v) / (n - i) + (rng() - 0.5) * jitter * Math.max(1, end);
  }
  out.push(Math.round(end));
  return out;
}

const kpi = (value: number, previous: number, sparkline: number[]): Kpi => ({
  value,
  previous,
  sparkline,
});

export function buildDashboard(
  me: MeResponse,
  range: DashboardRange,
  teamId: string | null,
  now = Date.now(),
): DashboardSummary {
  const ids = visibleUserIds(me, teamId);
  const scoped = ids === null ? allLeads : allLeads.filter((l) => !!l.owner && ids.has(l.owner.id));
  const from = now - RANGE_DAYS[range] * 86_400_000;
  const inRange = scoped.filter((l) => new Date(l.createdAt).getTime() >= from);
  const people = users.filter(
    (u) => (u.role === 'employee' || u.role === 'manager') && (ids === null || ids.has(u.id)),
  );
  const rng = seeded(`${me.user.id}:${range}:${teamId ?? 'all'}`);
  const days = RANGE_DAYS[range];

  const wonStage = pipeline.stages.find((s) => s.type === 'won')!;
  const lostStage = pipeline.stages.find((s) => s.type === 'lost')!;
  const won = scoped.filter((l) => l.stageId === wonStage.id);
  const closed = scoped.filter((l) => l.stageId === wonStage.id || l.stageId === lostStage.id);
  const revenue =
    won.reduce((s, l) => s + l.valueInr, 0) *
    (range === 'today' ? 0.08 : range === '7d' ? 0.35 : 1);

  const callsPerPerson = people.map((u) => ({
    user: u,
    calls: Math.round(int(seeded(`${u.id}:calls`), 8, 38) * days * (range === 'today' ? 1 : 0.8)),
  }));
  const calls = callsPerPerson.reduce((s, c) => s + c.calls, 0);
  const answered = Math.round(calls * (0.62 + rng() * 0.16));
  const conversion = closed.length ? (won.length / closed.length) * 100 : 0;
  const response = int(rng, 140, 720);

  const kpis: DashboardSummary['kpis'] = {
    newLeads: kpi(
      inRange.length,
      Math.max(0, Math.round(inRange.length * (0.75 + rng() * 0.4))),
      spark(rng, inRange.length),
    ),
    callsToday: kpi(calls, Math.round(calls * (0.8 + rng() * 0.3)), spark(rng, calls)),
    answeredPct: kpi(
      calls ? Math.round((answered / calls) * 100) : 0,
      int(rng, 55, 80),
      spark(rng, calls ? (answered / calls) * 100 : 0, 12, 0.08),
    ),
    conversionPct: kpi(
      Math.round(conversion * 10) / 10,
      Math.round(conversion * (0.8 + rng() * 0.3) * 10) / 10,
      spark(rng, conversion, 12, 0.1),
    ),
    revenueInr: kpi(
      Math.round(revenue),
      Math.round(revenue * (0.7 + rng() * 0.5)),
      spark(rng, revenue),
    ),
    avgResponseSec: kpi(response, int(rng, 160, 900), spark(rng, response, 12, 0.15)),
  };

  const funnelBase = range === 'today' ? scoped : inRange.length >= 6 ? inRange : scoped;
  const funnel = pipeline.stages
    .filter((s) => s.type !== 'lost')
    .map((s, i, open) => {
      // Funnel = leads that reached at least this stage.
      const reached = funnelBase.filter((l) => {
        const idx = open.findIndex((o) => o.id === l.stageId);
        return idx >= i || (l.stageId === lostStage.id && i <= 1);
      });
      return {
        stageId: s.id,
        name: s.name,
        count: reached.length,
        valueInr: reached.reduce((a, l) => a + l.valueInr, 0),
      };
    });

  const sources = LEAD_SOURCES.map((source) => ({
    source,
    count: inRange.filter((l) => l.source === source).length,
    wonValueInr: won.filter((l) => l.source === source).reduce((a, l) => a + l.valueInr, 0),
  })).filter((s) => s.count > 0);

  const nowHour = new Date(now).getHours();
  const callsPerHour = Array.from({ length: 11 }, (_, i) => 9 + i).map((hour) => {
    const r = seeded(`${me.user.id}:${teamId}:${range}:h${hour}`);
    const total =
      hour > nowHour && range === 'today'
        ? 0
        : Math.round(
            int(r, 4, 14) * Math.max(1, people.length / 3) * (range === 'today' ? 1 : days * 0.8),
          );
    const ans = Math.round(total * (0.6 + r() * 0.2));
    return { hour, answered: ans, missed: total - ans };
  });

  const leaderboard = people
    .map((u) => {
      const mine = won.filter((l) => l.owner?.id === u.id);
      const c = callsPerPerson.find((x) => x.user.id === u.id)?.calls ?? 0;
      return {
        user: u,
        rank: 0,
        revenueInr: mine.reduce((a, l) => a + l.valueInr, 0),
        dealsWon: mine.length,
        calls: c,
        targetPct: int(seeded(`${u.id}:target`), 35, 125),
      };
    })
    .sort((a, b) => b.revenueInr - a.revenueInr || b.dealsWon - a.dealsWon)
    .map((e, i) => ({ ...e, rank: i + 1 }));

  const feed: FeedItem[] = scoped
    .slice()
    .sort((a, b) => ((a.lastActivityAt ?? '') < (b.lastActivityAt ?? '') ? 1 : -1))
    .slice(0, 8)
    .map((l, i) => {
      const stage = pipeline.stages.find((s) => s.id === l.stageId);
      const actor = l.owner;
      const at = new Date(
        Math.min(now - (i + 1) * 4 * 60_000, new Date(l.lastActivityAt ?? l.createdAt).getTime()),
      ).toISOString();
      const kind: FeedItem['kind'] =
        i % 3 === 0 ? 'stage_moved' : i % 3 === 1 ? 'call_ended' : 'message_received';
      const text =
        kind === 'stage_moved'
          ? `${actor?.name.split(' ')[0] ?? 'Someone'} moved ${l.name} to ${stage?.name ?? 'a new stage'}`
          : kind === 'call_ended'
            ? `${actor?.name.split(' ')[0] ?? 'Someone'} finished a call with ${l.name}`
            : `${l.name} replied on WhatsApp`;
      return { id: `seed-${l.id}`, kind, text, actor, leadId: l.id, createdAt: at };
    });

  const attention: AttentionItem[] = [];
  if (ids === null) {
    allLeads
      .filter((l) => !l.owner && l.temperature === 'hot')
      .slice(0, 4)
      .forEach((l) =>
        attention.push({
          id: `hot_lead_unassigned:${l.id}`,
          kind: 'hot_lead_unassigned',
          title: `${l.name} is hot and unassigned`,
          subtitle: `${l.companyName ?? 'No company'} · score ${l.score}`,
          href: `/app/leads?lead=${l.id}`,
          leadId: l.id,
          userId: null,
          severity: 'critical',
          createdAt: l.createdAt,
        }),
      );
  }
  scoped
    .filter(
      (l) =>
        l.nextFollowUpAt &&
        new Date(l.nextFollowUpAt).getTime() < now &&
        pipeline.stages.find((s) => s.id === l.stageId)?.type === 'open',
    )
    .slice(0, 5)
    .forEach((l) =>
      attention.push({
        id: `task_overdue:${l.id}`,
        kind: 'task_overdue',
        title: `Follow-up overdue: ${l.name}`,
        subtitle: l.owner ? `Owner ${l.owner.name}` : 'Unassigned',
        href: `/app/leads?lead=${l.id}`,
        leadId: l.id,
        userId: l.owner?.id ?? null,
        severity: 'warning',
        createdAt: l.nextFollowUpAt!,
      }),
    );
  const failedFor = scoped.find((l) => l.source === 'indiamart');
  if (failedFor) {
    attention.push({
      id: `workflow_failed:${failedFor.id}`,
      kind: 'workflow_failed',
      title: 'IndiaMART nurturing failed at "WhatsApp welcome"',
      subtitle: `${failedFor.name}: template indiamart_welcome was rejected (no opt-in)`,
      href: '/app/workflows',
      leadId: failedFor.id,
      userId: null,
      severity: 'critical',
      createdAt: new Date(now - 42 * 60_000).toISOString(),
    });
  }

  return {
    kpis,
    funnel,
    sources,
    callsPerHour,
    leaderboard,
    feed,
    attention,
    generatedAt: new Date(now).toISOString(),
  };
}
