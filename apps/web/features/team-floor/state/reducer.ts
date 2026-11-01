import {
  formatDuration,
  type AttentionItem,
  type CallOutcome,
  type ChipTone,
  type DomainEvent,
  type EmployeeStatus,
  type Task,
  type TeamFloorSnapshot,
} from '@vistar/shared';
import { getLayout, MAX_DESKS } from './layout';
import type { FloorAction, FloorActivity, FloorEffect, FloorEmployee, FloorState } from './types';

/**
 * Pure Team Floor reducer. Both the 3D scene and the flat view render from FloorState.
 * Wave 1 feeds it mock simulator events; Wave 3 feeds socket events unchanged.
 * `now` is the local receive time (epoch ms) used for transient effects only.
 */

const RECENT_MAX = 8;
const LOG_MAX = 40;
const EFFECTS_MAX = 80;
const ATTENTION_MAX = 60;

export const EFFECT_TTL_MS: Record<FloorEffect['kind'], number> = {
  parcel_spawn: 2500,
  delivery: 30_000,
  call_started: 2500,
  call_outcome: 3600,
  wave: 2200,
};

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  answered: 'Answered',
  missed: 'Missed',
  interested: 'Interested',
  not_interested: 'Not interested',
  callback: 'Callback',
  wrong_number: 'Wrong number',
  voicemail: 'Voicemail',
};

export const OUTCOME_TONE: Record<CallOutcome, ChipTone> = {
  answered: 'green',
  interested: 'green',
  callback: 'blue',
  missed: 'red',
  not_interested: 'grey',
  wrong_number: 'grey',
  voicemail: 'grey',
};

const STATUS_ACTIVITY_TONE: Record<EmployeeStatus, ChipTone> = {
  on_call: 'blue',
  idle: 'green',
  busy: 'amber',
  away: 'grey',
  offline: 'grey',
};

const parseTime = (iso: string | null | undefined, fallback: number) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : fallback;
};

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

export interface InitOptions {
  /** Manager team scope; null = whole workspace. */
  userIds?: readonly string[] | null;
}

export function initialFloorState(snapshot: TeamFloorSnapshot, opts: InitOptions = {}): FloorState {
  const generated = parseTime(snapshot.generatedAt, 0);
  const scope = opts.userIds ? new Set(opts.userIds) : null;
  const source = snapshot.employees.filter((e) => !scope || scope.has(e.user.id));

  // Stable unique desks: keep deskIndex when free and in range, else the next free slot.
  const used = new Set<number>();
  const deskOf = source.map((e) => {
    if (e.deskIndex < MAX_DESKS && !used.has(e.deskIndex)) {
      used.add(e.deskIndex);
      return e.deskIndex;
    }
    return -1;
  });
  let cursor = 0;
  for (let i = 0; i < deskOf.length; i++) {
    if (deskOf[i] !== -1) continue;
    while (used.has(cursor)) cursor++;
    used.add(cursor);
    deskOf[i] = cursor;
  }
  const deskCount = deskOf.reduce((m, d) => Math.max(m, d + 1), 1);
  const layout = getLayout(deskCount);

  const employees: FloorEmployee[] = source.map((e, i) => ({
    id: e.user.id,
    name: e.user.name,
    role: e.user.role,
    avatar: e.user.avatar,
    desk: deskOf[i] ?? i,
    status: e.status,
    statusSince: e.activeCall ? parseTime(e.activeCall.startedAt, generated) : null,
    currentLeadId: e.currentLeadId,
    currentLeadName: e.currentLeadName,
    activeCall: e.activeCall
      ? { callId: e.activeCall.callId, startedAt: parseTime(e.activeCall.startedAt, generated), leadName: e.activeCall.leadName }
      : null,
    callsToday: e.callsToday,
    avgTalkSec: e.avgTalkSec,
    talkedCalls: e.callsToday,
    targetPct: e.targetPct,
    recent: [],
  }));
  const index: Record<string, number> = {};
  employees.forEach((e, i) => (index[e.id] = i));

  const booths: (string | null)[] = layout.booths.map(() => null);
  const lounge: (string | null)[] = layout.lounge.map(() => null);
  for (const e of employees) {
    if (e.status === 'on_call') allocate(booths, e.id);
    if (e.status === 'away') allocate(lounge, e.id);
  }

  return {
    employees,
    index,
    deskCount,
    booths,
    lounge,
    leadsWaiting: snapshot.leadsWaiting.map((l) => ({ leadId: l.leadId, name: l.name, createdAt: parseTime(l.createdAt, generated) })),
    leadsWaitingExtra: Math.max(0, snapshot.kpis.leadsWaiting - snapshot.leadsWaiting.length),
    attention: snapshot.attention.filter((a) => a.userId === null || a.userId in index).slice(0, ATTENTION_MAX),
    effects: [],
    log: [],
    logSeq: 0,
  };
}

