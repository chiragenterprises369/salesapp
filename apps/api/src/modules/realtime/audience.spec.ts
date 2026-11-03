import { EVENT_NAMES, type DomainEvent } from '@vistar/shared';
import { describe, expect, it } from 'vitest';
import { AUDIENCE_RULES, audienceOf, lostVisibility, maySee, type SocketViewer } from './audience.js';

const W = '0190a000-0000-7000-8000-000000000001';
const OTHER_W = '0190a000-0000-7000-8000-000000000002';
const EMP = '0190a000-0000-7000-8000-0000000000e1';
const EMP2 = '0190a000-0000-7000-8000-0000000000e2';
const MGR = '0190a000-0000-7000-8000-0000000000a1';
const ADMIN = '0190a000-0000-7000-8000-0000000000ad';

const perms = (...p: string[]) => new Set(p);
const BASE = ['leads.read', 'tasks.read', 'calls.read', 'messages.read', 'records.read'];
const employee: SocketViewer = { userId: EMP, workspaceId: W, visibleUserIds: new Set([EMP]), permissions: perms(...BASE) };
const manager: SocketViewer = { userId: MGR, workspaceId: W, visibleUserIds: new Set([MGR, EMP]), permissions: perms(...BASE, 'messages.team_inbox', 'workflows.read') };
const admin: SocketViewer = { userId: ADMIN, workspaceId: W, visibleUserIds: null, permissions: perms(...BASE, 'workflows.read', 'webhooks.manage', 'webhooks.read', 'integrations.read', 'leads.import') };

const summary = (id: string) => ({ id, name: 'X', role: 'employee' as const, status: 'idle' as const, avatar: null });
const env = <T extends DomainEvent['type']>(type: T, payload: unknown, extra: Partial<DomainEvent> = {}): DomainEvent =>
  ({ id: 'e', type, workspaceId: W, occurredAt: new Date().toISOString(), actor: null, userId: null, payload, ...extra }) as DomainEvent;

const lead = (ownerId: string | null) => ({ lead: { id: 'l', owner: ownerId ? summary(ownerId) : null } });

describe('realtime audience (scope-aware fan-out)', () => {
  it('every event name has an explicit rule', () => {
    for (const name of EVENT_NAMES) expect(AUDIENCE_RULES[name], name).toBeTypeOf('function');
  });

  it('lead events follow the REST scope: own, team, all', () => {
    const e = env('lead.updated', { ...lead(EMP2), changed: [] });
    const a = audienceOf(e);
    expect(maySee(employee, e, a)).toBe(false);
    expect(maySee(manager, e, a)).toBe(false);
    expect(maySee(admin, e, a)).toBe(true);
    const mine = env('lead.updated', { ...lead(EMP), changed: [] });
    expect(maySee(employee, mine, audienceOf(mine))).toBe(true);
    expect(maySee(manager, mine, audienceOf(mine))).toBe(true);
  });

  it('unassigned leads are visible to scope all only', () => {
    const e = env('lead.created', lead(null));
    expect(maySee(employee, e, audienceOf(e))).toBe(false);
    expect(maySee(manager, e, audienceOf(e))).toBe(false);
    expect(maySee(admin, e, audienceOf(e))).toBe(true);
  });

  it('another workspace never receives anything', () => {
    const e = env('lead.deleted', { leadIds: ['x'] }, { workspaceId: OTHER_W });
    expect(maySee(admin, e, audienceOf(e))).toBe(false);
  });

  it('events addressed to one user (envelope userId) reach only that user', () => {
    const e = env('notification.created', { notification: {} }, { userId: EMP });
    expect(maySee(employee, e, audienceOf(e))).toBe(true);
    expect(maySee(admin, e, audienceOf(e))).toBe(false);
  });

  it('presence of a colleague outside the scope is not sent', () => {
    const e = env('employee.status_changed', { userId: EMP2 });
    expect(maySee(employee, e, audienceOf(e))).toBe(false);
    expect(maySee(admin, e, audienceOf(e))).toBe(true);
    const own = env('employee.status_changed', { userId: EMP });
    expect(maySee(employee, own, audienceOf(own))).toBe(true);
    expect(maySee(manager, own, audienceOf(own))).toBe(true);
  });

  it('a missing permission blocks even in scope', () => {
    const noCalls: SocketViewer = { ...employee, permissions: perms('leads.read') };
    const e = env('call.started', { call: { user: summary(EMP) } });
    expect(maySee(noCalls, e, audienceOf(e))).toBe(false);
    expect(maySee(employee, e, audienceOf(e))).toBe(true);
  });

  it('unassigned conversations go to team inbox holders and scope all', () => {
    const e = env('message.received', { conversation: { assignee: null }, message: {} });
    expect(maySee(employee, e, audienceOf(e))).toBe(false);
    expect(maySee(manager, e, audienceOf(e))).toBe(true);
    expect(maySee(admin, e, audienceOf(e))).toBe(true);
  });

  it('activity on a lead uses the looked-up owner; unknown owner falls back to scope all', () => {
    const e = env('activity.created', { activity: { leadId: 'l1' } });
    const a = audienceOf(e);
    expect(a).toEqual({ kind: 'lead', leadId: 'l1', fallbackOwnerIds: [] });
    expect(maySee(employee, e, a, EMP)).toBe(true);
    expect(maySee(employee, e, a, EMP2)).toBe(false);
    expect(maySee(employee, e, a, undefined)).toBe(false);
    expect(maySee(admin, e, a, undefined)).toBe(true);
  });

  it('workspace KPIs only for scope all; workflow runs by permission', () => {
    const k = env('dashboard.kpis_updated', {});
    expect(maySee(manager, k, audienceOf(k))).toBe(false);
    expect(maySee(admin, k, audienceOf(k))).toBe(true);
    const w = env('workflow.failed', {});
    expect(maySee(employee, w, audienceOf(w))).toBe(false);
    expect(maySee(manager, w, audienceOf(w))).toBe(true);
  });

  it('attendance and location reach the person and managers in scope, not colleagues', () => {
    const e = env('location.updated', { userId: EMP, sessionId: 's', point: {} });
    const colleague: SocketViewer = { ...employee, userId: EMP2, visibleUserIds: new Set([EMP2]) };
    expect(maySee(employee, e, audienceOf(e))).toBe(true);
    expect(maySee(colleague, e, audienceOf(e))).toBe(false);
    const mgr: SocketViewer = { ...manager, permissions: perms(...manager.permissions, 'team.read') };
    expect(maySee(mgr, e, audienceOf(e))).toBe(true);
    expect(maySee(manager, e, audienceOf(e))).toBe(false); // no team.read
    const adm: SocketViewer = { ...admin, permissions: perms(...admin.permissions, 'team.read') };
    expect(maySee(adm, e, audienceOf(e))).toBe(true);
  });

  it('losing a lead to someone outside the scope means a resync, not the payload', () => {
    const e = env('lead.assigned', { ...lead(EMP2), fromUserId: EMP, toUserId: EMP2, rule: 'manual' });
    expect(maySee(employee, e, audienceOf(e))).toBe(false);
    expect(lostVisibility(employee, e)).toBe(true);
    expect(lostVisibility(admin, e)).toBe(false);
    expect(lostVisibility(manager, e)).toBe(true);
  });
});
