import type {
  Activity,
  AuditLog,
  Call,
  CallListQuery,
  Conversation,
  ConversationListQuery,
  LeadListItem,
  LeadSource,
  Message,
  Notification,
  Page,
  SavedView,
  Task,
  TaskListQuery,
  TargetMetric,
  UserSummary,
  WorkflowRun,
} from '@vistar/shared';
import {
  DAY_MS,
  EMPLOYEE_FIXTURES,
  istDayStart,
  istHour,
  istMonthStart,
  istPeriod,
  leadStory,
  WORKFLOW_FIXTURE_IDS,
  WORKFLOW_FIXTURE_KEYS,
  WORKFLOW_FIXTURE_NAMES,
  wonAt,
  type MockTarget,
  type WorkflowRunStats,
} from '@vistar/shared/fixtures';
import { ApiRequestError } from '../api-error';
import { readMockDb, updateMockDb } from '../mock-db';
import { canSee, currentViewer, type Viewer } from './scope';
import { world, worldContext } from './world';

/**
 * Read functions over the mock world with the caller's data scope (own / team / all), shaped like
 * the API list routes (`Page<T>` with cursor = offset). Used by the dashboard, Employee panel, lead
 * detail and the bell today, and by the Tasks, Calls, Inbox, Team, Targets, Reports, Integrations,
 * Webhooks and Billing pages next. Hooks over these live in `./hooks.ts`.
 */

export function pageOf<T>(rows: readonly T[], cursor?: string | null, limit = 50): Page<T> {
  const start = Math.max(0, Number(cursor) || 0);
  const items = rows.slice(start, start + limit);
  return { items, nextCursor: start + limit < rows.length ? String(start + limit) : null, total: rows.length };
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);

// ---------------------------------------------------------------- tasks

export type TaskQuery = Partial<Omit<TaskListQuery, 'limit'>> & { limit?: number };

/** GET /tasks: `scope=mine` (default) or `team` (everything the viewer may see). Open tasks by due time first. */
export function listTasks(q: TaskQuery = {}, v: Viewer = currentViewer(), now = Date.now()): Page<Task> {
  const dayStart = istDayStart(now);
  const dayEnd = dayStart + DAY_MS;
  const rows = world
    .tasks()
    .filter((t) => (q.scope === 'team' ? canSee(v, t.assignee?.id) : t.assignee?.id === v.userId))
    .filter((t) => !q.status?.length || q.status.includes(t.status))
    .filter((t) => !q.type?.length || q.type.includes(t.type))
    .filter((t) => !q.leadId || t.leadId === q.leadId)
    .filter((t) => !q.assigneeId || t.assignee?.id === q.assigneeId)
    .filter((t) => !q.from || (t.dueAt !== null && t.dueAt >= q.from))
    .filter((t) => !q.to || (t.dueAt !== null && t.dueAt <= q.to))
    .filter((t) => {
      if (!q.due) return true;
      const due = time(t.dueAt);
      if (q.due === 'none') return t.dueAt === null;
      if (t.status !== 'open' || Number.isNaN(due)) return false;
      if (q.due === 'overdue') return due < now;
      if (q.due === 'today') return due >= dayStart && due < dayEnd;
      return due >= dayEnd;
    })
    .sort((a, b) => {
      if (a.status === 'open' && b.status !== 'open') return -1;
      if (b.status === 'open' && a.status !== 'open') return 1;
      if (a.status === 'open') return (time(a.dueAt) || Infinity) - (time(b.dueAt) || Infinity);
      return (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt);
    });
  return pageOf(rows, q.cursor, q.limit ?? 50);
}

export interface TaskCounts {
  overdue: number;
  today: number;
  upcoming: number;
  doneThisWeek: number;
}

export function taskCounts(scope: 'mine' | 'team' = 'mine', v: Viewer = currentViewer(), now = Date.now()): TaskCounts {
  const dayStart = istDayStart(now);
  const dayEnd = dayStart + DAY_MS;
  const counts: TaskCounts = { overdue: 0, today: 0, upcoming: 0, doneThisWeek: 0 };
  for (const t of world.tasks()) {
    if (scope === 'team' ? !canSee(v, t.assignee?.id) : t.assignee?.id !== v.userId) continue;
    if (t.status === 'done') {
      if (time(t.completedAt) >= now - 7 * DAY_MS) counts.doneThisWeek++;
      continue;
    }
    if (t.status !== 'open' || !t.dueAt) continue;
    const due = time(t.dueAt);
    if (due < now) counts.overdue++;
    else if (due < dayEnd) counts.today++;
    else counts.upcoming++;
  }
  return counts;
}

