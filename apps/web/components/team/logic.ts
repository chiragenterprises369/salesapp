import type { EmployeeStatus, UserSummary } from '@vistar/shared';

/** Team page helpers: filters, team grouping and totals. Tested in ./logic.test.ts. */

/** Same shape as TeamMemberRow in lib/world (kept structural so this file stays pure). */
export interface MemberRow {
  user: UserSummary;
  title: string;
  teamId: string | null;
  teamName: string | null;
  isManager: boolean;
  stats: { callsToday: number; talkSecToday: number; openLeads: number; openTasks: number; overdueTasks: number; wonInrThisMonth: number; dealsWonThisMonth: number };
  targetPct: number | null;
}

export type StatusFilter = 'all' | EmployeeStatus | 'away_offline';

export function filterMembers<T extends MemberRow>(rows: readonly T[], f: { q?: string; status?: StatusFilter }): T[] {
  const q = f.q?.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.status && f.status !== 'all') {
      if (f.status === 'away_offline' ? r.user.status !== 'away' && r.user.status !== 'offline' : r.user.status !== f.status) return false;
    }
    return !q || `${r.user.name} ${r.title} ${r.teamName ?? ''}`.toLowerCase().includes(q);
  });
}

export interface Totals {
  people: number;
  onCall: number;
  available: number;
  callsToday: number;
  openLeads: number;
  openTasks: number;
  overdueTasks: number;
  wonInr: number;
  deals: number;
  /** Average revenue target progress of people with a target, null if none. */
  avgTargetPct: number | null;
}

export function totals(rows: readonly MemberRow[]): Totals {
  const withTarget = rows.filter((r) => r.targetPct !== null);
  return {
    people: rows.length,
    onCall: rows.filter((r) => r.user.status === 'on_call').length,
    available: rows.filter((r) => r.user.status === 'idle').length,
    callsToday: rows.reduce((a, r) => a + r.stats.callsToday, 0),
    openLeads: rows.reduce((a, r) => a + r.stats.openLeads, 0),
    openTasks: rows.reduce((a, r) => a + r.stats.openTasks, 0),
    overdueTasks: rows.reduce((a, r) => a + r.stats.overdueTasks, 0),
    wonInr: rows.reduce((a, r) => a + r.stats.wonInrThisMonth, 0),
    deals: rows.reduce((a, r) => a + r.stats.dealsWonThisMonth, 0),
    avgTargetPct: withTarget.length ? Math.round(withTarget.reduce((a, r) => a + (r.targetPct ?? 0), 0) / withTarget.length) : null,
  };
}

export interface TeamGroup<T extends MemberRow> {
  id: string;
  name: string;
  manager: UserSummary | null;
  members: T[];
  totals: Totals;
}

const ROLE_ORDER: Record<string, number> = { company_admin: 0, manager: 1, employee: 2, viewer: 3 };

/** Teams in name order, manager first then by name; people without a team last ("No team"). */
export function groupByTeam<T extends MemberRow>(rows: readonly T[]): TeamGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.teamId ?? '';
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  const groups = [...map.entries()].map(([id, members]) => {
    members.sort((a, b) => Number(b.isManager) - Number(a.isManager) || (ROLE_ORDER[a.user.role] ?? 9) - (ROLE_ORDER[b.user.role] ?? 9) || a.user.name.localeCompare(b.user.name));
    return {
      id: id || 'none',
      name: id ? (members[0]!.teamName ?? 'Team') : 'No team',
      manager: members.find((m) => m.isManager)?.user ?? null,
      members,
      totals: totals(members),
    };
  });
  return groups.sort((a, b) => (a.id === 'none' ? 1 : b.id === 'none' ? -1 : a.name.localeCompare(b.name)));
}
