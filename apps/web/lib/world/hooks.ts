'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiRouteId, Notification, Page, Task, UserSummary } from '@vistar/shared';
import { DAY_MS, istDayStart, istMonthStart } from '@vistar/shared/fixtures';
import { useMemo } from 'react';
import { emptyPage, isRouteLive, notAvailableYet } from '../api/availability';
import { api } from '../api/client';
import { isMockData } from '../api/data-source';
import { useMe } from '../session/session';
import {
  getBilling,
  getConversation,
  getWorkflowRun,
  listAuditLog,
  listCalls,
  listConversations,
  listIntegrations,
  listMessages,
  listNotifications,
  listSavedViews,
  listTargets,
  listTasks,
  listTeamMembers,
  listWebhookDeliveries,
  listWebhookEndpoints,
  listWorkflowRuns,
  markNotificationsRead,
  reportSummary,
  taskCounts,
  type AuditQuery,
  type CallQuery,
  type ConversationQuery,
  type ReportSummary,
  type RunQuery,
  type TaskCounts,
  type TaskQuery,
  type TeamMemberRow,
} from './read';
import { viewerFromMe, type Viewer } from './scope';

/**
 * Data hooks shared by the Tasks, Calls, Inbox, Team, Targets, Reports pages, the bell and the
 * Employee panel. Hook names and return shapes are stable.
 *
 * API mode (default): each hook calls its route. Routes the API does not serve yet
 * (lib/api/availability) return an honest empty result without a request, so pages show their
 * empty states; nothing generated reaches the page. Mock mode (automated tests only) reads the
 * mock world in ./read with the same data scope as the API.
 *
 * Query keys start with a SYNC_SCOPES value (tasks, calls, conversations, notifications, dashboard,
 * workflows, leads) so realtime events and resyncs invalidate them.
 */
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms));
const MAX_ROWS = 1000;

function useViewer(): Viewer {
  const me = useMe();
  return useMemo(() => viewerFromMe(me), [me]);
}

/** Follow `nextCursor` until `limit` rows (API pages hold at most 200). */
async function collect<T>(fetchPage: (cursor: string | undefined, limit: number) => Promise<Page<T>>, limit: number): Promise<Page<T>> {
  const want = Math.min(Math.max(1, limit), MAX_ROWS);
  const items: T[] = [];
  let cursor: string | undefined;
  let last: Page<T> = { items: [], nextCursor: null };
  do {
    last = await fetchPage(cursor, Math.min(200, want - items.length));
    items.push(...last.items);
    cursor = last.nextCursor ?? undefined;
  } while (cursor && items.length < want);
  return { items, nextCursor: last.nextCursor, total: last.total };
}

function apiTasks(q: TaskQuery): Promise<Page<Task>> {
  const { limit = 50, cursor, ...rest } = q;
  return collect((c, l) => api.call('taskList', { query: { ...rest, cursor: c ?? cursor, limit: l } }), limit);
}

// ---------------------------------------------------------------- tasks

export function useWorldTasks(q: TaskQuery = {}) {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: ['tasks', 'world', v.userId, q],
    queryFn: async () => (mock ? (await wait(), listTasks(q, v)) : apiTasks(q)),
    enabled: !!v.userId,
  });
}

function countTasks(open: readonly Task[], done: readonly Task[], now = Date.now()): TaskCounts {
  const dayEnd = istDayStart(now) + DAY_MS;
  const counts: TaskCounts = { overdue: 0, today: 0, upcoming: 0, doneThisWeek: 0 };
  for (const t of open) {
    if (!t.dueAt) continue;
    const due = Date.parse(t.dueAt);
    if (due < now) counts.overdue++;
    else if (due < dayEnd) counts.today++;
    else counts.upcoming++;
  }
  for (const t of done) if (t.completedAt && Date.parse(t.completedAt) >= now - 7 * DAY_MS) counts.doneThisWeek++;
  return counts;
}

export function useTaskCounts(scope: 'mine' | 'team' = 'mine') {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: ['tasks', 'world', v.userId, 'counts', scope],
    queryFn: async () => {
      if (mock) return (await wait(120), taskCounts(scope, v));
      const [open, done] = await Promise.all([apiTasks({ scope, status: ['open'], limit: MAX_ROWS }), apiTasks({ scope, status: ['done'], limit: 200 })]);
      return countTasks(open.items, done.items);
    },
    enabled: !!v.userId,
  });
}

// ---------------------------------------------------------------- calls and inbox (REALTIME)

export function useWorldCalls(q: CallQuery = {}) {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: ['calls', 'world', v.userId, q],
    queryFn: async () => {
      if (mock) return (await wait(), listCalls(q, v));
      if (!isRouteLive('callList')) return emptyPage<ReturnType<typeof listCalls>['items'][number]>();
      const { limit = 50, cursor, ...rest } = q;
      return collect((c, l) => api.call('callList', { query: { ...rest, cursor: c ?? cursor, limit: l } }), limit);
    },
    enabled: !!v.userId,
  });
}