/** Tasks of one lead (lead detail). The lead itself is scope-checked by the Leads source. */
export function tasksForLead(leadId: string): Task[] {
  return world.indexes().tasksByLead.get(leadId) ?? [];
}

// ---------------------------------------------------------------- calls

export type CallQuery = Partial<Omit<CallListQuery, 'limit'>> & { limit?: number };

/** GET /calls, newest first, scoped on Call.userId. */
export function listCalls(q: CallQuery = {}, v: Viewer = currentViewer()): Page<Call> {
  const source = q.userId ? (world.indexes().callsByUser.get(q.userId) ?? []) : q.leadId ? (world.indexes().callsByLead.get(q.leadId) ?? []) : world.calls();
  const rows = source.filter(
    (c) =>
      canSee(v, c.user?.id) &&
      (!q.leadId || c.leadId === q.leadId) &&
      (!q.status?.length || q.status.includes(c.status)) &&
      (!q.outcome?.length || (c.outcome !== null && q.outcome.includes(c.outcome))) &&
      (!q.from || c.startedAt >= q.from) &&
      (!q.to || c.startedAt <= q.to),
  );
  return pageOf(rows, q.cursor, q.limit ?? 50);
}

export interface CallStats {
  total: number;
  answered: number;
  missed: number;
  talkSec: number;
  avgTalkSec: number;
  /** IST hour -> answered / missed. */
  byHour: Array<{ hour: number; answered: number; missed: number }>;
}

export function callStats(calls: readonly Call[]): CallStats {
  const byHour = new Map<number, { hour: number; answered: number; missed: number }>();
  let answered = 0;
  let talkSec = 0;
  let total = 0;
  for (const c of calls) {
    if (c.status === 'in_progress') continue;
    total++;
    const h = istHour(Date.parse(c.startedAt));
    const row = byHour.get(h) ?? { hour: h, answered: 0, missed: 0 };
    if (c.status === 'completed') {
      answered++;
      talkSec += c.durationSec;
      row.answered++;
    } else row.missed++;
    byHour.set(h, row);
  }
  return { total, answered, missed: total - answered, talkSec, avgTalkSec: answered ? Math.round(talkSec / answered) : 0, byHour: [...byHour.values()].sort((a, b) => a.hour - b.hour) };
}

// ---------------------------------------------------------------- WhatsApp inbox

export type ConversationQuery = Partial<Omit<ConversationListQuery, 'limit'>> & { limit?: number };
const HIDDEN = 'Message hidden during the support session';

function hideConversation(c: Conversation, v: Viewer): Conversation {
  return v.contentHidden ? { ...c, lastMessagePreview: HIDDEN } : c;
}

/** GET /conversations, latest message first, scoped on Conversation.assigneeId. */
export function listConversations(q: ConversationQuery = {}, v: Viewer = currentViewer()): Page<Conversation> {
  const needle = q.q?.toLowerCase().trim();
  const rows = world
    .inbox()
    .conversations.filter((c) => canSee(v, c.assignee?.id))
    .filter((c) => !q.status || c.status === q.status)
    .filter((c) => (q.assigneeId === 'me' ? c.assignee?.id === v.userId : q.assigneeId === 'unassigned' ? c.assignee === null : !q.assigneeId || c.assignee?.id === q.assigneeId))
    .filter((c) => q.unread === undefined || (q.unread ? c.unreadCount > 0 : c.unreadCount === 0))
    .filter((c) => !needle || `${c.contactName} ${c.contactPhone} ${c.lastMessagePreview ?? ''}`.toLowerCase().includes(needle))
    .map((c) => hideConversation(c, v));
  return pageOf(rows, q.cursor, q.limit ?? 50);
}

export function getConversation(id: string, v: Viewer = currentViewer()): Conversation {
  const c = world.inbox().conversations.find((x) => x.id === id);
  if (!c || !canSee(v, c.assignee?.id)) throw new ApiRequestError('NOT_FOUND', 'This conversation does not exist or is not shared with you');
  return hideConversation(c, v);
}