function allocate(slots: (string | null)[], userId: string): boolean {
  if (slots.includes(userId)) return true;
  const free = slots.indexOf(null);
  if (free === -1) return false;
  slots[free] = userId;
  return true;
}

function release(slots: (string | null)[], userId: string) {
  const i = slots.indexOf(userId);
  if (i !== -1) slots[i] = null;
}

/** Mutable working copy so one event can touch several parts with a single allocation each. */
class Draft {
  private readonly base: FloorState;
  private employees: FloorEmployee[] | null = null;
  private booths: (string | null)[] | null = null;
  private lounge: (string | null)[] | null = null;
  private effects: FloorEffect[] | null = null;
  private log: FloorState['log'] | null = null;
  private logSeq: number;
  private attention: AttentionItem[] | null = null;
  private leadsWaiting: FloorState['leadsWaiting'] | null = null;
  private leadsWaitingExtra: number;
  changed = false;

  constructor(base: FloorState) {
    this.base = base;
    this.logSeq = base.logSeq;
    this.leadsWaitingExtra = base.leadsWaitingExtra;
  }

  get state() {
    return this.base;
  }

  employee(userId: string | null | undefined): FloorEmployee | null {
    if (!userId) return null;
    const i = this.base.index[userId];
    if (i === undefined) return null;
    return (this.employees ?? this.base.employees)[i] ?? null;
  }

  setEmployee(next: FloorEmployee) {
    const i = this.base.index[next.id];
    if (i === undefined) return;
    this.employees ??= [...this.base.employees];
    this.employees[i] = next;
    this.changed = true;
  }

  relocate(userId: string, prev: EmployeeStatus, next: EmployeeStatus) {
    if (prev === next) return;
    if (prev === 'on_call') release((this.booths ??= [...this.base.booths]), userId);
    if (prev === 'away') release((this.lounge ??= [...this.base.lounge]), userId);
    if (next === 'on_call') allocate((this.booths ??= [...this.base.booths]), userId);
    if (next === 'away') allocate((this.lounge ??= [...this.base.lounge]), userId);
    this.changed = true;
  }

  effect(e: FloorEffect) {
    this.effects ??= [...this.base.effects];
    this.effects.push(e);
    if (this.effects.length > EFFECTS_MAX) this.effects.splice(0, this.effects.length - EFFECTS_MAX);
    this.changed = true;
  }

  announce(text: string, at: number) {
    this.log ??= [...this.base.log];
    this.logSeq += 1;
    this.log.push({ seq: this.logSeq, at, text });
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    this.changed = true;
  }

  upsertAttention(item: AttentionItem) {
    if (item.userId !== null && !(item.userId in this.base.index)) return false;
    const list = (this.attention ??= [...this.base.attention]);
    const i = list.findIndex((a) => a.id === item.id);
    if (i === -1) list.unshift(item);
    else list[i] = item;
    if (list.length > ATTENTION_MAX) list.length = ATTENTION_MAX;
    this.changed = true;
    return i === -1;
  }

