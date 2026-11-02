import { APP_SCREENS, EVENT_NAMES, SYNC_SCOPES } from '@vistar/shared';
import { describe, expect, it } from 'vitest';
import { activityFor, IDLE_AFTER_MS, knownScopes, leadIdForPath, scopesForEvent, screenForPath } from '../logic';

const LEAD = '0190f5a0-1111-7000-8000-000000000001';

describe('screenForPath', () => {
  it.each([
    ['/app', '', 'home'],
    ['/me', '', 'home'],
    ['/app/leads', '', 'board'],
    ['/app/leads', '?view=table', 'leads'],
    ['/me/leads', '', 'leads'],
    [`/app/leads/${LEAD}`, '', 'lead_detail'],
    ['/app/leads', `?lead=${LEAD}`, 'lead_detail'],
    ['/app/calls', '', 'calls'],
    ['/me/calls', '', 'calls'],
    ['/app/inbox', '', 'inbox'],
    ['/app/inbox', '?c=abc', 'conversation'],
    ['/app/tasks', '', 'tasks'],
    ['/app/team-floor', '', 'team_floor'],
    ['/me/team-floor', '', 'team_floor'],
    ['/app/reports', '', 'reports'],
    ['/me/performance', '', 'reports'],
    ['/app/settings/roles', '', 'settings'],
    ['/me/preferences', '', 'settings'],
    ['/app/workflows', '', 'other'],
    ['/login', '', 'other'],
    ['/super-admin', '', 'other'],
  ])('%s%s -> %s', (path, search, screen) => {
    expect(screenForPath(path, search)).toBe(screen);
  });

  it('only returns contract screens', () => {
    for (const p of ['/app', '/app/x/y', '/me/more', '/', '/app/leads/not-a-uuid']) expect(APP_SCREENS).toContain(screenForPath(p));
  });
});

describe('leadIdForPath', () => {
  it('reads the lead from the detail route or the drawer query', () => {
    expect(leadIdForPath(`/me/leads/${LEAD}`)).toBe(LEAD);
    expect(leadIdForPath('/app/leads', `?view=table&lead=${LEAD}`)).toBe(LEAD);
  });
  it('ignores anything that is not a UUID', () => {
    expect(leadIdForPath('/app/leads/new')).toBeNull();
    expect(leadIdForPath('/app/leads', '?lead=1')).toBeNull();
    expect(leadIdForPath('/app/tasks')).toBeNull();
  });
});

describe('activityFor', () => {
  const now = 10_000_000;
  it('hidden wins over input', () => expect(activityFor(true, now, now)).toBe('hidden'));
  it('active right after input', () => expect(activityFor(false, now - 1_000, now)).toBe('active'));
  it('idle after 2 minutes without input', () => {
    expect(activityFor(false, now - IDLE_AFTER_MS, now)).toBe('active');
    expect(activityFor(false, now - IDLE_AFTER_MS - 1, now)).toBe('idle');
  });
});

describe('scopesForEvent', () => {
  it('maps every contract event to known sync scopes', () => {
    const scopes = new Set<string>(SYNC_SCOPES);
    for (const name of EVENT_NAMES) for (const s of scopesForEvent(name)) expect(scopes.has(s)).toBe(true);
  });
  it('lead and stage events refresh lists, boards and the dashboard', () => {
    expect(scopesForEvent('stage.changed')).toEqual(['leads', 'board', 'dashboard']);
    expect(scopesForEvent('lead.assigned')).toContain('board');
  });
  it('presence and calls refresh the floor', () => {
    expect(scopesForEvent('employee.status_changed')).toContain('team-floor');
    expect(scopesForEvent('employee.zone_changed')).toContain('team-floor');
    expect(scopesForEvent('call.ended')).toEqual(['calls', 'dashboard', 'team-floor']);
  });
  it('messages, tasks and notifications have their own scopes', () => {
    expect(scopesForEvent('message.received')).toEqual(['conversations']);
    expect(scopesForEvent('task.updated')).toEqual(['tasks', 'dashboard']);
    expect(scopesForEvent('notification.created')).toEqual(['notifications']);
  });
  it('covers every event name (no silent gaps)', () => {
    const uncovered = EVENT_NAMES.filter((n) => scopesForEvent(n).length === 0);
    expect(uncovered).toEqual([]);
  });
});

describe('knownScopes', () => {
  it('drops unknown names and duplicates', () => {
    expect(knownScopes(['leads', 'nope', 'leads', 'team-floor'])).toEqual(['leads', 'team-floor']);
  });
});
