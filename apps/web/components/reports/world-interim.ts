import type { Call, Conversation, DataScope, LeadSource, MeResponse, Message, Page, RoleKind, Task, UserSummary } from '@vistar/shared';
import {
  createWorldContext,
  DAY_MS,
  EMPLOYEE_FIXTURES,
  istDayStart,
  istMonthStart,
  istPeriod,
  leadStory,
  WORKFLOW_FIXTURE_IDS,
  WORKFLOW_FIXTURE_NAMES,
  wonAt,
  worldCalls,
  worldIndexes,
  worldInbox,
  worldTargets,
  worldTasks,
  worldWorkflowStats,
  type MockTarget,
  type WorkflowRunStats,
  type WorldContext,
} from '@vistar/shared/fixtures';
import { useSessionStore } from '@/lib/session/session';

/**
 * INTERIM (until `@/lib/world` lands on agent/frontend-app): the subset of the world readers the
 * Tasks, Calls, Inbox, Team, Targets and Reports pages use, with the same names and signatures as
 * `@/lib/world`, so the switch is an import change. Delete this file after the rebase.
 */
let ctx: WorldContext | null = null;
export function worldContext(): WorldContext {
  if (!ctx) ctx = createWorldContext({ now: Date.now() });
  return ctx;
}
const world = {
  tasks: () => worldTasks(worldContext()),
  calls: () => worldCalls(worldContext()),
  inbox: () => worldInbox(worldContext()),
  indexes: () => worldIndexes(worldContext()),
  targets: () => worldTargets(worldContext()),
  runStats: () => worldWorkflowStats(worldContext()),
};

export interface Viewer {
  userId: string | null;
  kind: RoleKind | null;
  dataScope: DataScope;
  visible: ReadonlySet<string> | null;
  permissions: readonly string[];
  contentHidden: boolean;
}
const NOBODY: Viewer = { userId: null, kind: null, dataScope: 'own', visible: new Set(), permissions: [], contentHidden: true };

export function viewerFromMe(me: MeResponse | null | undefined): Viewer {
  if (!me) return NOBODY;
  const scope = me.role.dataScope;
  const visible = scope === 'all' ? null : scope === 'own' ? new Set([me.user.id]) : new Set([me.user.id, ...me.teamMemberIds]);
  return { userId: me.user.id, kind: me.role.kind, dataScope: scope, visible, permissions: me.permissions, contentHidden: !!me.impersonation && !me.impersonation.contentAccess };
}
export function currentViewer(): Viewer {
  const s = useSessionStore.getState().session;
  return s?.audience === 'workspace' ? viewerFromMe(s.me) : NOBODY;
}
export const canSee = (v: Viewer, ownerId: string | null | undefined) => v.visible === null || (!!ownerId && v.visible.has(ownerId));

function pageOf<T>(rows: readonly T[], cursor?: string | null, limit = 50): Page<T> {
  const start = Math.max(0, Number(cursor) || 0);
  return { items: rows.slice(start, start + limit), nextCursor: start + limit < rows.length ? String(start + limit) : null, total: rows.length };
}

export interface TaskQuery {
  scope?: 'mine' | 'team';
  limit?: number;
}
export function listTasks(q: TaskQuery = {}, v: Viewer = currentViewer()): Page<Task> {
  const rows = world.tasks().filter((t) => (q.scope === 'team' ? canSee(v, t.assignee?.id) : t.assignee?.id === v.userId));
  return pageOf(rows, null, q.limit ?? 50);
}

export interface CallQuery {
  from?: string;
  to?: string;
  limit?: number;
}
export function listCalls(q: CallQuery = {}, v: Viewer = currentViewer()): Page<Call> {
  const rows = world.calls().filter((c) => canSee(v, c.user?.id) && (!q.from || c.startedAt >= q.from) && (!q.to || c.startedAt <= q.to));
  return pageOf(rows, null, q.limit ?? 50);
}

const HIDDEN = 'Message hidden during the support session';
export interface ConversationQuery {
  limit?: number;
}
export function listConversations(q: ConversationQuery = {}, v: Viewer = currentViewer()): Page<Conversation> {
  const rows = world
    .inbox()
    .conversations.filter((c) => canSee(v, c.assignee?.id))
    .map((c) => (v.contentHidden ? { ...c, lastMessagePreview: HIDDEN } : c));
  return pageOf(rows, null, q.limit ?? 50);
}
export function listMessages(conversationId: string, v: Viewer = currentViewer()): Message[] {
  const c = world.inbox().conversations.find((x) => x.id === conversationId);
  if (!c || !canSee(v, c.assignee?.id)) throw new Error('NOT_FOUND');
  const msgs = world.inbox().messagesByConversation.get(conversationId) ?? [];
  return v.contentHidden ? msgs.map((m) => ({ ...m, body: m.body === null ? null : HIDDEN, media: null })) : msgs;
}

