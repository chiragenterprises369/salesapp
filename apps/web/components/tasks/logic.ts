import type { Task, TaskType } from '@vistar/shared';
import { DAY_MS, istDayStart, istWeekday } from '@vistar/shared/fixtures';

/**
 * Pure task helpers for the Tasks page (no React, no session): scope, due buckets, filters, counts
 * and the week calendar. Unit-tested in ./logic.test.ts.
 */

/** Who is looking: same shape as `Viewer` in lib/world (visible = user ids in scope, null = everyone). */
export interface ScopeViewer {
  userId: string | null;
  visible: ReadonlySet<string> | null;
}

export const inScope = (v: ScopeViewer, userId: string | null | undefined) => v.visible === null || (!!userId && v.visible.has(userId));

export type TaskTab = 'mine' | 'team';
export type TaskBucket = 'open' | 'overdue' | 'today' | 'upcoming' | 'done';
export type TaskTypeFilter = TaskType | 'all' | 'workflow';

/** "My tasks" = assigned to me; "Team tasks" = everything in my data scope (own / team / all). */
export function scopeTasks(tasks: readonly Task[], tab: TaskTab, v: ScopeViewer): Task[] {
  if (!v.userId) return [];
  return tasks.filter((t) => (tab === 'mine' ? t.assignee?.id === v.userId : inScope(v, t.assignee?.id)));
}

/** Where a task sits relative to `now` (workspace calendar = IST). */
export function dueState(t: Task, now: number): 'overdue' | 'today' | 'upcoming' | 'done' | 'cancelled' {
  if (t.status === 'done') return 'done';
  if (t.status === 'cancelled') return 'cancelled';
  if (!t.dueAt) return 'upcoming';
  const due = Date.parse(t.dueAt);
  const dayEnd = istDayStart(now) + DAY_MS;
  if (due < now) return 'overdue';
  if (due < dayEnd) return 'today';
  return 'upcoming';
}

export function inBucket(t: Task, bucket: TaskBucket, now: number): boolean {
  const s = dueState(t, now);
  if (bucket === 'done') return s === 'done';
  if (bucket === 'open') return s === 'overdue' || s === 'today' || s === 'upcoming';
  return s === bucket;
}

export type BucketCounts = Record<TaskBucket, number>;

export function bucketCounts(tasks: readonly Task[], now: number): BucketCounts {
  const c: BucketCounts = { open: 0, overdue: 0, today: 0, upcoming: 0, done: 0 };
  for (const t of tasks) {
    const s = dueState(t, now);
    if (s === 'cancelled') continue;
    if (s === 'done') c.done++;
    else {
      c.open++;
      c[s]++;
    }
  }
  return c;
}

export interface TaskFilter {
  q?: string;
  assigneeId?: string;
  type?: TaskTypeFilter;
}

export function matchesFilter(t: Task, f: TaskFilter): boolean {
  if (f.assigneeId && f.assigneeId !== 'all' && t.assignee?.id !== f.assigneeId) return false;
  if (f.type === 'workflow' && t.source !== 'workflow') return false;
  if (f.type && f.type !== 'all' && f.type !== 'workflow' && t.type !== f.type) return false;
  const q = f.q?.trim().toLowerCase();
  if (q && !`${t.title} ${t.leadName ?? ''} ${t.notes ?? ''} ${t.assignee?.name ?? ''}`.toLowerCase().includes(q)) return false;
  return true;
}

const time = (iso: string | null) => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);

/** Open tasks by due time (soonest first), done tasks by completion (newest first). */
export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ad = a.status === 'done' ? 1 : 0;
    const bd = b.status === 'done' ? 1 : 0;
    if (ad !== bd) return ad - bd;
    if (ad) return (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt);
    return time(a.dueAt) - time(b.dueAt);
  });
}

export function filterTasks(tasks: readonly Task[], bucket: TaskBucket, f: TaskFilter, now: number): Task[] {
  return sortTasks(tasks.filter((t) => t.status !== 'cancelled' && inBucket(t, bucket, now) && matchesFilter(t, f)));
}

/** Monday 00:00 IST of the week containing `t`, shifted by `offset` weeks. */
export function weekStart(t: number, offset = 0): number {
  return istDayStart(t) - istWeekday(t) * DAY_MS + offset * 7 * DAY_MS;
}

/** Seven day buckets (Mon..Sun) of tasks due in the week that starts at `start`. Done tasks stay on their due day. */
export function groupByWeekDay(tasks: readonly Task[], start: number): Task[][] {
  const days: Task[][] = Array.from({ length: 7 }, () => []);
  for (const t of tasks) {
    if (!t.dueAt || t.status === 'cancelled') continue;
    const i = Math.floor((Date.parse(t.dueAt) - start) / DAY_MS);
    if (i >= 0 && i < 7) days[i]!.push(t);
  }
  for (const d of days) d.sort((a, b) => time(a.dueAt) - time(b.dueAt));
  return days;
}

/** Snooze presets relative to now (IST): in 1 hour, tomorrow 10:00, next Monday 10:00. */
export function snoozeOptions(now: number): Array<{ key: string; label: string; until: number }> {
  const today = istDayStart(now);
  const tenAm = 10 * 60 * 60_000;
  return [
    { key: '1h', label: 'In 1 hour', until: now + 60 * 60_000 },
    { key: '3h', label: 'In 3 hours', until: now + 3 * 60 * 60_000 },
    { key: 'tomorrow', label: 'Tomorrow, 10 am', until: today + DAY_MS + tenAm },
    { key: 'next-week', label: 'Next Monday, 10 am', until: weekStart(now, 1) + tenAm },
  ];
}