  removeAttention(id: string) {
    const list = this.attention ?? this.base.attention;
    if (!list.some((a) => a.id === id)) return;
    this.attention = list.filter((a) => a.id !== id);
    this.changed = true;
  }

  addWaiting(leadId: string, name: string, createdAt: number) {
    const list = this.leadsWaiting ?? this.base.leadsWaiting;
    if (list.some((l) => l.leadId === leadId)) return false;
    this.leadsWaiting = [...list, { leadId, name, createdAt }];
    this.changed = true;
    return true;
  }

  /** Remove a waiting lead; true when it was waiting (listed or counted). */
  takeWaiting(leadId: string, assumeCounted: boolean) {
    const list = this.leadsWaiting ?? this.base.leadsWaiting;
    if (list.some((l) => l.leadId === leadId)) {
      this.leadsWaiting = list.filter((l) => l.leadId !== leadId);
      this.changed = true;
      return true;
    }
    if (assumeCounted && this.leadsWaitingExtra > 0) {
      this.leadsWaitingExtra -= 1;
      this.changed = true;
      return true;
    }
    return false;
  }

  prune(now: number) {
    const list = this.effects ?? this.base.effects;
    const kept = list.filter((e) => now - e.at < EFFECT_TTL_MS[e.kind]);
    if (kept.length !== list.length) {
      this.effects = kept;
      this.changed = true;
    }
  }

  commit(): FloorState {
    if (!this.changed) return this.base;
    return {
      ...this.base,
      employees: this.employees ?? this.base.employees,
      booths: this.booths ?? this.base.booths,
      lounge: this.lounge ?? this.base.lounge,
      effects: this.effects ?? this.base.effects,
      log: this.log ?? this.base.log,
      logSeq: this.logSeq,
      attention: this.attention ?? this.base.attention,
      leadsWaiting: this.leadsWaiting ?? this.base.leadsWaiting,
      leadsWaitingExtra: this.leadsWaitingExtra,
    };
  }
}

function withRecent(emp: FloorEmployee, activity: FloorActivity): FloorEmployee['recent'] {
  return [activity, ...emp.recent].slice(0, RECENT_MAX);
}

function statusActivityText(status: EmployeeStatus, lead: string | null) {
  switch (status) {
    case 'on_call':
      return lead ? `Started a call with ${lead}` : 'Started a call';
    case 'busy':
      return lead ? `Working on ${lead}` : 'Busy';
    case 'idle':
      return 'Available';
    case 'away':
      return 'On a break';
    case 'offline':
      return 'Went offline';
  }
}

function statusLogText(name: string, status: EmployeeStatus) {
  switch (status) {
    case 'on_call':
      return `${name} is on a call`;
    case 'busy':
      return `${name} is busy`;
    case 'idle':
      return `${name} is available`;
    case 'away':
      return `${name} is on a break`;
    case 'offline':
      return `${name} went offline`;
  }
}

/** Attention item for an overdue task (shown as a "Needs you" bubble above the assignee). */
export function attentionFromTask(task: Task, at: string): AttentionItem {
  return {
    id: `task_overdue:${task.id}`,
    kind: 'task_overdue',
    title: task.title,
    subtitle: task.leadName && !task.title.includes(task.leadName) ? `Overdue task · ${task.leadName}` : 'Overdue task',
    href: task.leadId ? `/app/leads?lead=${task.leadId}` : '/app/tasks',
    leadId: task.leadId,
    userId: task.assignee?.id ?? null,
    severity: task.priority === 'urgent' ? 'critical' : 'warning',
    createdAt: at,
  };
}