export interface TeamMemberRow {
  user: UserSummary;
  email: string;
  phone: string;
  title: string;
  teamId: string | null;
  teamName: string | null;
  isManager: boolean;
  stats: { callsToday: number; talkSecToday: number; openLeads: number; openTasks: number; overdueTasks: number; wonInrThisMonth: number; dealsWonThisMonth: number };
  targetPct: number | null;
}
export function listTeamMembers(v: Viewer = currentViewer(), now = Date.now()): TeamMemberRow[] {
  const c = worldContext();
  const ix = world.indexes();
  const dayStart = istDayStart(now);
  const monthStart = istMonthStart(now);
  const period = istPeriod(now);
  const revenueTarget = new Map(world.targets().filter((t) => t.subjectType === 'user' && t.metric === 'revenue_inr' && t.period === period).map((t) => [t.subjectId, t]));
  return c.users
    .filter((u) => canSee(v, u.id))
    .map((u, i) => {
      const fx = EMPLOYEE_FIXTURES.find((e) => e.name === u.name) ?? EMPLOYEE_FIXTURES[i]!;
      const team = c.teams.find((t) => t.memberIds.includes(u.id)) ?? null;
      const calls = (ix.callsByUser.get(u.id) ?? []).filter((x) => Date.parse(x.startedAt) >= dayStart && x.status !== 'in_progress');
      const tasks = (ix.tasksByAssignee.get(u.id) ?? []).filter((t) => t.status === 'open');
      const leads = c.leadsByOwner.get(u.id) ?? [];
      let wonInr = 0;
      let deals = 0;
      for (const l of leads) {
        const w = wonAt(c, l);
        if (w !== null && w >= monthStart && w <= now) {
          wonInr += l.valueInr;
          deals++;
        }
      }
      const target = revenueTarget.get(u.id);
      return {
        user: u,
        email: fx.email,
        phone: fx.phone,
        title: fx.title,
        teamId: team?.id ?? null,
        teamName: team?.name ?? null,
        isManager: !!team && team.managerId === u.id,
        stats: {
          callsToday: calls.length,
          talkSecToday: calls.reduce((s, x) => s + x.durationSec, 0),
          openLeads: leads.filter((l) => c.stageById.get(l.stageId)?.type === 'open').length,
          openTasks: tasks.length,
          overdueTasks: tasks.filter((t) => t.dueAt !== null && Date.parse(t.dueAt) < now).length,
          wonInrThisMonth: wonInr,
          dealsWonThisMonth: deals,
        },
        targetPct: target && target.target > 0 ? Math.round((target.achieved / target.target) * 100) : null,
      };
    });
}

export function listTargets(period?: string, v: Viewer = currentViewer()): MockTarget[] {
  const c = worldContext();
  const teamVisible = new Set(c.teams.filter((t) => v.visible === null || (v.dataScope === 'team' && t.memberIds.every((id) => v.visible!.has(id)))).map((t) => t.id));
  return world.targets().filter((t) => (!period || t.period === period) && (t.subjectType === 'user' ? canSee(v, t.subjectId) : teamVisible.has(t.subjectId)));
}

export interface ReportSummary {
  range: { from: string; to: string };
  funnel: Array<{ stageId: string; name: string; count: number; valueInr: number }>;
  sources: Array<{ source: LeadSource; leads: number; won: number; wonValueInr: number; conversionPct: number }>;
  reps: Array<{ user: UserSummary; leads: number; calls: number; answeredPct: number; won: number; revenueInr: number; avgResponseMin: number | null }>;
  responseSla: { within5Min: number; within30Min: number; later: number; untouched: number };
  callsByDay: Array<{ date: string; answered: number; missed: number }>;
  workflows: Array<{ workflowId: string; name: string; runs: number; completed: number; failed: number; active: number }>;
  forecastInr: number;
}

