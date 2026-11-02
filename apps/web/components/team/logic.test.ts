import { describe, expect, it } from 'vitest';
import { mockMe } from '../../lib/session/mock';
import { listTargets, listTeamMembers } from '../../lib/world/read';
import { viewerFromMe } from '../../lib/world/scope';
import { periodsFor, sumMetric, targetRows } from '../targets/logic';
import { filterMembers, groupByTeam, totals } from './logic';

const NOW = Date.now();
const admin = viewerFromMe(mockMe('company_admin'));
const manager = viewerFromMe(mockMe('manager'));
const employee = viewerFromMe(mockMe('employee'));

describe('team page scope (through lib/world)', () => {
  it('admins see everyone, grouped by team with a "No team" group last', () => {
    const rows = listTeamMembers(admin, NOW);
    expect(rows).toHaveLength(12);
    const groups = groupByTeam(rows);
    expect(groups.map((g) => g.name)).toEqual(['Inside Sales', 'Key Accounts', 'No team']);
    expect(groups[0]!.members[0]!.isManager).toBe(true);
    expect(groups.reduce((a, g) => a + g.members.length, 0)).toBe(12);
  });

  it('managers see only their own team', () => {
    const rows = listTeamMembers(manager, NOW);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => manager.visible!.has(r.user.id))).toBe(true);
    const groups = groupByTeam(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.manager?.id).toBe(manager.userId);
  });

  it('employees only see themselves', () => {
    const rows = listTeamMembers(employee, NOW);
    expect(rows.map((r) => r.user.id)).toEqual([employee.userId]);
  });

  it('totals add up the cards and filters narrow them', () => {
    const rows = listTeamMembers(admin, NOW);
    const t = totals(rows);
    expect(t.people).toBe(12);
    expect(t.callsToday).toBe(rows.reduce((a, r) => a + r.stats.callsToday, 0));
    expect(t.onCall).toBe(rows.filter((r) => r.user.status === 'on_call').length);
    expect(filterMembers(rows, { status: 'on_call' }).every((r) => r.user.status === 'on_call')).toBe(true);
    expect(filterMembers(rows, { status: 'away_offline' }).every((r) => r.user.status === 'away' || r.user.status === 'offline')).toBe(true);
    expect(filterMembers(rows, { q: 'key accounts' }).every((r) => r.teamName === 'Key Accounts')).toBe(true);
  });
});

describe('targets scope and rows (through lib/world)', () => {
  const { current, previous } = periodsFor(NOW);

  it('managers see their team target and their people, not the other team', () => {
    const rows = targetRows(listTargets(undefined, manager), current, previous);
    const teams = rows.filter((r) => r.subjectType === 'team');
    expect(teams.map((t) => t.subjectName)).toEqual(['Inside Sales']);
    expect(rows.filter((r) => r.subjectType === 'user').every((r) => manager.visible!.has(r.subjectId))).toBe(true);
  });

  it('employees see only their own targets', () => {
    const rows = targetRows(listTargets(undefined, employee), current, previous);
    expect(rows.map((r) => r.subjectId)).toEqual([employee.userId]);
  });

  it('rows carry four metrics with the previous month, and sums match', () => {
    const all = listTargets(undefined, admin);
    const rows = targetRows(all, current, previous);
    expect(rows[0]!.subjectType).toBe('team');
    const rep = rows.find((r) => r.subjectType === 'user')!;
    expect(Object.keys(rep.metrics).sort()).toEqual(['calls', 'deals_won', 'leads_converted', 'revenue_inr']);
    expect(rep.metrics.revenue_inr!.prevPct).not.toBeNull();
    const s = sumMetric(rows, 'calls');
    const expected = all.filter((t) => t.period === current && t.subjectType === 'user' && t.metric === 'calls');
    expect(s.target).toBe(expected.reduce((a, t) => a + t.target, 0));
    expect(s.achieved).toBe(expected.reduce((a, t) => a + t.achieved, 0));
  });
});