function setStatus(d: Draft, emp: FloorEmployee, status: EmployeeStatus, at: number, now: number, eventId: string, lead: { id: string | null; name: string | null }) {
  if (emp.status === status && emp.currentLeadId === lead.id) return emp;
  const changed = emp.status !== status;
  d.relocate(emp.id, emp.status, status);
  const next: FloorEmployee = {
    ...emp,
    status,
    statusSince: changed ? at : emp.statusSince,
    currentLeadId: lead.id,
    currentLeadName: lead.name,
    activeCall: status === 'on_call' ? emp.activeCall : null,
    recent: changed
      ? withRecent(emp, { id: `${eventId}:s`, at: now, text: statusActivityText(status, lead.name), tone: STATUS_ACTIVITY_TONE[status] })
      : emp.recent,
  };
  d.setEmployee(next);
  if (changed) {
    d.announce(statusLogText(emp.name, status), now);
    if (status === 'idle') d.effect({ id: `${eventId}:wave`, kind: 'wave', at: now, userId: emp.id });
  }
  return next;
}

function applyEvent(d: Draft, event: DomainEvent, now: number) {
  const at = parseTime(event.occurredAt, now);
  switch (event.type) {
    case 'employee.status_changed': {
      const p = (event as DomainEvent<'employee.status_changed'>).payload;
      const emp = d.employee(p.userId);
      if (!emp) return;
      const keepName = p.currentLeadId !== null && p.currentLeadId === emp.currentLeadId;
      const callName = emp.activeCall && p.currentLeadId && p.currentLeadId === emp.currentLeadId ? emp.activeCall.leadName : null;
      const next = setStatus(d, emp, p.status, parseTime(p.at, at), now, event.id, {
        id: p.currentLeadId,
        name: keepName ? (emp.currentLeadName ?? callName) : null,
      });
      if (p.status === 'on_call' && !next.activeCall && p.callId) {
        d.setEmployee({ ...next, activeCall: { callId: p.callId, startedAt: parseTime(p.at, at), leadName: next.currentLeadName } });
      }
      return;
    }
    case 'call.started': {
      const { call } = (event as DomainEvent<'call.started'>).payload;
      const emp = d.employee(call.user?.id);
      if (!emp) return;
      const startedAt = parseTime(call.startedAt, at);
      const withCall = setStatus(d, emp, 'on_call', startedAt, now, event.id, { id: call.leadId, name: call.leadName });
      d.setEmployee({
        ...withCall,
        activeCall: { callId: call.id, startedAt, leadName: call.leadName },
        callsToday: emp.callsToday + 1,
      });
      d.effect({ id: `${event.id}:ring`, kind: 'call_started', at: now, userId: emp.id });
      return;
    }
    case 'call.ended': {
      const { call } = (event as DomainEvent<'call.ended'>).payload;
      const emp = d.employee(call.user?.id);
      if (!emp) return;
      const talked = call.durationSec > 0;
      const avg = talked ? Math.round((emp.avgTalkSec * emp.talkedCalls + call.durationSec) / (emp.talkedCalls + 1)) : emp.avgTalkSec;
      const outcome = call.outcome;
      const label = outcome ? OUTCOME_LABEL[outcome] : 'Ended';
      const lead = call.leadName ?? 'a lead';
      d.setEmployee({
        ...emp,
        activeCall: emp.activeCall && emp.activeCall.callId !== call.id ? emp.activeCall : null,
        avgTalkSec: avg,
        talkedCalls: emp.talkedCalls + (talked ? 1 : 0),
        recent: withRecent(emp, {
          id: `${event.id}:c`,
          at: now,
          text: `Call with ${lead} · ${label}${talked ? ` · ${formatDuration(call.durationSec)}` : ''}`,
          tone: outcome ? OUTCOME_TONE[outcome] : 'grey',
        }),
      });
      d.effect({ id: `${event.id}:out`, kind: 'call_outcome', at: now, userId: emp.id, outcome, durationSec: call.durationSec });
      d.announce(`${emp.name} finished a call: ${label.toLowerCase()}`, now);
      return;
    }
    case 'lead.created': {
      const { lead } = (event as DomainEvent<'lead.created'>).payload;
      if (lead.owner) {
        const owner = d.employee(lead.owner.id);
        if (owner) deliver(d, owner, lead.id, lead.name, null, event.id, now);
        return;
      }
      if (d.addWaiting(lead.id, lead.name, parseTime(lead.createdAt, at))) {
        d.effect({ id: `${event.id}:spawn`, kind: 'parcel_spawn', at: now, leadId: lead.id });
        d.announce(`New lead waiting: ${lead.name}`, now);
      }
      return;
    }
    case 'lead.assigned': {
      const p = (event as DomainEvent<'lead.assigned'>).payload;
      const wasWaiting = d.takeWaiting(p.lead.id, p.fromUserId === null);
      const owner = d.employee(p.toUserId);
      if (!owner) return;
      const from = !wasWaiting && p.fromUserId && d.employee(p.fromUserId) ? p.fromUserId : null;
      deliver(d, owner, p.lead.id, p.lead.name, from, event.id, now);
      return;
    }
    case 'task.overdue': {
      const { task } = (event as DomainEvent<'task.overdue'>).payload;
      if (task.status !== 'open') return;
      const item = attentionFromTask(task, event.occurredAt);
      if (d.upsertAttention(item)) {
        const emp = d.employee(item.userId);
        if (emp) {
          d.setEmployee({ ...emp, recent: withRecent(emp, { id: `${event.id}:t`, at: now, text: `Overdue: ${task.title}`, tone: 'red' }) });
          d.announce(`${emp.name} needs you: ${task.title}`, now);
        } else {
          d.announce(`Needs you: ${task.title}`, now);
        }
      }
      return;
    }
    case 'attention.raised': {
      const { item } = (event as DomainEvent<'attention.raised'>).payload;
      if (d.upsertAttention(item)) d.announce(`Needs you: ${item.title}`, now);
      return;
    }
    case 'attention.resolved': {
      d.removeAttention((event as DomainEvent<'attention.resolved'>).payload.id);
      return;
    }
    default:
      return;
  }
}