export function reportSummary(from: number, to: number, v: Viewer = currentViewer()): ReportSummary {
  const c = worldContext();
  const leads = c.leads.filter((l) => (v.visible === null || (l.owner && v.visible.has(l.owner.id))) && Date.parse(l.createdAt) >= from && Date.parse(l.createdAt) < to);
  const allScoped = c.leads.filter((l) => v.visible === null || (l.owner && v.visible.has(l.owner.id)));
  const order = new Map(c.stages.map((s, i) => [s.id, i]));
  const funnel = c.stages
    .filter((s) => s.type !== 'lost')
    .map((s) => {
      const idx = order.get(s.id)!;
      const reached = leads.filter((l) => leadStory(c, l).stagePath.some((p) => (order.get(p.stageId) ?? -1) >= idx && c.stageById.get(p.stageId)?.type !== 'lost'));
      return { stageId: s.id, name: s.name, count: reached.length, valueInr: reached.reduce((a, l) => a + l.valueInr, 0) };
    });
  const sourcesMap = new Map<LeadSource, { leads: number; won: number; wonValueInr: number }>();
  for (const l of leads) {
    const row = sourcesMap.get(l.source) ?? { leads: 0, won: 0, wonValueInr: 0 };
    row.leads++;
    if (wonAt(c, l) !== null) {
      row.won++;
      row.wonValueInr += l.valueInr;
    }
    sourcesMap.set(l.source, row);
  }
  const calls = world.calls().filter((x) => canSee(v, x.user?.id) && Date.parse(x.startedAt) >= from && Date.parse(x.startedAt) < to && x.status !== 'in_progress');
  const reps = c.sellers
    .filter((u) => canSee(v, u.id))
    .map((u) => {
      const mine = leads.filter((l) => l.owner?.id === u.id);
      const myCalls = calls.filter((x) => x.user?.id === u.id);
      const won = allScoped.filter((l) => l.owner?.id === u.id && (wonAt(c, l) ?? -1) >= from && (wonAt(c, l) ?? Infinity) < to);
      const touches = mine.map((l) => leadStory(c, l).firstTouchAt - Date.parse(l.createdAt)).filter((d) => d >= 0);
      return {
        user: u,
        leads: mine.length,
        calls: myCalls.length,
        answeredPct: myCalls.length ? Math.round((myCalls.filter((x) => x.status === 'completed').length / myCalls.length) * 100) : 0,
        won: won.length,
        revenueInr: won.reduce((a, l) => a + l.valueInr, 0),
        avgResponseMin: touches.length ? Math.round(touches.reduce((a, b) => a + b, 0) / touches.length / 60_000) : null,
      };
    })
    .sort((a, b) => b.revenueInr - a.revenueInr);
  const sla = { within5Min: 0, within30Min: 0, later: 0, untouched: 0 };
  for (const l of leads) {
    const d = leadStory(c, l).firstTouchAt - Date.parse(l.createdAt);
    if (leadStory(c, l).firstTouchAt > Date.now()) sla.untouched++;
    else if (d <= 5 * 60_000) sla.within5Min++;
    else if (d <= 30 * 60_000) sla.within30Min++;
    else sla.later++;
  }
  const byDay = new Map<string, { date: string; answered: number; missed: number }>();
  for (const x of calls) {
    const date = new Date(Date.parse(x.startedAt) + 330 * 60_000).toISOString().slice(0, 10);
    const row = byDay.get(date) ?? { date, answered: 0, missed: 0 };
    if (x.status === 'completed') row.answered++;
    else row.missed++;
    byDay.set(date, row);
  }
  const stats = world.runStats();
  const workflows = Object.values(WORKFLOW_FIXTURE_IDS).map((id) => {
    const s: WorkflowRunStats = stats.get(id) ?? { runs: 0, completed: 0, failed: 0, active: 0, lastRunAt: null };
    return { workflowId: id, name: WORKFLOW_FIXTURE_NAMES.get(id) ?? 'Workflow', runs: s.runs, completed: s.completed, failed: s.failed, active: s.active };
  });
  const forecastInr = Math.round(allScoped.reduce((a, l) => a + (c.stageById.get(l.stageId)?.type === 'open' ? (l.valueInr * (c.stageById.get(l.stageId)?.probability ?? 0)) / 100 : 0), 0));
  return {
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    funnel,
    sources: [...sourcesMap.entries()].map(([source, r]) => ({ source, ...r, conversionPct: r.leads ? Math.round((r.won / r.leads) * 1000) / 10 : 0 })).sort((a, b) => b.leads - a.leads),
    reps,
    responseSla: sla,
    callsByDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    workflows,
    forecastInr,
  };
}

export { DAY_MS };
