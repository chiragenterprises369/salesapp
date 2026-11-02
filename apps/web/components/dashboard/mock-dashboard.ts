import {
  formatDuration,
  LEAD_SOURCES,
  type AttentionItem,
  type Call,
  type DashboardSummary,
  type FeedItem,
  type Kpi,
  type LeadListItem,
  type MeResponse,
} from '@vistar/shared';
import {
  DAY_MS,
  istDayStart,
  istHour,
  istPeriod,
  leadStory,
  mockTeams,
  WORKFLOW_FIXTURE_KEYS,
} from '@vistar/shared/fixtures';
import { currentMockLeads } from '@/lib/leads/mock-source';
import { world, worldContext } from '@/lib/world/world';

/**
 * Dashboard data for Wave 1 (shape = DashboardSummarySchema), computed from the mock world: the
 * 2,500 leads of the Leads page (including edits made in this tab), the world's calls, tasks, chats
 * and workflow runs. Applies the caller's data scope + team filter, like GET /dashboard. Results are
 * memoised per scope, range, team and minute, so switching filters back and forth is instant.
 */
export type DashboardRange = 'today' | '7d' | '30d';
export const RANGE_DAYS: Record<DashboardRange, number> = { today: 1, '7d': 7, '30d': 30 };
export const RANGE_LABEL: Record<DashboardRange, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export interface DashboardTeam {
  id: string;
  name: string;
  memberIds: string[];
}