function deliver(d: Draft, owner: FloorEmployee, leadId: string, leadName: string, fromUserId: string | null, id: string, now: number) {
  d.effect({ id: `${id}:deliver`, kind: 'delivery', at: now, leadId, leadName, toUserId: owner.id, fromUserId });
  d.setEmployee({
    ...owner,
    recent: withRecent(owner, { id: `${id}:a`, at: now, text: `New lead: ${leadName}`, tone: 'indigo' }),
  });
  d.announce(`${leadName} assigned to ${owner.name}`, now);
}

/** Apply one domain event. Unknown or out-of-scope events return the same state object. */
export function floorReducer(state: FloorState, event: DomainEvent, now: number = parseTime(event.occurredAt, 0)): FloorState {
  const d = new Draft(state);
  applyEvent(d, event, now);
  return d.commit();
}

/** Drop expired transient effects. */
export function pruneFloorState(state: FloorState, now: number): FloorState {
  const d = new Draft(state);
  d.prune(now);
  return d.commit();
}

/** Reducer used by the feed hook: domain events plus local (Wave 1) actions. */
export function floorRootReducer(state: FloorState | null, action: FloorAction): FloorState | null {
  if (action.kind === 'reset') return action.state;
  if (!state) return state;
  switch (action.kind) {
    case 'events': {
      const d = new Draft(state);
      for (const e of action.events) applyEvent(d, e, action.now);
      d.prune(action.now);
      return d.commit();
    }
    case 'prune':
      return pruneFloorState(state, action.now);
    case 'resolve': {
      const d = new Draft(state);
      d.removeAttention(action.id);
      return d.commit();
    }
    case 'restore': {
      const d = new Draft(state);
      d.upsertAttention(action.item);
      return d.commit();
    }
    case 'reassign': {
      const d = new Draft(state);
      const owner = d.employee(action.toUserId);
      if (!owner) return state;
      const from = action.fromUserId ? d.employee(action.fromUserId) : null;
      if (from && from.currentLeadId === action.leadId) {
        d.setEmployee({ ...from, currentLeadId: null, currentLeadName: null });
      }
      deliver(d, d.employee(action.toUserId) ?? owner, action.leadId, action.leadName, from ? from.id : null, `local:${action.now}`, action.now);
      return d.commit();
    }
  }
}