/** GET /conversations/{id}/messages, oldest first. Bodies are hidden in support sessions without content access. */
export function listMessages(conversationId: string, v: Viewer = currentViewer()): Message[] {
  getConversation(conversationId, v);
  const msgs = world.inbox().messagesByConversation.get(conversationId) ?? [];
  return v.contentHidden ? msgs.map((m) => ({ ...m, body: m.body === null ? null : HIDDEN, media: null })) : msgs;
}

export function unreadConversations(v: Viewer = currentViewer()): number {
  return world.inbox().conversations.filter((c) => c.unreadCount > 0 && canSee(v, c.assignee?.id)).length;
}

// ---------------------------------------------------------------- lead timeline

/** Unified timeline of one lead (newest first); empty for leads the world does not know (created in this session). */
export function timelineForLead(lead: LeadListItem): Activity[] {
  const known = worldContext().leadById.get(lead.id);
  if (!known) return [];
  // Owner or stage edits made in this session keep the generated history of the original lead.
  return world.timeline(known);
}

// ---------------------------------------------------------------- team and targets

export interface TeamMemberRow {
  user: UserSummary;
  email: string;
  phone: string;
  title: string;
  teamId: string | null;
  teamName: string | null;
  isManager: boolean;
  stats: {
    callsToday: number;
    talkSecToday: number;
    openLeads: number;
    openTasks: number;
    overdueTasks: number;
    wonInrThisMonth: number;
    dealsWonThisMonth: number;
  };
  /** Revenue target progress this month (0-100+), null without a target. */
  targetPct: number | null;
}

/** GET /users (team.read) with today's numbers, scoped: own = self, team = own team, all = everyone. */
export function listTeamMembers(v: Viewer = currentViewer(), now = Date.now()): TeamMemberRow[] {
  const ctx = worldContext();
  const ix = world.indexes();
  const dayStart = istDayStart(now);
  const monthStart = istMonthStart(now);
  const period = istPeriod(now);
  const revenueTarget = new Map(world.targets().filter((t) => t.subjectType === 'user' && t.metric === 'revenue_inr' && t.period === period).map((t) => [t.subjectId, t]));
  return ctx.users
    .filter((u) => canSee(v, u.id))
    .map((u, i) => {
      const fx = EMPLOYEE_FIXTURES.find((e) => e.name === u.name) ?? EMPLOYEE_FIXTURES[i]!;
      const team = ctx.teams.find((t) => t.memberIds.includes(u.id)) ?? null;
      const calls = (ix.callsByUser.get(u.id) ?? []).filter((c) => Date.parse(c.startedAt) >= dayStart && c.status !== 'in_progress');
      const tasks = (ix.tasksByAssignee.get(u.id) ?? []).filter((t) => t.status === 'open');
      const leads = ctx.leadsByOwner.get(u.id) ?? [];
      let wonInr = 0;
      let deals = 0;
      for (const l of leads) {
        const w = wonAt(ctx, l);
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
          talkSecToday: calls.reduce((s, c) => s + c.durationSec, 0),
          openLeads: leads.filter((l) => ctx.stageById.get(l.stageId)?.type === 'open').length,
          openTasks: tasks.length,
          overdueTasks: tasks.filter((t) => t.dueAt !== null && Date.parse(t.dueAt) < now).length,
          wonInrThisMonth: wonInr,
          dealsWonThisMonth: deals,
        },
        targetPct: target && target.target > 0 ? Math.round((target.achieved / target.target) * 100) : null,
      };
    });
}

/** GET /targets?period=YYYY-MM: user targets in scope, plus team targets of teams in scope. */
export function listTargets(period?: string, v: Viewer = currentViewer()): MockTarget[] {
  const ctx = worldContext();
  const teamVisible = new Set(ctx.teams.filter((t) => v.visible === null || (v.dataScope === 'team' && t.memberIds.every((id) => v.visible!.has(id)))).map((t) => t.id));
  return world.targets().filter((t) => (!period || t.period === period) && (t.subjectType === 'user' ? canSee(v, t.subjectId) : teamVisible.has(t.subjectId)));
}

export function targetsForUser(userId: string, period: string): Array<{ metric: TargetMetric; period: string; target: number; achieved: number }> {
  return world
    .targets()
    .filter((t) => t.subjectType === 'user' && t.subjectId === userId && t.period === period)
    .map(({ metric, period: p, target, achieved }) => ({ metric, period: p, target, achieved }));
}

// ---------------------------------------------------------------- reports

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

