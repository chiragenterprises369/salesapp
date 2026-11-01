'use client';

import type { Activity, Task, UserSummary } from '@vistar/shared';
import { create } from 'zustand';

/**
 * Activities and tasks created in this browser session (mock). Wave 3: POST /leads/{id}/notes etc.
 * plus `activity.created` events patch the timeline query instead.
 */
type NewActivity = Activity extends infer A
  ? A extends Activity
    ? Omit<A, 'id' | 'createdAt' | 'leadId'>
    : never
  : never;

interface LocalActivity {
  activities: Record<string, Activity[]>;
  tasks: Record<string, Task[]>;
  /** Task id -> done (overrides mock state). */
  done: Record<string, boolean>;
  add: (leadId: string, activity: NewActivity) => void;
  addTask: (leadId: string, task: Task) => void;
  setDone: (taskId: string, done: boolean) => void;
}

export const useLocalActivity = create<LocalActivity>()((set) => ({
  activities: {},
  tasks: {},
  done: {},
  add: (leadId, activity) =>
    set((s) => ({
      activities: {
        ...s.activities,
        [leadId]: [
          {
            ...activity,
            id: crypto.randomUUID(),
            leadId,
            createdAt: new Date().toISOString(),
          } as Activity,
          ...(s.activities[leadId] ?? []),
        ],
      },
    })),
  addTask: (leadId, task) =>
    set((s) => ({ tasks: { ...s.tasks, [leadId]: [task, ...(s.tasks[leadId] ?? [])] } })),
  setDone: (taskId, done) => set((s) => ({ done: { ...s.done, [taskId]: done } })),
}));

export function actorFrom(
  user: {
    id: string;
    name: string;
    role: UserSummary['role'];
    status: UserSummary['status'];
  } | null,
): UserSummary | null {
  return user
    ? { id: user.id, name: user.name, role: user.role, status: user.status, avatar: null }
    : null;
}
