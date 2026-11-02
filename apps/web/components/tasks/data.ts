'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { Task } from '@vistar/shared';
import { useMemo } from 'react';
import { create } from 'zustand';
import { listTasks, viewerFromMe, type Viewer } from '@/components/reports/world-interim';
import { useMe } from '@/lib/session/session';
import type { TaskTab } from './logic';

/**
 * Tasks page data adapter. Reads the mock world (GET /tasks?scope=mine|team, data scope applied by
 * the reader) and layers local edits on top (complete, reopen, snooze), so actions are optimistic and
 * survive client navigation. Wave 3: the mutations become PATCH /tasks/{id} and POST /tasks/{id}/snooze.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useViewer(): Viewer {
  const me = useMe();
  return useMemo(() => viewerFromMe(me), [me]);
}

type Patch = Partial<Pick<Task, 'status' | 'completedAt' | 'dueAt' | 'snoozedUntil' | 'updatedAt'>>;

interface TaskEdits {
  patches: Record<string, Patch>;
  set: (id: string, patch: Patch | undefined) => void;
}

/** Local task edits (the mock "server" state for this browser tab). */
export const useTaskEdits = create<TaskEdits>()((set) => ({
  patches: {},
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
  const v = useViewer();
  const query = useQuery({
    queryKey: ['tasks', 'pages', v.userId, tab],
    queryFn: async () => (await wait(220), listTasks({ scope: tab, limit: 10_000 }, v).items),
    enabled: !!v.userId,
  });
  const patches = useTaskEdits((s) => s.patches);
  const data = useMemo(() => (query.data ? applyPatches(query.data, patches) : undefined), [query.data, patches]);
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
export function useTaskAction() {
  return useMutation({
    mutationFn: async (_vars: { task: Task; action: TaskAction }) => {
      await wait(250);
      return true;
    },
    onMutate: ({ task, action }) => {
      const store = useTaskEdits.getState();
      const previous = store.patches[task.id];
      store.set(task.id, { ...previous, ...patchFor(task, action, Date.now()) });
      return { previous };
    },
    onError: (_e, { task }, ctx) => useTaskEdits.getState().set(task.id, ctx?.previous),
  });
}

/** Put a task back exactly as it was before an action (toast Undo). */
export function restoreTask(id: string, previous: Patch | undefined) {
  useTaskEdits.getState().set(id, previous);
}