/** Reports page summary for a date range, scoped (managers: their team; viewers and admins: all). */
export function reportSummary(from: number, to: number, v: Viewer = currentViewer()): ReportSummary {
  const ctx = worldContext();
  const leads = ctx.leads.filter((l) => (v.visible === null || (l.owner && v.visible.has(l.owner.id))) && Date.parse(l.createdAt) >= from && Date.parse(l.createdAt) < to);
  const allScoped = ctx.leads.filter((l) => v.visible === null || (l.owner && v.visible.has(l.owner.id)));
  const order = new Map(ctx.stages.map((s, i) => [s.id, i]));
  const open = ctx.stages.filter((s) => s.type !== 'lost');
  const funnel = open.map((s) => {
    const idx = order.get(s.id)!;
    const reached = leads.filter((l) => leadStory(ctx, l).stagePath.some((p) => (order.get(p.stageId) ?? -1) >= idx && ctx.stageById.get(p.stageId)?.type !== 'lost'));
    return { stageId: s.id, name: s.name, count: reached.length, valueInr: reached.reduce((a, l) => a + l.valueInr, 0) };
  });
  const sourcesMap = new Map<LeadSource, { leads: number; won: number; wonValueInr: number }>();
  for (const l of leads) {
    const row = sourcesMap.get(l.source) ?? { leads: 0, won: 0, wonValueInr: 0 };
    row.leads++;
    if (wonAt(ctx, l) !== null) {
      row.won++;
      row.wonValueInr += l.valueInr;
    }
    sourcesMap.set(l.source, row);
  }
  const calls = world.calls().filter((c) => canSee(v, c.user?.id) && Date.parse(c.startedAt) >= from && Date.parse(c.startedAt) < to && c.status !== 'in_progress');
  const reps = ctx.sellers
    .filter((u) => canSee(v, u.id))
    .map((u) => {
      const mine = leads.filter((l) => l.owner?.id === u.id);
      const myCalls = calls.filter((c) => c.user?.id === u.id);
      const won = allScoped.filter((l) => l.owner?.id === u.id && (wonAt(ctx, l) ?? -1) >= from && (wonAt(ctx, l) ?? Infinity) < to);
      const touches = mine.map((l) => leadStory(ctx, l).firstTouchAt - Date.parse(l.createdAt)).filter((d) => d >= 0);
      return {
        user: u,
        leads: mine.length,
        calls: myCalls.length,
        answeredPct: myCalls.length ? Math.round((myCalls.filter((c) => c.status === 'completed').length / myCalls.length) * 100) : 0,
        won: won.length,
        revenueInr: won.reduce((a, l) => a + l.valueInr, 0),
        avgResponseMin: touches.length ? Math.round(touches.reduce((a, b) => a + b, 0) / touches.length / 60_000) : null,
      };
    })
    .sort((a, b) => b.revenueInr - a.revenueInr);
  const sla = { within5Min: 0, within30Min: 0, later: 0, untouched: 0 };
  for (const l of leads) {
    const d = leadStory(ctx, l).firstTouchAt - Date.parse(l.createdAt);
    if (leadStory(ctx, l).firstTouchAt > Date.now()) sla.untouched++;
    else if (d <= 5 * 60_000) sla.within5Min++;
    else if (d <= 30 * 60_000) sla.within30Min++;
    else sla.later++;
  }
  const byDay = new Map<string, { date: string; answered: number; missed: number }>();
  for (const c of calls) {
    const date = new Date(Date.parse(c.startedAt) + 330 * 60_000).toISOString().slice(0, 10);
    const row = byDay.get(date) ?? { date, answered: 0, missed: 0 };
    if (c.status === 'completed') row.answered++;
    else row.missed++;
    byDay.set(date, row);
  }
  const stats = world.runStats();
  const workflows = Object.values(WORKFLOW_FIXTURE_IDS).map((id) => {
    const s: WorkflowRunStats = stats.get(id) ?? { runs: 0, completed: 0, failed: 0, active: 0, lastRunAt: null };
    return { workflowId: id, name: WORKFLOW_FIXTURE_NAMES.get(id) ?? 'Workflow', runs: s.runs, completed: s.completed, failed: s.failed, active: s.active };
  });
  const forecastInr = Math.round(allScoped.reduce((a, l) => a + (ctx.stageById.get(l.stageId)?.type === 'open' ? (l.valueInr * (ctx.stageById.get(l.stageId)?.probability ?? 0)) / 100 : 0), 0));
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

// ---------------------------------------------------------------- workflows

export function workflowStatsByKey(): Map<string, WorkflowRunStats> {
  const stats = world.runStats();
  return new Map([...stats.entries()].map(([id, s]) => [WORKFLOW_FIXTURE_KEYS.get(id) ?? id, s]));
}

export interface RunQuery {
  /** Workflow id or template key. */
  workflow?: string;
  leadId?: string;
  status?: WorkflowRun['status'];
  isTest?: boolean;
  cursor?: string;
  limit?: number;
}

/** GET /workflow-runs (newest first). Runs on leads follow the lead owner's scope; runs without a lead need `all`. */
export function listWorkflowRuns(q: RunQuery = {}, v: Viewer = currentViewer()): Page<WorkflowRun> {
  const ctx = worldContext();
  const wid = q.workflow ? (WORKFLOW_FIXTURE_IDS[q.workflow] ?? q.workflow) : null;
  const rows = world.runs().filter((r) => {
    if (wid && r.workflowId !== wid) return false;
    if (q.leadId && r.leadId !== q.leadId) return false;
    if (q.status && r.status !== q.status) return false;
    if (q.isTest !== undefined && r.isTest !== q.isTest) return false;
    const owner = r.leadId ? ctx.leadById.get(r.leadId)?.owner?.id : null;
    return canSee(v, owner);
  });
  return pageOf(rows, q.cursor, q.limit ?? 50);
}

/** One run with its steps. */
export function getWorkflowRun(id: string, v: Viewer = currentViewer()): WorkflowRun {
  const run = world.run(id);
  const owner = run?.leadId ? worldContext().leadById.get(run.leadId)?.owner?.id : null;
  if (!run || !canSee(v, owner)) throw new ApiRequestError('NOT_FOUND', 'This workflow run does not exist or is not shared with you');
  return run;
}

// ---------------------------------------------------------------- notifications

/** GET /notifications for the viewer, newest first; read marks are kept in the mock DB. */
export function listNotifications(v: Viewer = currentViewer()): Notification[] {
  if (!v.userId) return [];
  const read = new Set(readMockDb().notificationsRead[v.userId] ?? []);
  const canWorkflows = v.permissions.includes('workflows.read');
  return world
    .notifications(v.userId)
    .filter((n) => canWorkflows || n.type !== 'workflow_failed')
    .map((n) => (n.readAt || !read.has(n.id) ? n : { ...n, readAt: new Date().toISOString() }));
}

/** POST /notifications/read: the given ids, or all when omitted. */
export function markNotificationsRead(ids?: readonly string[], v: Viewer = currentViewer()): void {
  if (!v.userId) return;
  const userId = v.userId;
  const all = ids ?? world.notifications(userId).map((n) => n.id);
  updateMockDb((db) => {
    db.notificationsRead[userId] = [...new Set([...(db.notificationsRead[userId] ?? []), ...all])].slice(-500);
  });
}

// ---------------------------------------------------------------- admin: audit, integrations, webhooks, billing, views

export interface AuditQuery {
  action?: string;
  actorId?: string;
  entityType?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

/** GET /audit-log (audit.read): newest first. */
export function listAuditLog(q: AuditQuery = {}): Page<AuditLog> {
  const needle = q.q?.toLowerCase().trim();
  const rows = world
    .audit()
    .filter((a) => (!q.action || a.action.startsWith(q.action)) && (!q.actorId || a.actorId === q.actorId) && (!q.entityType || a.entityType === q.entityType))
    .filter((a) => !needle || `${a.actorName ?? ''} ${a.action} ${a.entityType}`.toLowerCase().includes(needle));
  return pageOf(rows, q.cursor, q.limit ?? 50);
}

export const listIntegrations = () => world.integrations();
export const listWebhookEndpoints = () => world.webhooks();
export function listWebhookDeliveries(q: { endpointId?: string; status?: string; cursor?: string; limit?: number } = {}) {
  const rows = world.deliveries().filter((d) => (!q.endpointId || d.endpointId === q.endpointId) && (!q.status || d.status === q.status));
  return pageOf(rows, q.cursor, q.limit ?? 50);
}
export const getBilling = () => world.billing();

/** Saved views the viewer can use: shared ones plus their own. */
export function listSavedViews(v: Viewer = currentViewer()): SavedView[] {
  return world.savedViews().filter((s) => s.isShared || s.ownerId === v.userId);
}
