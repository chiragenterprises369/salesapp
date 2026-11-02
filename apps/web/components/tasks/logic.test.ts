import type { Task } from '@vistar/shared';
import { createWorldContext, DAY_MS, istDayStart, mockTeams, mockUsers, worldTasks } from '@vistar/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { bucketCounts, dueState, filterTasks, groupByWeekDay, inScope, matchesFilter, scopeTasks, snoozeOptions, weekStart, type ScopeViewer } from './logic';

const NOW = Date.parse('2026-11-02T06:30:00.000Z'); // Mon 2 Nov 2026, 12:00 IST
const ctx = createWorldContext({ now: NOW });
const tasks = worldTasks(ctx);
const users = mockUsers();
const admin = users.find((u) => u.role === 'company_admin')!;
const manager = users.find((u) => u.name === 'Priya Sharma')!;
const rep = users.find((u) => u.name === 'Rohit Verma')!;
const team = mockTeams().find((t) => t.managerId === manager.id)!;

const viewers: Record<'admin' | 'manager' | 'employee', ScopeViewer> = {
  admin: { userId: admin.id, visible: null },
  manager: { userId: manager.id, visible: new Set(team.memberIds) },
  employee: { userId: rep.id, visible: new Set([rep.id]) },
};

const task = (over: Partial<Task>): Task => ({ ...tasks[0]!, status: 'open', completedAt: null, snoozedUntil: null, ...over });

describe('task scope filters', () => {
  it('employees see only their own tasks, in both tabs', () => {
    const mine = scopeTasks(tasks, 'mine', viewers.employee);
    const teamTab = scopeTasks(tasks, 'team', viewers.employee);
    expect(mine.length).toBeGreaterThan(50);
    expect(mine.every((t) => t.assignee?.id === rep.id)).toBe(true);
    expect(teamTab.map((t) => t.id)).toEqual(mine.map((t) => t.id));
  });

  it('managers see their team only on the team tab', () => {
    const rows = scopeTasks(tasks, 'team', viewers.manager);
    const owners = new Set(rows.map((t) => t.assignee?.id));
    expect([...owners].every((id) => !!id && team.memberIds.includes(id))).toBe(true);
    expect(owners.size).toBeGreaterThan(2);
    expect(rows.length).toBeLessThan(tasks.length);
    expect(scopeTasks(tasks, 'mine', viewers.manager).every((t) => t.assignee?.id === manager.id)).toBe(true);
  });

  it('admins see every assigned task on the team tab and none of others on "mine"', () => {
    expect(scopeTasks(tasks, 'team', viewers.admin).length).toBe(tasks.filter((t) => t.assignee).length);
    expect(scopeTasks(tasks, 'mine', viewers.admin).every((t) => t.assignee?.id === admin.id)).toBe(true);
  });

  it('nobody signed in sees nothing; unassigned records need all scope', () => {
    expect(scopeTasks(tasks, 'team', { userId: null, visible: null })).toEqual([]);
    expect(inScope(viewers.manager, null)).toBe(false);
    expect(inScope(viewers.admin, null)).toBe(true);
  });
});

describe('due buckets', () => {
  const today = istDayStart(NOW);
  it('classifies overdue, today, upcoming and done in IST', () => {
    expect(dueState(task({ dueAt: new Date(NOW - 60_000).toISOString() }), NOW)).toBe('overdue');
    expect(dueState(task({ dueAt: new Date(today + DAY_MS - 60_000).toISOString() }), NOW)).toBe('today');
    expect(dueState(task({ dueAt: new Date(today + DAY_MS + 60_000).toISOString() }), NOW)).toBe('upcoming');
    expect(dueState(task({ status: 'done' }), NOW)).toBe('done');
  });

  it('counts add up and filters match the counts', () => {
    const mine = scopeTasks(tasks, 'mine', viewers.employee);
    const c = bucketCounts(mine, NOW);
    expect(c.open).toBe(c.overdue + c.today + c.upcoming);
    expect(filterTasks(mine, 'overdue', {}, NOW).length).toBe(c.overdue);
    expect(filterTasks(mine, 'done', {}, NOW).length).toBe(c.done);
    expect(filterTasks(mine, 'open', {}, NOW).length).toBe(c.open);
  });

  it('sorts open tasks by due time', () => {
    const rows = filterTasks(scopeTasks(tasks, 'team', viewers.admin), 'open', {}, NOW);
    for (let i = 1; i < rows.length; i++) expect(Date.parse(rows[i - 1]!.dueAt!)).toBeLessThanOrEqual(Date.parse(rows[i]!.dueAt!));
  });
});

describe('filters', () => {
  it('search matches title, lead and owner; type "workflow" keeps workflow tasks', () => {
    const t = task({ title: 'Call Kavita', leadName: 'Kavita Banerjee', source: 'workflow', type: 'call' });
    expect(matchesFilter(t, { q: 'banerjee' })).toBe(true);
    expect(matchesFilter(t, { q: 'nobody' })).toBe(false);
    expect(matchesFilter(t, { type: 'workflow' })).toBe(true);
    expect(matchesFilter({ ...t, source: 'manual' }, { type: 'workflow' })).toBe(false);
    expect(matchesFilter(t, { type: 'meeting' })).toBe(false);
    expect(matchesFilter(t, { assigneeId: 'someone-else' })).toBe(false);
  });

  it('the world has workflow call tasks to mark', () => {
    expect(tasks.some((t) => t.source === 'workflow' && t.type === 'call')).toBe(true);
  });
});

describe('week calendar and snooze', () => {
  it('weeks start on Monday 00:00 IST', () => {
    const start = weekStart(NOW);
    expect(start).toBe(istDayStart(NOW)); // 2 Nov 2026 is a Monday
    expect(weekStart(NOW, 1) - start).toBe(7 * DAY_MS);
  });

  it('groups tasks into seven days by due time', () => {
    const start = weekStart(NOW);
    const days = groupByWeekDay(tasks, start);
    expect(days).toHaveLength(7);
    for (const [i, d] of days.entries())
      for (const t of d) {
        const due = Date.parse(t.dueAt!);
        expect(due).toBeGreaterThanOrEqual(start + i * DAY_MS);
        expect(due).toBeLessThan(start + (i + 1) * DAY_MS);
      }
  });

  it('snooze presets are all in the future', () => {
    expect(snoozeOptions(NOW).every((o) => o.until > NOW)).toBe(true);
  });
});