export const DASHBOARD_TEAMS: DashboardTeam[] = mockTeams().map((t) => ({
  id: t.id,
  name: t.name,
  memberIds: t.memberIds,
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

const BUCKETS = 12;
const first = (name: string | null | undefined) => (name ?? 'Someone').split(' ')[0];
const ts = (iso: string) => Date.parse(iso);

/** Cumulative series over 12 buckets of [from, now] (last point = the KPI value). */
function cumulative(times: number[], from: number, now: number, weights?: number[]): number[] {
  const out = new Array<number>(BUCKETS).fill(0);
  const size = Math.max(1, (now - from) / BUCKETS);
  times.forEach((t, i) => {
    const b = Math.min(BUCKETS - 1, Math.max(0, Math.floor((t - from) / size)));
    out[b]! += weights ? weights[i]! : 1;
  });
  for (let i = 1; i < BUCKETS; i++) out[i]! += out[i - 1]!;
  return out.map((v) => Math.round(v));
}

/** Running ratio (percent) over 12 buckets. */
function runningPct(events: Array<{ t: number; hit: boolean }>, from: number, now: number): number[] {
  const hits = cumulative(events.filter((e) => e.hit).map((e) => e.t), from, now);
  const all = cumulative(events.map((e) => e.t), from, now);
  return all.map((n, i) => (n ? Math.round((hits[i]! / n) * 1000) / 10 : 0));
}

const kpi = (value: number, previous: number, sparkline: number[]): Kpi => ({ value, previous, sparkline });

const memo = new WeakMap<LeadListItem[], Map<string, DashboardSummary>>();

export function buildDashboard(me: MeResponse, range: DashboardRange, teamId: string | null, now = Date.now()): DashboardSummary {
  const leads = currentMockLeads();
  const key = `${me.user.id}:${me.role.dataScope}:${range}:${teamId ?? 'all'}:${Math.floor(now / 60_000)}`;
  let byKey = memo.get(leads);
  if (!byKey) memo.set(leads, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  // World sections the dashboard reads are generated once per page load; measured apart from the compute.
  const warm = performance.now();
  world.calls();
  world.tasks();
  world.inbox();
  world.runs();
  world.targets();
  const started = performance.now();
  if (started - warm > 1 && typeof performance.measure === 'function') performance.measure('vistar:world', { start: warm, end: started });
  const summary = compute(me, range, teamId, now, leads);
  // Readable in devtools / e2e: performance.getEntriesByName('vistar:dashboard') (target: under 50 ms).
  if (typeof performance.measure === 'function') performance.measure('vistar:dashboard', { start: started, end: performance.now(), detail: { range, teamId } });
  if (byKey.size > 40) byKey.clear();
  byKey.set(key, summary);
  return summary;
}

function compute(me: MeResponse, range: DashboardRange, teamId: string | null, now: number, leads: LeadListItem[]): DashboardSummary {
  const ctx = worldContext();
  const ids = visibleUserIds(me, teamId);
  const inScope = (userId: string | null | undefined) => ids === null || (!!userId && ids.has(userId));
  const from = range === 'today' ? istDayStart(now) : now - RANGE_DAYS[range] * DAY_MS;
  const prevFrom = from - (now - from);
  const stages = ctx.stages;
  const stageType = new Map(stages.map((s) => [s.id, s.type]));
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const scoped = ids === null ? leads : leads.filter((l) => !!l.owner && ids.has(l.owner.id));
  const closedAt = (l: LeadListItem) => (stageType.get(l.stageId) === 'open' ? null : (leadStory(ctx, l).closedAt ?? ts(l.updatedAt)));
  const created = (l: LeadListItem) => ts(l.createdAt);

  const inRange = scoped.filter((l) => created(l) >= from && created(l) <= now);
  const inPrev = scoped.filter((l) => created(l) >= prevFrom && created(l) < from);
  const closedIn = (lo: number, hi: number) => scoped.filter((l) => {
    const c = closedAt(l);
    return c !== null && c >= lo && c < hi;
  });
  const closed = closedIn(from, now + 1);
  const closedPrev = closedIn(prevFrom, from);
  const won = closed.filter((l) => stageType.get(l.stageId) === 'won');
  const wonPrev = closedPrev.filter((l) => stageType.get(l.stageId) === 'won');

  const calls = world.calls().filter((c) => inScope(c.user?.id));
  const callsIn = calls.filter((c) => ts(c.startedAt) >= from && ts(c.startedAt) <= now);
  const callsPrev = calls.filter((c) => ts(c.startedAt) >= prevFrom && ts(c.startedAt) < from);
  const ended = (list: Call[]) => list.filter((c) => c.status !== 'in_progress');
  const answeredShare = (list: Call[]) => {
    const e = ended(list);
    return e.length ? Math.round((e.filter((c) => c.status === 'completed').length / e.length) * 100) : 0;
  };
  const conversion = (list: LeadListItem[]) => {
    const w = list.filter((l) => stageType.get(l.stageId) === 'won').length;
    return list.length ? Math.round((w / list.length) * 1000) / 10 : 0;
  };
  const response = (list: LeadListItem[]) => {
    const d = list.map((l) => leadStory(ctx, l).firstTouchAt - created(l)).filter((x, i) => x >= 0 && leadStory(ctx, list[i]!).firstTouchAt <= now);
    return d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length / 1000) : 0;
  };
  const revenue = (list: LeadListItem[]) => list.reduce((s, l) => s + l.valueInr, 0);

  const kpis: DashboardSummary['kpis'] = {
    newLeads: kpi(inRange.length, inPrev.length, cumulative(inRange.map(created), from, now)),
    callsToday: kpi(callsIn.length, callsPrev.length, cumulative(callsIn.map((c) => ts(c.startedAt)), from, now)),
    answeredPct: kpi(answeredShare(callsIn), answeredShare(callsPrev), runningPct(ended(callsIn).map((c) => ({ t: ts(c.startedAt), hit: c.status === 'completed' })), from, now)),
    conversionPct: kpi(conversion(closed), conversion(closedPrev), runningPct(closed.map((l) => ({ t: closedAt(l)!, hit: stageType.get(l.stageId) === 'won' })), from, now)),
    revenueInr: kpi(revenue(won), revenue(wonPrev), cumulative(won.map((l) => closedAt(l)!), from, now, won.map((l) => l.valueInr))),
    avgResponseSec: kpi(response(inRange), response(inPrev), (() => {
      // Running average response time.
      const sorted = inRange.filter((l) => leadStory(ctx, l).firstTouchAt <= now).sort((a, b) => created(a) - created(b));
      const size = Math.max(1, (now - from) / BUCKETS);
      const out: number[] = [];
      let sum = 0;
      let n = 0;
      let j = 0;
      for (let b = 0; b < BUCKETS; b++) {
        const edge = from + (b + 1) * size;
        while (j < sorted.length && created(sorted[j]!) < edge) {
          sum += leadStory(ctx, sorted[j]!).firstTouchAt - created(sorted[j]!);
          n++;
          j++;
        }
        out.push(n ? Math.round(sum / n / 1000) : 0);
      }
      return out;
    })()),
  };

  // Funnel: leads that reached at least each stage (lost leads count up to where they dropped out).
  const open = stages.filter((s) => s.type !== 'lost');
  const openIndex = new Map(open.map((s, i) => [s.id, i]));
  const reached = (l: LeadListItem) => {
    const idx = openIndex.get(l.stageId);
    if (idx !== undefined) return idx;
    return Math.max(0, ...leadStory(ctx, l).stagePath.map((p) => openIndex.get(p.stageId) ?? 0));
  };
  const funnelBase = range === 'today' ? scoped : inRange.length >= 6 ? inRange : scoped;
  const reachedBy = funnelBase.map(reached);
  const funnel = open.map((s, i) => {
    let count = 0;
    let valueInr = 0;
    funnelBase.forEach((l, j) => {
      if (reachedBy[j]! >= i) {
        count++;
        valueInr += l.valueInr;
      }
    });
    return { stageId: s.id, name: s.name, count, valueInr };
  });

  const sources = LEAD_SOURCES.map((source) => ({
    source,
    count: inRange.filter((l) => l.source === source).length,
    wonValueInr: won.filter((l) => l.source === source).reduce((a, l) => a + l.valueInr, 0),
  })).filter((s) => s.count > 0);

  const perHour = new Map<number, { answered: number; missed: number }>();
  for (const c of ended(callsIn)) {
    const h = istHour(ts(c.startedAt));
    const row = perHour.get(h) ?? { answered: 0, missed: 0 };
    if (c.status === 'completed') row.answered++;
    else row.missed++;
    perHour.set(h, row);
  }
  const callsPerHour = Array.from({ length: 11 }, (_, i) => 9 + i).map((hour) => ({ hour, ...(perHour.get(hour) ?? { answered: 0, missed: 0 }) }));

  const period = istPeriod(now);
  const revenueTarget = new Map(world.targets().filter((t) => t.subjectType === 'user' && t.metric === 'revenue_inr' && t.period === period).map((t) => [t.subjectId, t]));
  const people = ctx.sellers.filter((u) => inScope(u.id));
  const leaderboard = people
    .map((u) => {
      const mine = won.filter((l) => l.owner?.id === u.id);
      const t = revenueTarget.get(u.id);
      return {
        user: u,
        rank: 0,
        revenueInr: revenue(mine),
        dealsWon: mine.length,
        calls: callsIn.filter((c) => c.user?.id === u.id).length,
        targetPct: t && t.target > 0 ? Math.round((t.achieved / t.target) * 100) : null,
      };
    })
    .sort((a, b) => b.revenueInr - a.revenueInr || b.dealsWon - a.dealsWon || b.calls - a.calls)
    .map((e, i) => ({ ...e, rank: i + 1 }));

  const leadHref = (id: string) => `/app/leads?lead=${id}`;
  const feed: FeedItem[] = [];
  const recent = now - 8 * 60 * 60_000;
  for (const c of ended(callsIn).filter((c) => ts(c.startedAt) >= recent).slice(0, 6)) {
    const ok = c.status === 'completed';
    feed.push({
      id: `call:${c.id}`,
      kind: 'call_ended',
      text: ok
        ? `${first(c.user?.name)} finished a ${formatDuration(c.durationSec)} call with ${c.leadName ?? 'a new number'}${c.outcome && c.outcome !== 'answered' ? ` (${c.outcome.replace(/_/g, ' ')})` : ''}`
        : `${first(c.user?.name)} missed a call ${c.direction === 'inbound' ? 'from' : 'with'} ${c.leadName ?? 'a new number'}`,
      actor: c.user,
      leadId: c.leadId,
      createdAt: c.endedAt ?? c.startedAt,
    });
  }
  const newest = [...scoped].filter((l) => created(l) <= now && created(l) >= recent).sort((a, b) => created(b) - created(a));
  for (const l of newest.slice(0, 4)) {
    feed.push(
      l.owner
        ? { id: `assigned:${l.id}`, kind: 'lead_assigned', text: `${l.name} assigned to ${l.owner.name} (round robin)`, actor: l.owner, leadId: l.id, createdAt: new Date(created(l) + 40_000).toISOString() }
        : { id: `created:${l.id}`, kind: 'lead_created', text: `New ${l.source === 'indiamart' ? 'IndiaMART' : l.source} lead: ${l.name}${l.city ? ` from ${l.city}` : ''}`, actor: null, leadId: l.id, createdAt: l.createdAt },
    );
  }
  const moves = scoped
    .map((l) => ({ l, step: leadStory(ctx, l).stagePath.at(-1)! }))
    .filter(({ l, step }) => leadStory(ctx, l).stagePath.length > 1 && step.at <= now && step.at >= recent)
    .sort((a, b) => b.step.at - a.step.at)
    .slice(0, 4);
  for (const { l, step } of moves) {
    feed.push({ id: `moved:${l.id}`, kind: 'stage_moved', text: `${first(l.owner?.name)} moved ${l.companyName ?? l.name} to ${stageName.get(step.stageId) ?? 'a new stage'}`, actor: l.owner, leadId: l.id, createdAt: new Date(step.at).toISOString() });
  }
  const inbox = world.inbox();
  for (const c of inbox.conversations.filter((c) => inScope(c.assignee?.id) && c.lastInboundAt && ts(c.lastInboundAt) >= recent && ts(c.lastInboundAt) <= now).slice(0, 3)) {
    const msg = [...(inbox.messagesByConversation.get(c.id) ?? [])].reverse().find((m) => m.direction === 'inbound');
    feed.push({ id: `message:${c.id}`, kind: 'message_received', text: `${c.contactName} replied on WhatsApp${msg?.body ? `: “${msg.body.slice(0, 60)}”` : ''}`, actor: null, leadId: c.leadId, createdAt: c.lastInboundAt! });
  }
  const doneTasks = world
    .tasks()
    .filter((t) => t.status === 'done' && t.completedAt && ts(t.completedAt) >= recent && ts(t.completedAt) <= now && inScope(t.assignee?.id))
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!))
    .slice(0, 2);
  for (const t of doneTasks) feed.push({ id: `task:${t.id}`, kind: 'task_completed', text: `${first(t.assignee?.name)} completed: ${t.title}`, actor: t.assignee, leadId: t.leadId, createdAt: t.completedAt! });
  const leadOwner = (leadId: string | null) => (leadId ? ctx.leadById.get(leadId)?.owner?.id : null);
  const failedRuns = world
    .runs()
    .filter((r) => r.status === 'failed' && !r.isTest && r.finishedAt && ts(r.finishedAt) <= now && ts(r.finishedAt) >= now - 3 * DAY_MS && (ids === null || inScope(leadOwner(r.leadId))));
  if (failedRuns[0] && ts(failedRuns[0].finishedAt!) >= recent) {
    const r = failedRuns[0];
    feed.push({ id: `run:${r.id}`, kind: 'workflow_failed', text: `Workflow step failed for ${r.leadName ?? 'a lead'}: ${r.error ?? 'see the run'}`, actor: null, leadId: r.leadId, createdAt: r.finishedAt! });
  }
  feed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const attention: AttentionItem[] = [];
  if (ids === null) {
    scoped
      .filter((l) => !l.owner && l.temperature === 'hot' && stageType.get(l.stageId) === 'open')
      .sort((a, b) => created(b) - created(a))
      .slice(0, 3)
      .forEach((l) =>
        attention.push({ id: `hot_lead_unassigned:${l.id}`, kind: 'hot_lead_unassigned', title: `${l.name} is hot and unassigned`, subtitle: `${l.companyName ?? 'No company'} · score ${l.score}`, href: leadHref(l.id), leadId: l.id, userId: null, severity: 'critical', createdAt: l.createdAt }),
      );
  }
  for (const r of failedRuns.slice(0, 2)) {
    attention.push({
      id: `workflow_failed:${r.id}`,
      kind: 'workflow_failed',
      title: `${r.leadName ?? 'A lead'}: workflow step failed`,
      subtitle: r.error,
      href: `/app/workflows/${WORKFLOW_FIXTURE_KEYS.get(r.workflowId) ?? ''}`,
      leadId: r.leadId,
      userId: null,
      severity: 'critical',
      createdAt: r.finishedAt!,
    });
  }
  scoped
    .filter((l) => stageType.get(l.stageId) === 'open' && created(l) < now - 15 * 60_000 && created(l) > now - 6 * 60 * 60_000 && leadStory(ctx, l).firstTouchAt > now)
    .slice(0, 2)
    .forEach((l) =>
      attention.push({ id: `sla_breach:${l.id}`, kind: 'sla_breach', title: `No first response yet: ${l.name}`, subtitle: `Waiting ${Math.round((now - created(l)) / 60_000)} min · ${l.owner ? `Owner ${l.owner.name}` : 'Unassigned'}`, href: leadHref(l.id), leadId: l.id, userId: l.owner?.id ?? null, severity: 'warning', createdAt: l.createdAt }),
    );
  const missed = calls
    .filter((c) => c.direction === 'inbound' && c.status === 'missed' && ts(c.startedAt) >= now - 3 * 60 * 60_000 && ts(c.startedAt) <= now)
    .filter((c) => !calls.some((o) => o.leadId && o.leadId === c.leadId && o.direction === 'outbound' && o.startedAt > c.startedAt))
    .slice(0, 2);
  for (const c of missed) {
    attention.push({ id: `missed_call:${c.id}`, kind: 'missed_call', title: `Missed call from ${c.leadName ?? c.from}`, subtitle: `${c.user ? `${c.user.name} has not called back` : 'Nobody has called back'}`, href: c.leadId ? leadHref(c.leadId) : '/app/calls', leadId: c.leadId, userId: c.user?.id ?? null, severity: 'warning', createdAt: c.startedAt });
  }
  world
    .tasks()
    .filter((t) => t.status === 'open' && t.dueAt && ts(t.dueAt) < now - 15 * 60_000 && inScope(t.assignee?.id))
    .sort((a, b) => b.dueAt!.localeCompare(a.dueAt!))
    .slice(0, Math.max(3, 12 - attention.length))
    .forEach((t) =>
      attention.push({ id: `task_overdue:${t.id}`, kind: 'task_overdue', title: `Overdue: ${t.title}`, subtitle: t.assignee ? `Assigned to ${t.assignee.name}` : null, href: t.leadId ? leadHref(t.leadId) : '/app/tasks', leadId: t.leadId, userId: t.assignee?.id ?? null, severity: 'warning', createdAt: t.dueAt! }),
    );

  return {
    kpis,
    funnel,
    sources,
    callsPerHour,
    leaderboard,
    feed: feed.slice(0, 14),
    attention: attention.slice(0, 12),
    generatedAt: new Date(now).toISOString(),
  };
}