export function useConversations(q: ConversationQuery = {}) {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: ['conversations', 'world', v.userId, q],
    queryFn: async () => {
      if (mock) return (await wait(), listConversations(q, v));
      if (!isRouteLive('conversationList')) return emptyPage<ReturnType<typeof listConversations>['items'][number]>();
      const { limit = 50, cursor, ...rest } = q;
      return collect((c, l) => api.call('conversationList', { query: { ...rest, cursor: c ?? cursor, limit: l } }), limit);
    },
    enabled: !!v.userId,
  });
}

export function useConversation(id: string | null) {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: ['conversations', 'world', v.userId, 'detail', id],
    queryFn: async () => {
      if (mock) return (await wait(150), { conversation: getConversation(id!, v), messages: listMessages(id!, v) });
      if (!isRouteLive('conversationGet') || !isRouteLive('messageList')) throw notAvailableYet('WhatsApp inbox');
      const [conversation, messages] = await Promise.all([
        api.call('conversationGet', { params: { id: id! } }),
        collect((c, l) => api.call('messageList', { params: { id: id! }, query: { cursor: c, limit: l } }), MAX_ROWS),
      ]);
      return { conversation, messages: messages.items };
    },
    enabled: !!v.userId && !!id,
  });
}

// ---------------------------------------------------------------- team, targets, reports

async function apiTeamMembers(v: Viewer, now = Date.now()): Promise<TeamMemberRow[]> {
  const [users, teams, openTasks, pipelines] = await Promise.all([
    api.call('userList').then((r) => r.items),
    api.call('teamList').then((r) => r.items),
    apiTasks({ scope: 'team', status: ['open'], limit: MAX_ROWS }).then((p) => p.items),
    api.call('pipelineList').then((r) => r.items),
  ]);
  const canDash = v.permissions.includes('dashboard.read');
  const [today, month] = canDash
    ? await Promise.all([
        api.call('dashboardSummary', { query: { from: new Date(istDayStart(now)).toISOString(), to: new Date(now).toISOString(), compare: 'none' } }),
        api.call('dashboardSummary', { query: { from: new Date(istMonthStart(now)).toISOString(), to: new Date(now).toISOString(), compare: 'none' } }),
      ])
    : [null, null];
  const visible = users.filter((u) => u.isActive && (v.visible === null || v.visible.has(u.id)));
  const openStageIds = pipelines.flatMap((p) => p.stages.filter((s) => s.type === 'open').map((s) => s.id));
  // Open leads per person from the lead list total (one small request each; skipped for big teams).
  const openLeads = new Map<string, number>();
  if (visible.length <= 30 && openStageIds.length) {
    await Promise.all(
      visible.map(async (u) => {
        const page = await api.call('leadList', { query: { ownerId: [u.id], stageId: openStageIds, limit: 1 } });
        openLeads.set(u.id, page.total ?? page.items.length);
      }),
    );
  }
  const todayBoard = new Map((today?.leaderboard ?? []).map((e) => [e.user.id, e]));
  const monthBoard = new Map((month?.leaderboard ?? []).map((e) => [e.user.id, e]));
  return visible.map((u) => {
    const team = teams.find((t) => t.managerId === u.id) ?? teams.find((t) => t.memberIds.includes(u.id)) ?? null;
    const tasks = openTasks.filter((t) => t.assignee?.id === u.id);
    const summary: UserSummary = { id: u.id, name: u.name, role: u.role, status: u.status, avatar: u.avatar };
    return {
      user: summary,
      email: u.email,
      phone: u.phone ?? '',
      title: u.title ?? u.roleName,
      teamId: team?.id ?? null,
      teamName: team?.name ?? null,
      isManager: !!team && team.managerId === u.id,
      stats: {
        callsToday: todayBoard.get(u.id)?.calls ?? 0,
        // Talk time comes with the calls API (REALTIME).
        talkSecToday: 0,
        openLeads: openLeads.get(u.id) ?? 0,
        openTasks: tasks.length,
        overdueTasks: tasks.filter((t) => t.dueAt !== null && Date.parse(t.dueAt) < now).length,
        wonInrThisMonth: monthBoard.get(u.id)?.revenueInr ?? 0,
        dealsWonThisMonth: monthBoard.get(u.id)?.dealsWon ?? 0,
      },
      targetPct: monthBoard.get(u.id)?.targetPct ?? null,
    };
  });
}

export function useTeamMembers() {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: ['dashboard', 'world', v.userId, 'team'],
    queryFn: async () => (mock ? (await wait(), listTeamMembers(v)) : apiTeamMembers(v)),
    enabled: !!v.userId,
  });
}

/** Targets have no API route yet: an empty list in API mode (the page says "No targets"). */
export function useTargets(period?: string) {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: ['dashboard', 'world', v.userId, 'targets', period ?? 'all'],
    queryFn: async () => (mock ? (await wait(), listTargets(period, v)) : ([] as ReturnType<typeof listTargets>)),
    enabled: !!v.userId,
  });
}

