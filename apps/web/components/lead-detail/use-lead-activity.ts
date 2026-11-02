'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Activity, Lead, LeadListItem, Task } from '@vistar/shared';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';
import { leadKeys } from '@/lib/leads/data';

/**
 * Lead timeline, notes, tasks, duplicates and merge over the API (GET /leads/{id}/timeline,
 * POST /leads/{id}/notes, GET/POST/PATCH /tasks with leadId, GET /leads/{id}/duplicates,
 * POST /leads/merge). Every query is disabled in the test-only mock data mode, where the lead
 * detail keeps its mock timeline.
 */
export const leadActivityKeys = {
  timeline: (leadId: string) => ['leads', 'timeline', leadId] as const,
  tasks: (leadId: string) => ['tasks', 'lead', leadId] as const,
  duplicates: (leadId: string) => [...leadKeys.detail(leadId), 'duplicates'] as const,
};

const TIMELINE_LIMIT = 200;

export function useLeadTimeline(leadId: string) {
  return useQuery({
    queryKey: leadActivityKeys.timeline(leadId),
    queryFn: async (): Promise<Activity[]> => (await api.call('leadTimeline', { params: { id: leadId }, query: { limit: TIMELINE_LIMIT } })).items,
    enabled: !isMockData(),
    staleTime: 15_000,
  });
}

/** Open tasks first (by due time), then done and cancelled ones (latest first). */
export function sortLeadTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.status === 'open' && b.status !== 'open') return -1;
    if (b.status === 'open' && a.status !== 'open') return 1;
    if (a.status === 'open') return (a.dueAt ?? '').localeCompare(b.dueAt ?? '');
    return (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt);
  });
}

export function useLeadTasks(leadId: string) {
  return useQuery({
    queryKey: leadActivityKeys.tasks(leadId),
    queryFn: async () => sortLeadTasks((await api.call('taskList', { query: { scope: 'team', leadId, limit: 100 } })).items),
    enabled: !isMockData(),
  });
}

/** After any change on a lead: its timeline, tasks and the task lists refetch. */
function useRefreshLead(leadId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: leadActivityKeys.timeline(leadId) }),
      qc.invalidateQueries({ queryKey: leadActivityKeys.tasks(leadId) }),
      qc.invalidateQueries({ queryKey: ['tasks', 'world'] }),
    ]);
}

export function useAddNote(leadId: string) {
  const refresh = useRefreshLead(leadId);
  return useMutation({ mutationFn: (body: string) => api.call('leadNoteCreate', { params: { id: leadId }, body: { body } }), onSuccess: refresh });
}

export function useLeadTaskMutations(lead: Pick<Lead, 'id'>) {
  const refresh = useRefreshLead(lead.id);
  return {
    create: useMutation({
      mutationFn: ({ title, dueAt }: { title: string; dueAt: string | null }) =>
        api.call('taskCreate', { body: { title, dueAt, leadId: lead.id, type: 'todo' } }),
      onSuccess: refresh,
    }),
    setDone: useMutation({
      mutationFn: ({ task, done }: { task: Task; done: boolean }) => api.call('taskUpdate', { params: { id: task.id }, body: { status: done ? 'done' : 'open' } }),
      onSuccess: refresh,
    }),
  };
}

/** Possible duplicates by phone, email, name and company (server side). */
export function useLeadDuplicates(leadId: string, enabled: boolean) {
  return useQuery({
    queryKey: leadActivityKeys.duplicates(leadId),
    queryFn: async (): Promise<LeadListItem[]> => (await api.call('leadDuplicates', { params: { id: leadId } })).items,
    enabled: enabled && !isMockData(),
  });
}

/** Merge duplicates into the primary lead (the API soft-deletes the duplicates and keeps their history). */
export function useMergeLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ primaryId, duplicateIds }: { primaryId: string; duplicateIds: string[] }) => api.call('leadMerge', { body: { primaryId, duplicateIds } }),
    onSuccess: async (lead) => {
      qc.setQueryData(leadKeys.detail(lead.id), lead);
      await Promise.all([qc.invalidateQueries({ queryKey: leadKeys.all }), qc.invalidateQueries({ queryKey: leadKeys.boards() })]);
    },
  });
}
