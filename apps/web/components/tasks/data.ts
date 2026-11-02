'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Task } from '@vistar/shared';
import { useMemo } from 'react';
import { create } from 'zustand';
import { viewerFromMe, type Viewer } from '@/lib/world';
import { useWorldTasks } from '@/lib/world/hooks';
import { useMe } from '@/lib/session/session';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';
import type { TaskTab } from './logic';

/**
 * Tasks page data adapter: GET /tasks?scope=mine|team (data scope applied by the API) with local edits
 * layered on top while a change is being saved, so complete, reopen, snooze and undo are optimistic.
 * Saves go to PATCH /tasks/{id} and POST /tasks/{id}/snooze; the list refetches afterwards. The
 * test-only mock data mode keeps the edits locally.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useViewer(): Viewer {
  const me = useMe();
  return useMemo(() => viewerFromMe(me), [me]);
}

type Patch = Partial<Pick<Task, 'status' | 'completedAt' | 'dueAt' | 'snoozedUntil' | 'updatedAt'>>;

interface TaskEdits {
  patches: Record<string, Patch>;
  /** The task as it was before the last action (what Undo saves back in API mode). */
  bases: Record<string, Task>;
  set: (id: string, patch: Patch | undefined) => void;
}

/** Local task edits (the mock "server" state for this browser tab). */
export const useTaskEdits = create<TaskEdits>()((set) => ({
  patches: {},
  bases: {},
  set: (id, patch) =>
    set((s) => {
      const next = { ...s.patches };
      if (patch) next[id] = patch;
      else delete next[id];
      return { patches: next };
    }),
}));

export function applyPatches(tasks: readonly Task[], patches: Record<string, Patch>): Task[] {
  return tasks.map((t) => (patches[t.id] ? { ...t, ...patches[t.id] } : t));
}

/** Every task of the tab in the viewer's scope, with local edits applied. */
export function useTasks(tab: TaskTab) {
  const query = useWorldTasks({ scope: tab, limit: 10_000 });
  const patches = useTaskEdits((s) => s.patches);
  const data = useMemo(() => (query.data ? applyPatches(query.data.items, patches) : undefined), [query.data, patches]);
  return { ...query, data };
}

export type TaskAction = { kind: 'complete' } | { kind: 'reopen' } | { kind: 'snooze'; until: number };

export function patchFor(task: Task, action: TaskAction, now: number): Patch {
  const at = new Date(now).toISOString();
  if (action.kind === 'complete') return { status: 'done', completedAt: at, updatedAt: at };
  if (action.kind === 'reopen') return { status: 'open', completedAt: null, updatedAt: at };
  const until = new Date(action.until).toISOString();
  return { status: 'open', dueAt: until, snoozedUntil: until, updatedAt: at };
}

/** Optimistic task action: the edit shows at once; a failure puts the previous state back. */
async function saveAction(task: Task, action: TaskAction): Promise<void> {
  if (action.kind === 'snooze') await api.call('taskSnooze', { params: { id: task.id }, body: { until: new Date(action.until).toISOString() } });
  else await api.call('taskUpdate', { params: { id: task.id }, body: { status: action.kind === 'complete' ? 'done' : 'open' } });
}

export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ task, action }: { task: Task; action: TaskAction }) => {
      if (isMockData()) {
        await wait(250);
        return true;
      }
      await saveAction(task, action);
      return true;
    },
    onMutate: ({ task, action }) => {
      const store = useTaskEdits.getState();
      const previous = store.patches[task.id];
      useTaskEdits.setState((s) => ({ bases: { ...s.bases, [task.id]: { ...task, ...previous } } }));
      store.set(task.id, { ...previous, ...patchFor(task, action, Date.now()) });
      return { previous };
    },
    onError: (_e, { task }, ctx) => useTaskEdits.getState().set(task.id, ctx?.previous),
    onSuccess: async (_ok, { task }) => {
      if (isMockData()) return;
      // The server copy now has the change; drop the local layer once the list has it.
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      await qc.invalidateQueries({ queryKey: ['dashboard', 'my-today'] });
      useTaskEdits.getState().set(task.id, undefined);
    },
  });
}

/** Put a task back exactly as it was before an action (toast Undo). API mode saves the old state. */
export function restoreTask(id: string, previous: Patch | undefined) {
  useTaskEdits.getState().set(id, previous);
  if (isMockData()) return;
  const base = useTaskEdits.getState().bases[id];
  if (!base) return;
  void api
    .call('taskUpdate', { params: { id }, body: { status: base.status, dueAt: base.dueAt ?? undefined } })
    .then(() => useTaskEdits.getState().set(id, undefined))
    .catch(() => undefined);
}