export function emptyReport(from: number, to: number): ReportSummary {
  return {
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    funnel: [],
    sources: [],
    reps: [],
    responseSla: { within5Min: 0, within30Min: 0, later: 0, untouched: 0 },
    callsByDay: [],
    workflows: [],
    forecastInr: 0,
  };
}

/** Reports have no API route yet: an empty summary in API mode (the page shows its empty state). */
export function useReportSummary(from: number, to: number) {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: ['dashboard', 'world', v.userId, 'reports', from, to],
    queryFn: async () => (mock ? (await wait(350), reportSummary(from, to, v)) : emptyReport(from, to)),
    enabled: !!v.userId,
  });
}

// ---------------------------------------------------------------- workflows, integrations, admin

export function useWorkflowRuns(q: RunQuery = {}) {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: ['workflows', 'world', v.userId, 'runs', q],
    queryFn: async () => (mock ? (await wait(), listWorkflowRuns(q, v)) : emptyPage<ReturnType<typeof listWorkflowRuns>['items'][number]>()),
    enabled: !!v.userId,
  });
}

export function useWorkflowRun(id: string | null) {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: ['workflows', 'world', v.userId, 'run', id],
    queryFn: async () => {
      if (mock) return (await wait(150), getWorkflowRun(id!, v));
      throw notAvailableYet('Workflow runs');
    },
    enabled: !!v.userId && !!id,
  });
}

const mockOr = <T,>(mockFn: () => T, empty: T, route?: ApiRouteId) => async (): Promise<T> => {
  if (isMockData()) return (await wait(), mockFn());
  void route;
  return empty;
};

export function useIntegrations() {
  return useQuery({ queryKey: ['workflows', 'world', 'integrations'], queryFn: mockOr(listIntegrations, [] as ReturnType<typeof listIntegrations>, 'integrationList') });
}

export function useWebhookEndpoints() {
  return useQuery({ queryKey: ['workflows', 'world', 'webhooks'], queryFn: mockOr(listWebhookEndpoints, [] as ReturnType<typeof listWebhookEndpoints>, 'webhookEndpointList') });
}

export function useWebhookDeliveries(q: { endpointId?: string; status?: string; cursor?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: ['workflows', 'world', 'deliveries', q],
    queryFn: mockOr(() => listWebhookDeliveries(q), emptyPage() as ReturnType<typeof listWebhookDeliveries>, 'webhookDeliveryList'),
  });
}

/** Billing has no API route yet: null in API mode. */
export function useBilling() {
  return useQuery({ queryKey: ['dashboard', 'world', 'billing'], queryFn: mockOr<ReturnType<typeof getBilling> | null>(getBilling, null) });
}

export function useAuditLog(q: AuditQuery = {}) {
  const mock = isMockData();
  return useQuery({
    queryKey: ['dashboard', 'world', 'audit', q],
    queryFn: async () => {
      if (mock) return (await wait(300), listAuditLog(q));
      if (!isRouteLive('auditList')) return emptyPage<ReturnType<typeof listAuditLog>['items'][number]>();
      const { limit = 50, cursor, q: _text, ...rest } = q;
      return collect((c, l) => api.call('auditList', { query: { ...rest, cursor: c ?? cursor, limit: l } }), limit);
    },
  });
}

export function useWorldSavedViews() {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: ['leads', 'world', v.userId, 'saved-views'],
    queryFn: async () => (mock ? (await wait(120), listSavedViews(v)) : (await api.call('viewList')).items),
    enabled: !!v.userId,
  });
}

// ---------------------------------------------------------------- notifications

const notificationsKey = (userId: string | null) => ['notifications', 'world', userId] as const;

/** Bell and notification centre (newest first). */
export function useNotifications() {
  const v = useViewer();
  const mock = isMockData();
  return useQuery({
    queryKey: notificationsKey(v.userId),
    queryFn: async (): Promise<Notification[]> => (mock ? (await wait(150), listNotifications(v)) : (await api.call('notificationList', { query: { limit: 50 } })).items),
    enabled: !!v.userId,
    staleTime: 60_000,
  });
}

/** Mark some (or all) notifications read: optimistic; POST /notifications/read (mock: the mock DB). */
export function useMarkNotificationsRead() {
  const v = useViewer();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: readonly string[]) => {
      if (isMockData()) return markNotificationsRead(ids, v);
      await api.call('notificationRead', { body: ids ? { ids: [...ids] } : {} });
    },
    onMutate: (ids) => {
      const at = new Date().toISOString();
      const before = qc.getQueryData<Notification[]>(notificationsKey(v.userId));
      qc.setQueryData<Notification[]>(notificationsKey(v.userId), (list) =>
        list?.map((n) => (n.readAt || (ids && !ids.includes(n.id)) ? n : { ...n, readAt: at })),
      );
      return { before };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.before) qc.setQueryData(notificationsKey(v.userId), ctx.before);
    },
  });
}
