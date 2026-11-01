import type { AttentionItem } from '@vistar/shared';
import type { FloorEmployee, FloorLocation, FloorState } from './types';

export interface FloorKpis {
  active: number;
  onCall: number;
  idle: number;
  busy: number;
  callsToday: number;
  leadsWaiting: number;
}

export function selectKpis(state: FloorState): FloorKpis {
  let active = 0;
  let onCall = 0;
  let idle = 0;
  let busy = 0;
  let callsToday = 0;
  for (const e of state.employees) {
    if (e.status !== 'offline') active++;
    if (e.status === 'on_call') onCall++;
    if (e.status === 'idle') idle++;
    if (e.status === 'busy') busy++;
    callsToday += e.callsToday;
  }
  return { active, onCall, idle, busy, callsToday, leadsWaiting: state.leadsWaiting.length + state.leadsWaitingExtra };
}

/** Where the employee is: calling room booth, lounge seat, own desk, or gone (offline). */
export function locationOf(state: FloorState, emp: FloorEmployee): FloorLocation {
  if (emp.status === 'offline') return { kind: 'gone' };
  if (emp.status === 'on_call') {
    const i = state.booths.indexOf(emp.id);
    if (i !== -1) return { kind: 'booth', index: i };
  }
  if (emp.status === 'away') {
    const i = state.lounge.indexOf(emp.id);
    if (i !== -1) return { kind: 'lounge', index: i };
  }
  return { kind: 'desk' };
}

export const LOCATION_LABEL: Record<FloorLocation['kind'], string> = {
  desk: 'At desk',
  booth: 'In the calling room',
  lounge: 'In the lounge',
  gone: 'Not in',
};

const SEVERITY_RANK: Record<AttentionItem['severity'], number> = { critical: 0, warning: 1, info: 2 };

/** "Needs you" list: critical first, newest first. */
export function selectNeedsYou(state: FloorState): AttentionItem[] {
  return [...state.attention].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/** Attention items grouped by employee id ('' = manager cabin). */
export function attentionByUser(state: FloorState): Map<string, AttentionItem[]> {
  const map = new Map<string, AttentionItem[]>();
  for (const item of state.attention) {
    const key = item.userId ?? '';
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

export function employeeById(state: FloorState, id: string | null): FloorEmployee | null {
  if (!id) return null;
  const i = state.index[id];
  return i === undefined ? null : (state.employees[i] ?? null);
}
