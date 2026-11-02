import { DAY_MS, istDayStart, MOCK_LEAD_COUNT } from '@vistar/shared/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockMe } from '../../session/mock';
import {
  listCalls,
  listConversations,
  listMessages,
  listNotifications,
  listTasks,
  listTeamMembers,
  listWorkflowRuns,
  markNotificationsRead,
  reportSummary,
  taskCounts,
  unreadConversations,
} from '../read';
import { viewerFromMe } from '../scope';
import { worldContext } from '../world';

// Relative imports only: apps/web has no vitest alias config for "@/".
const admin = viewerFromMe(mockMe('company_admin'));
const manager = viewerFromMe(mockMe('manager'));
const employee = viewerFromMe(mockMe('employee'));
const support = viewerFromMe(mockMe('company_admin', { impersonating: true }));

describe('mock world', () => {
  it('generates MOCK_LEAD_COUNT leads', () => {
    expect(worldContext().leads).toHaveLength(MOCK_LEAD_COUNT);
    expect(MOCK_LEAD_COUNT).toBe(2500);
  });

  it('tasks: own scope only returns my tasks; team scope stays inside the team', () => {
    const mine = listTasks({ limit: 5000 }, employee).items;
    expect(mine.length).toBeGreaterThan(50);
    expect(mine.every((t) => t.assignee?.id === employee.userId)).toBe(true);
    // An employee asking for the team still only sees their own tasks (data scope own).
    expect(listTasks({ scope: 'team', limit: 5000 }, employee).total).toBe(listTasks({ limit: 5000 }, employee).total);
    const team = listTasks({ scope: 'team', limit: 5000 }, manager).items;
    expect(team.every((t) => manager.visible!.has(t.assignee!.id))).toBe(true);
    expect(new Set(team.map((t) => t.assignee?.id)).size).toBeGreaterThan(1);
    expect(listTasks({ scope: 'team', limit: 5000 }, admin).total).toBeGreaterThan(team.length);
  });

  it('employee day: 8-15 calls to make and tasks due today, and counts match the list', () => {
    const now = Date.now();
    const endOfDay = istDayStart(now) + DAY_MS;
    const open = listTasks({ status: ['open'], limit: 5000 }, employee, now).items.filter((t) => t.dueAt && Date.parse(t.dueAt) < endOfDay);
    expect(open.filter((t) => t.type === 'call').length).toBeGreaterThanOrEqual(8);
    expect(open.filter((t) => t.type !== 'call').length).toBeGreaterThanOrEqual(8);
    const c = taskCounts('mine', employee, now);
    expect(c.overdue).toBe(listTasks({ due: 'overdue', limit: 5000 }, employee, now).total);
    expect(c.overdue + c.today).toBeGreaterThanOrEqual(open.length - 1);
  });

  it('calls: scoped on the caller, newest first', () => {
    const mine = listCalls({ limit: 5000 }, employee).items;
    expect(mine.length).toBeGreaterThan(20);
    expect(mine.every((c) => c.user?.id === employee.userId)).toBe(true);
    const all = listCalls({ limit: 5000 }, admin).items;
    expect(all.length).toBeGreaterThan(mine.length);
    for (let i = 1; i < 50; i++) expect(all[i - 1]!.startedAt >= all[i]!.startedAt).toBe(true);
  });

  it('inbox: scoped on the assignee; message bodies are hidden in a support session without content access', () => {
    const mine = listConversations({ limit: 5000 }, employee).items;
    expect(mine.length).toBeGreaterThan(5);
    expect(mine.every((c) => c.assignee?.id === employee.userId)).toBe(true);
    expect(unreadConversations(employee)).toBeLessThanOrEqual(mine.length);
    const first = listConversations({ limit: 1 }, support).items[0]!;
    expect(first.lastMessagePreview).toMatch(/hidden/i);
    expect(listMessages(first.id, support).every((m) => m.body === null || /hidden/i.test(m.body))).toBe(true);
    // Not shared with the employee: not found.
    const other = listConversations({ limit: 5000 }, admin).items.find((c) => c.assignee && c.assignee.id !== employee.userId)!;
    expect(() => listMessages(other.id, employee)).toThrow();
  });

  it('team, runs and reports respect the scope', () => {
    expect(listTeamMembers(employee).map((m) => m.user.id)).toEqual([employee.userId]);
    expect(listTeamMembers(manager).every((m) => manager.visible!.has(m.user.id))).toBe(true);
    expect(listTeamMembers(admin).length).toBe(worldContext().users.length);
    const runs = listWorkflowRuns({ limit: 5000 }, employee).items;
    expect(runs.every((r) => r.leadId && worldContext().leadById.get(r.leadId)?.owner?.id === employee.userId)).toBe(true);
    const now = Date.now();
    const r = reportSummary(now - 30 * DAY_MS, now, manager);
    expect(r.reps.every((x) => manager.visible!.has(x.user.id))).toBe(true);
    expect(r.funnel[0]!.count).toBeGreaterThan(0);
  });

  it('notifications: 25-40 per user, read marks stick', () => {
    const list = listNotifications(employee);
    expect(list.length).toBeGreaterThanOrEqual(25);
    expect(list.length).toBeLessThanOrEqual(40);
    const unread = list.filter((n) => !n.readAt);
    expect(unread.length).toBeGreaterThan(0);
    markNotificationsRead([unread[0]!.id], employee);
    expect(listNotifications(employee).filter((n) => !n.readAt)).toHaveLength(unread.length - 1);
    markNotificationsRead(undefined, employee);
    expect(listNotifications(employee).every((n) => n.readAt)).toBe(true);
    // Employees never see failed workflow notices (no workflows.read).
    expect(listNotifications(employee).some((n) => n.type === 'workflow_failed')).toBe(false);
  });
});

describe('mock DB v1 -> v2 upgrade', () => {
  const g = globalThis as { window?: unknown };
  afterEach(() => {
    delete g.window;
    vi.resetModules();
  });

  it('keeps v1 edits, adds the v2 seed and keeps the v1 key as a backup', async () => {
    // A v1 store as an existing browser has it, with user edits.
    vi.resetModules();
    const fresh = (await import('../../mock-db')).readMockDb();
    const { seed: _seed, notificationsRead: _read, ...rest } = structuredClone(fresh);
    const v1 = { ...rest, v: 1 as const };
    const stage = v1.state.pipelines[0]!.stages[1]!;
    stage.name = 'Called (edited)';
    v1.meta['user-edit'] = { createdAt: '2026-10-20T10:00:00.000Z', archivedAt: null };
    const storage = new Map<string, string>([['vistar.mock.db.v1', JSON.stringify(v1)]]);
    g.window = {
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
        removeItem: (k: string) => void storage.delete(k),
      },
    };
    vi.resetModules();
    const { readMockDb } = await import('../../mock-db');
    const db = readMockDb();
    expect(db.v).toBe(2);
    expect(db.state.pipelines[0]!.stages[1]!.name).toBe('Called (edited)');
    expect(db.meta['user-edit']).toBeDefined();
    expect(db.seed.upgradedFrom).toBe(1);
    expect(db.seed.leadCount).toBe(MOCK_LEAD_COUNT);
    expect(db.notificationsRead).toEqual({});
    // Every object that existed got sample records, once.
    for (const key of db.seed.objects) expect(db.records.filter((r) => r.objectKey === key).length).toBeGreaterThan(0);
    expect(JSON.parse(storage.get('vistar.mock.db.v2')!).v).toBe(2);
    expect(storage.has('vistar.mock.db.v1')).toBe(true);
  });
});
