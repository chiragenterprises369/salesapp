'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
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
  type RunQuery,
  type TaskQuery,
} from './read';
import { viewerFromMe, type Viewer } from './scope';

/**
 * React Query hooks over the mock world (Wave 1). Query keys start with a SYNC_SCOPES value
 * (tasks, calls, conversations, notifications, dashboard, workflows) so realtime resyncs invalidate
 * them; the second segment is 'world' while they read mocks. Wave 3 swaps the queryFns for HTTP.
 * A short delay keeps loading states visible, like the other mock sources.
 */
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms));

function useViewer(): Viewer {
  const me = useMe();
  return useMemo(() => viewerFromMe(me), [me]);
}

export function useWorldTasks(q: TaskQuery = {}) {
  const v = useViewer();
  return useQuery({ queryKey: ['tasks', 'world', v.userId, q], queryFn: async () => (await wait(), listTasks(q, v)), enabled: !!v.userId });
}

export function useTaskCounts(scope: 'mine' | 'team' = 'mine') {
  const v = useViewer();
  return useQuery({ queryKey: ['tasks', 'world', v.userId, 'counts', scope], queryFn: async () => (await wait(120), taskCounts(scope, v)), enabled: !!v.userId });
}

export function useWorldCalls(q: CallQuery = {}) {
  const v = useViewer();
  return useQuery({ queryKey: ['calls', 'world', v.userId, q], queryFn: async () => (await wait(), listCalls(q, v)), enabled: !!v.userId });
}

export function useConversations(q: ConversationQuery = {}) {
  const v = useViewer();
  return useQuery({ queryKey: ['conversations', 'world', v.userId, q], queryFn: async () => (await wait(), listConversations(q, v)), enabled: !!v.userId });
}

export function useConversation(id: string | null) {
  const v = useViewer();
  return useQuery({
    queryKey: ['conversations', 'world', v.userId, 'detail', id],
    queryFn: async () => (await wait(150), { conversation: getConversation(id!, v), messages: listMessages(id!, v) }),
    enabled: !!v.userId && !!id,
  });
}

export function useTeamMembers() {
  const v = useViewer();
  return useQuery({ queryKey: ['dashboard', 'world', v.userId, 'team'], queryFn: async () => (await wait(), listTeamMembers(v)), enabled: !!v.userId });
}

export function useTargets(period?: string) {
  const v = useViewer();
  return useQuery({ queryKey: ['dashboard', 'world', v.userId, 'targets', period ?? 'all'], queryFn: async () => (await wait(), listTargets(period, v)), enabled: !!v.userId });
}

export function useReportSummary(from: number, to: number) {
  const v = useViewer();
  return useQuery({ queryKey: ['dashboard', 'world', v.userId, 'reports', from, to], queryFn: async () => (await wait(350), reportSummary(from, to, v)), enabled: !!v.userId });
}

export function useWorkflowRuns(q: RunQuery = {}) {
  const v = useViewer();
  return useQuery({ queryKey: ['workflows', 'world', v.userId, 'runs', q], queryFn: async () => (await wait(), listWorkflowRuns(q, v)), enabled: !!v.userId });
}

export function useWorkflowRun(id: string | null) {
  const v = useViewer();
  return useQuery({ queryKey: ['workflows', 'world', v.userId, 'run', id], queryFn: async () => (await wait(150), getWorkflowRun(id!, v)), enabled: !!v.userId && !!id });
}

export function useIntegrations() {
  return useQuery({ queryKey: ['workflows', 'world', 'integrations'], queryFn: async () => (await wait(), listIntegrations()) });
}

export function useWebhookEndpoints() {
  return useQuery({ queryKey: ['workflows', 'world', 'webhooks'], queryFn: async () => (await wait(), listWebhookEndpoints()) });
}

export function useWebhookDeliveries(q: { endpointId?: string; status?: string; cursor?: string; limit?: number } = {}) {
  return useQuery({ queryKey: ['workflows', 'world', 'deliveries', q], queryFn: async () => (await wait(), listWebhookDeliveries(q)) });
}

export function useBilling() {
  return useQuery({ queryKey: ['dashboard', 'world', 'billing'], queryFn: async () => (await wait(), getBilling()) });
}

export function useAuditLog(q: AuditQuery = {}) {
  return useQuery({ queryKey: ['dashboard', 'world', 'audit', q], queryFn: async () => (await wait(300), listAuditLog(q)) });
}

export function useWorldSavedViews() {
  const v = useViewer();
  return useQuery({ queryKey: ['leads', 'world', v.userId, 'saved-views'], queryFn: async () => (await wait(120), listSavedViews(v)), enabled: !!v.userId });
}

const notificationsKey = (userId: string | null) => ['notifications', 'world', userId] as const;

/** Bell and notification centre. */
export function useNotifications() {
  const v = useViewer();
  return useQuery({
    queryKey: notificationsKey(v.userId),
    queryFn: async () => (await wait(150), listNotifications(v)),
    enabled: !!v.userId,
    staleTime: 60_000,
  });
}

/** Mark some (or all) notifications read: optimistic, persisted in the mock DB. */
export function useMarkNotificationsRead() {
  const v = useViewer();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: readonly string[]) => markNotificationsRead(ids, v),
    onMutate: (ids) => {
      const at = new Date().toISOString();
      qc.setQueryData<ReturnType<typeof listNotifications>>(notificationsKey(v.userId), (list) =>
        list?.map((n) => (n.readAt || (ids && !ids.includes(n.id)) ? n : { ...n, readAt: at })),
      );
    },
  });
}
