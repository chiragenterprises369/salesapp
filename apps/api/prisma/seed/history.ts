/**
 * Lead history for one company, generated in memory before any insert so every row agrees:
 * stage changes up to the current stage, 30 days of calls per employee, workflow runs of the two active
 * workflows (with the template messages, replies, tasks and tags they cause), WhatsApp threads that respect
 * the 24 h window, tasks, notes and one timeline Activity per event. Lead fields (firstResponseAt,
 * lastActivityAt, stageChangedAt, wonAt/lostAt, tags, temperature) are derived from that history.
 */
import type { AuditActorType, CallOutcome, MessageStatus, TaskPriority, TaskType } from '@vistar/shared';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { CompanyCtx, LeadDraft, SeedUser, SeedWorkflow } from './company.js';
import * as C from './content.js';
import { addDays, between, chance, d, DAY, fill, firstName, gstin, hex, HOUR, int, istWeekday, MIN, pick, renderTemplate, shuffle, startOfDay, weighted } from './util.js';

type Json = Prisma.InputJsonValue;
type ActivityType = Prisma.ActivityCreateManyInput['type'];
type StepStatus = Prisma.WorkflowRunStepCreateManyInput['status'];
type RunStatus = NonNullable<Prisma.WorkflowRunCreateManyInput['status']>;
interface Actor {
  type: AuditActorType;
  id: string | null;
}

const SEC = 1000;
const SYSTEM: Actor = { type: 'system', id: null };
const WORKFLOW: Actor = { type: 'workflow', id: null };
const user = (id: string): Actor => ({ type: 'user', id });
const ANSWERED = new Set<string>(['answered', 'interested', 'not_interested', 'callback', 'wrong_number']);
/** Steps that also appear on the lead timeline (failures always do). */
const TIMELINE_NODES = new Set(['action.assign_owner', 'action.send_whatsapp_template', 'action.create_task', 'action.create_call_task', 'action.update_field', 'action.add_tag', 'action.change_stage']);

/** Calls per working day (min, max) by role. */
const CALL_RATES: Record<string, { employee: [number, number]; manager: [number, number] }> = {
  shakti: { employee: [18, 34], manager: [4, 9] },
  navkar: { employee: [9, 18], manager: [3, 7] },
  sunrise: { employee: [5, 11], manager: [2, 5] },
};

interface Msg {
  id: string;
  at: number;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'template' | 'note';
  body: string;
  templateId: string | null;
  templateName: string | null;
  authorId: string | null;
  runId: string | null;
  error: string | null;
}

export interface LeadState {
  d: LeadDraft;
  id: string;
  name: string;
  first: string;
  company: string;
  city: string;
  state: string;
  product: string;
  qty: string;
  ownerId: string | null;
  phone: string | null;
  created: number;
  closeAt: number | null;
  end: number;
  finalIdx: number;
  changes: Array<{ at: number; to: number }>;
  touches: number[];
  lastAt: number;
  msgs: Msg[];
  optIn: 'opted_in' | 'opted_out' | null;
  optOutAt: number | null;
  tags: Set<string>;
  temperature: 'hot' | 'warm' | 'cold';
  score: number;
  nurtureAssignAt: number | null;
  runEnd: number;
  conversationId: string | null;
}

export interface HistoryEvents {
  assigned: Array<{ userId: string; leadId: string; leadName: string; company: string; source: string; at: number }>;
  inbound: Array<{ userId: string | null; conversationId: string; leadId: string; leadName: string; preview: string; at: number }>;
  failedRuns: Array<{ runId: string; workflowId: string; workflowName: string; leadId: string; leadName: string; ownerId: string | null; error: string; at: number }>;
}

export interface History {
  states: LeadState[];
  events: HistoryEvents;
  activities: Prisma.ActivityCreateManyInput[];
  calls: Prisma.CallCreateManyInput[];
  conversations: Prisma.ConversationCreateManyInput[];
  messages: Prisma.MessageCreateManyInput[];
  consents: Prisma.ConsentRecordCreateManyInput[];
  tasks: Prisma.TaskCreateManyInput[];
  runs: Prisma.WorkflowRunCreateManyInput[];
  steps: Prisma.WorkflowRunStepCreateManyInput[];
}

const dateKey = (at: number) => new Date(at + 330 * MIN).toISOString().slice(0, 10);

export function buildHistory(ctx: CompanyCtx): History {
  const { rng, now, workspaceId } = ctx;
  const h: History = { states: [], events: { assigned: [], inbound: [], failedRuns: [] }, activities: [], calls: [], conversations: [], messages: [], consents: [], tasks: [], runs: [], steps: [] };

  const managerOf = (userId: string | null): SeedUser => {
    const u = userId ? ctx.userById.get(userId) : undefined;
    const team = u?.teamId ? ctx.teams.find((t) => t.id === u.teamId) : undefined;
    const mgr = team && team.managerId !== userId ? ctx.userById.get(team.managerId) : undefined;
    return mgr ?? ctx.managers[0] ?? ctx.admin;
  };
  const vars = (s: LeadState) => ({ name: s.name, first: s.first, company: s.company, city: s.city, product: s.product, qty: s.qty });
  const act = (s: LeadState, at: number, type: ActivityType, payload: Json, actor: Actor) => {
    h.activities.push({ id: randomUUID(), workspaceId, leadId: s.id, type, actorType: actor.type, actorId: actor.id, payload, createdAt: d(at) });
    if (at > s.lastAt) s.lastAt = at;
  };
  const stageAt = (s: LeadState, t: number) => {
    let idx = 0;
    for (const c of s.changes) if (c.at <= t) idx = c.to;
    return idx;
  };

  // ------------------------------------------------------------ lead states + stage schedule
  const states: LeadState[] = ctx.drafts.map((dr) => {
    const created = dr.lead.createdAt.getTime();
    let closeAt: number | null = null;
    if (ctx.stages[dr.stageIdx]!.type !== 'open') {
      closeAt = Math.min(created + int(rng, 1, 30) * DAY + between(rng, 0, 8 * HOUR), now - between(rng, 30 * MIN, 6 * HOUR));
      if (closeAt < created + 20 * MIN) closeAt = Math.min(now, created + Math.round((now - created) * 0.85) + SEC);
    }
    return {
      d: dr, id: dr.lead.id, name: dr.lead.name, first: firstName(dr.lead.name), company: dr.lead.companyName ?? '', city: dr.lead.city ?? '', state: dr.lead.state ?? '',
      product: dr.product, qty: pick(rng, C.QUANTITIES), ownerId: dr.lead.ownerId ?? null, phone: dr.lead.phone ?? null, created, closeAt, end: closeAt ?? now, finalIdx: dr.stageIdx,
      changes: [], touches: [], lastAt: created, msgs: [], optIn: dr.contact.whatsappOptIn === 'opted_in' ? 'opted_in' : null, optOutAt: null, tags: new Set(dr.lead.tags),
      temperature: (dr.lead.temperature ?? 'warm') as LeadState['temperature'], score: dr.lead.score ?? 0, nurtureAssignAt: null, runEnd: 0, conversationId: null,
    };
  });
  h.states = states;

  for (const s of states) {
    const path = stagePath(s.finalIdx);
    if (!path.length) continue;
    const kind = weighted(rng, [[0, 0.7], [1, 0.2], [2, 0.1]] as const);
    const delay = kind === 0 ? between(rng, 5 * MIN, 3 * HOUR) : kind === 1 ? between(rng, 3 * HOUR, 2 * DAY) : between(rng, 2 * DAY, 7 * DAY);
    const last = s.closeAt ?? Math.min(now - 5 * MIN, s.created + delay + between(rng, 2 * HOUR, 25 * DAY));
    const span = Math.max(last - s.created, path.length * 2 * SEC);
    const first = Math.min(s.created + delay, s.created + Math.round(span * 0.6));
    const ts: number[] = [];
    if (s.closeAt !== null && path.length === 1) ts.push(s.closeAt);
    else {
      const restCount = path.length - 1 - (s.closeAt !== null ? 1 : 0);
      ts.push(first, ...Array.from({ length: restCount }, () => between(rng, first, last)).sort((a, b) => a - b));
      if (s.closeAt !== null) ts.push(s.closeAt);
    }
    for (let i = 1; i < ts.length; i++) if (ts[i]! <= ts[i - 1]!) ts[i] = ts[i - 1]! + SEC;
    for (let i = ts.length - 1; i >= 0; i--) if (ts[i]! > now - (ts.length - i) * SEC) ts[i] = now - (ts.length - i) * SEC;
    s.changes = path.map((to, i) => ({ at: ts[i]!, to }));
  }

  function stagePath(finalIdx: number): number[] {
    if (finalIdx === 0) return [];
    if (finalIdx <= 3) return Array.from({ length: finalIdx }, (_, i) => i + 1);
    if (finalIdx === 4) return [1, ...(chance(rng, 0.8) ? [2] : []), 3, 4];
    const j = weighted(rng, [[0, 0.25], [1, 0.3], [2, 0.25], [3, 0.2]] as const);
    return [...Array.from({ length: j }, (_, i) => i + 1), 5];
  }

  // ------------------------------------------------------------ messages, templates, tasks (helpers)
  const pushMsg = (s: LeadState, m: Omit<Msg, 'id' | 'templateId' | 'templateName' | 'runId' | 'error'> & Partial<Msg>) =>
    s.msgs.push({ id: randomUUID(), templateId: null, templateName: null, runId: null, error: null, ...m });
  const inbound = (s: LeadState, at: number, body: string) => pushMsg(s, { at, direction: 'inbound', type: 'text', body, authorId: null });
  const outText = (s: LeadState, at: number, body: string, authorId: string | null) => pushMsg(s, { at, direction: 'outbound', type: 'text', body, authorId });

  function sendTemplate(s: LeadState, name: string, at: number, opts: { runId?: string; authorId?: string | null; failP?: number }): { status: 'sent' | 'failed' | 'skipped'; error?: string } {
    if (!s.phone || s.optIn !== 'opted_in' || (s.optOutAt !== null && at >= s.optOutAt)) return { status: 'skipped' };
    const tpl = ctx.templates.get(name);
    if (!tpl) return { status: 'skipped' };
    const values = tpl.variables.map((v) => (v === 'lead.firstName' ? s.first : v === 'workspace.name' ? ctx.workspaceName : v === 'lead.productInterest' ? s.product : ''));
    const failed = chance(rng, opts.failP ?? 0.03);
    const error = failed ? (name === 'indiamart_followup_1' || name === 'revival_offer' ? pick(rng, C.WA_SEND_ERRORS) : C.WA_SEND_ERRORS[0]) : null;
    pushMsg(s, { at, direction: 'outbound', type: 'template', body: renderTemplate(tpl.body, values), templateId: tpl.id, templateName: name, authorId: opts.authorId ?? null, runId: opts.runId ?? null, error });
    return error ? { status: 'failed', error } : { status: 'sent' };
  }

  interface TaskSpec {
    s: LeadState | null;
    type: TaskType;
    title: string;
    priority: TaskPriority;
    assigneeId: string | null;
    createdById: string | null;
    createdAt: number;
    dueAt: number | null;
    source: 'manual' | 'workflow' | 'system';
    runId?: string;
    status?: 'open' | 'done' | 'cancelled';
    completedAt?: number | null;
    remind?: boolean;
    notes?: string | null;
  }
  function addTask(t: TaskSpec) {
    let status = t.status;
    let completedAt = t.completedAt ?? null;
    if (!status) {
      if (t.dueAt !== null && t.dueAt < now - 3 * HOUR && chance(rng, t.dueAt < now - 2 * DAY ? 0.95 : 0.75)) {
        status = 'done';
        completedAt = Math.min(now - MIN, Math.max(t.createdAt + 5 * MIN, t.dueAt + between(rng, -2 * HOUR, 6 * HOUR)));
      } else status = 'open';
    }
    if (status !== 'done') completedAt = null;
    const overdue = status === 'open' && t.dueAt !== null && t.dueAt < now;
    const snoozedUntil = overdue && chance(rng, 0.05) ? now + between(rng, HOUR, 20 * HOUR) : null;
    const id = randomUUID();
    h.tasks.push({
      id, workspaceId, type: t.type, title: t.title.slice(0, 200), notes: t.notes ?? null, status, priority: t.priority, leadId: t.s?.id ?? null, assigneeId: t.assigneeId, createdById: t.createdById,
      dueAt: t.dueAt !== null ? d(t.dueAt) : null, remindAt: t.remind && t.dueAt !== null ? d(t.dueAt - 15 * MIN) : null, snoozedUntil: snoozedUntil ? d(snoozedUntil) : null,
      completedAt: completedAt !== null ? d(completedAt) : null,
      // The overdue scheduler already flagged these (keeps a fresh API from re-notifying every seeded task).
      overdueNotifiedAt: overdue && !snoozedUntil && t.assigneeId && t.dueAt !== null ? d(Math.min(t.dueAt + MIN, now)) : null,
      source: t.source, workflowRunId: t.runId ?? null, createdAt: d(t.createdAt), updatedAt: d(completedAt ?? (snoozedUntil ? now - between(rng, 10 * MIN, 3 * HOUR) : t.createdAt)),
    });
    if (t.s) {
      act(t.s, t.createdAt, 'task_created', { taskId: id, title: t.title.slice(0, 200) }, t.createdById ? user(t.createdById) : t.source === 'workflow' ? WORKFLOW : SYSTEM);
      if (status === 'done' && completedAt !== null) act(t.s, completedAt, 'task_completed', { taskId: id, title: t.title.slice(0, 200) }, t.assigneeId ? user(t.assigneeId) : SYSTEM);
    }
    return { id, title: t.title };
  }

  // ------------------------------------------------------------ calls (30 days, per user and day)
  const rate = CALL_RATES[ctx.fx.slug] ?? CALL_RATES.navkar!;
  const byOwner = new Map<string, LeadState[]>();
  for (const s of states) {
    if (!s.ownerId || !s.phone) continue;
    const list = byOwner.get(s.ownerId) ?? [];
    list.push(s);
    byOwner.set(s.ownerId, list);
  }
  const pickLead = (userId: string, t: number): LeadState | null => {
    const list = byOwner.get(userId);
    if (!list?.length) return null;
    for (let i = 0; i < 16; i++) {
      const s = list[Math.floor(rng() * list.length)]!;
      if (s.created > t - 10 * MIN) continue;
      if (s.closeAt !== null && s.closeAt < t + 10 * MIN) continue;
      const age = t - s.created;
      if (!chance(rng, age < 7 * DAY ? 1 : age < 30 * DAY ? 0.7 : 0.35)) continue;
      if (stageAt(s, t) === 0 && chance(rng, 0.4)) continue;
      return s;
    }
    return null;
  };
  const unknownPhone = () => `+91${pick(rng, ['9', '8', '7'])}${int(rng, 100_000_000, 999_999_999)}`;
  const peaks = () => {
    const phase = rng() * 6;
    return Array.from({ length: 48 }, (_, i) => Math.round(Math.min(1, 0.12 + Math.abs(Math.sin(i / 3 + phase)) * (0.45 + rng() * 0.5)) * 100) / 100);
  };
  const durationFor = (o: string) =>
    o === 'interested' ? int(rng, 120, 900) : o === 'not_interested' ? int(rng, 20, 150) : o === 'callback' ? int(rng, 15, 90) : o === 'wrong_number' ? int(rng, 8, 30) : int(rng, 35, 420);
  const missedInbound: Array<{ s: LeadState; userId: string; endedAt: number; callId: string }> = [];
  const callbacks: Array<{ s: LeadState; userId: string; at: number }> = [];

  function makeCall(u: SeedUser, t: number) {
    const isInbound = chance(rng, 0.25);
    let s = pickLead(u.id, t);
    if (isInbound && chance(rng, 0.06)) s = null;
    if (!s && !isInbound) return;
    let outcome: CallOutcome | 'failed' = isInbound ? weighted(rng, C.INBOUND_OUTCOMES) : weighted(rng, C.OUTBOUND_OUTCOMES);
    if (s && ANSWERED.has(outcome)) {
      const idx = stageAt(s, t);
      if (idx === 0 && !s.changes.length) outcome = isInbound ? 'missed' : weighted(rng, [['missed', 0.7], ['voicemail', 0.2], ['failed', 0.1]] as const);
      else if (outcome === 'wrong_number' && idx >= 2) outcome = 'answered';
    }
    const answered = ANSWERED.has(outcome);
    const ring = between(rng, 6 * SEC, 28 * SEC);
    let dur = answered ? durationFor(outcome) : outcome === 'voicemail' ? int(rng, 15, 35) : 0;
    if (t + ring + dur * SEC > now - 30 * SEC) dur = Math.max(5, Math.floor((now - 30 * SEC - t - ring) / SEC));
    const endedAt = t + ring + dur * SEC;
    if (s && answered && s.changes.length && s.changes[0]!.at > t && stageAt(s, t) === 0) {
      s.changes[0]!.at = Math.min(endedAt + MIN, (s.changes[1]?.at ?? Infinity) - SEC);
    }
    const id = randomUUID();
    const status = outcome === 'failed' ? 'failed' : outcome === 'missed' ? 'missed' : 'completed';
    const callOutcome = outcome === 'failed' ? null : outcome;
    const hasRecording = answered && dur > 15 && chance(rng, 0.93);
    const phone = s?.phone ?? unknownPhone();
    const noteList = C.CALL_NOTES[outcome as CallOutcome];
    const durationSec = answered || outcome === 'voicemail' ? dur : 0;
    h.calls.push({
      id, workspaceId, leadId: s?.id ?? null, userId: u.id, direction: isInbound ? 'inbound' : 'outbound', status, outcome: callOutcome,
      fromNumber: isInbound ? phone : ctx.business.number, toNumber: isInbound ? ctx.business.number : phone,
      startedAt: d(t), answeredAt: answered ? d(t + ring) : null, endedAt: d(endedAt), durationSec,
      recordingKey: hasRecording ? `recordings/${workspaceId}/${dateKey(t).slice(0, 7)}/${id}.mp3` : null, recordingPeaks: hasRecording ? peaks() : undefined,
      provider: 'mock', providerCallId: `mock_${hex(rng, 24)}`,
      notes: s && answered && noteList && chance(rng, 0.7) ? fill(pick(rng, noteList), vars(s)) : null,
      disposition: chance(rng, 0.85) ? pick(rng, C.DISPOSITIONS[outcome]) : null,
      createdAt: d(t), updatedAt: d(Math.min(now, endedAt + between(rng, 0, 3 * MIN))),
    });
    if (!s) return;
    act(s, endedAt, 'call', { callId: id, status, outcome: callOutcome, durationSec, hasRecording }, user(u.id));
    if (!isInbound) s.touches.push(t);
    else if (answered) s.touches.push(t + ring);
    if (isInbound && outcome === 'missed') missedInbound.push({ s, userId: u.id, endedAt, callId: id });
    if (outcome === 'callback' && chance(rng, 0.45)) callbacks.push({ s, userId: u.id, at: endedAt });
  }

  const today = startOfDay(now);
  for (let k = 30; k >= 0; k--) {
    const dayStart = addDays(today, -k);
    if (istWeekday(dayStart + 12 * HOUR) === 0) continue;
    for (const u of ctx.sales) {
      const [lo, hi] = u.kind === 'manager' ? rate.manager : rate.employee;
      let n = int(rng, lo, hi);
      if (u.title === 'Field Sales') n = Math.round(n * 0.4);
      let from = dayStart + 9.5 * HOUR;
      let to = dayStart + 19.5 * HOUR;
      if (k === 0) {
        if (u.status === 'offline') continue;
        n = Math.round(n * 0.45);
        to = now - 20 * MIN;
        if (to - from < 90 * MIN) from = to - 90 * MIN;
      }
      const times = Array.from({ length: n }, () => between(rng, from, to)).sort((a, b) => a - b);
      for (const t of times) makeCall(u, t);
    }
  }
  // Employees shown "On call" have a live call right now.
  for (const u of ctx.sales.filter((x) => x.status === 'on_call')) {
    const s = pickLead(u.id, now);
    if (!s?.phone) continue;
    const t = now - between(rng, 40 * SEC, 7 * MIN);
    h.calls.push({
      id: randomUUID(), workspaceId, leadId: s.id, userId: u.id, direction: 'outbound', status: 'in_progress', outcome: null, fromNumber: ctx.business.number, toNumber: s.phone,
      startedAt: d(t), answeredAt: d(t + 9 * SEC), endedAt: null, durationSec: 0, provider: 'mock', providerCallId: `mock_${hex(rng, 24)}`, createdAt: d(t), updatedAt: d(t + 9 * SEC),
    });
    s.touches.push(t);
  }

  // ------------------------------------------------------------ workflow runs (active workflows only)
  interface Run {
    id: string;
    wf: SeedWorkflow;
    s: LeadState | null;
    startedAt: number;
    types: Map<string, string>;
    lastAt: number;
  }
  const newRun = (wf: SeedWorkflow, s: LeadState | null, startedAt: number): Run => ({ id: randomUUID(), wf, s, startedAt, types: new Map(wf.graph.nodes.map((n) => [n.id, n.type])), lastAt: startedAt });
  function step(run: Run, nodeId: string, status: StepStatus, at: number, endAt: number | null, x: { branch?: string; summary?: string; error?: string; scheduledFor?: number; output?: Json } = {}) {
    const nodeType = run.types.get(nodeId) ?? 'logic.stop';
    h.steps.push({
      id: randomUUID(), workspaceId, runId: run.id, nodeId, nodeType, visit: 0, status, attempt: status === 'pending' ? 0 : 1, branch: x.branch ?? null,
      output: x.output, summary: x.summary ?? null, error: x.error ?? null, scheduledFor: x.scheduledFor ? d(x.scheduledFor) : null,
      jobId: x.scheduledFor ? `wf-wait:${run.id}:${nodeId}` : null, startedAt: d(at), finishedAt: endAt !== null ? d(endAt) : null, createdAt: d(at),
    });
    run.lastAt = Math.max(run.lastAt, endAt ?? at);
    if (run.s && (TIMELINE_NODES.has(nodeType) || status === 'failed') && status !== 'skipped') {
      act(run.s, endAt ?? at, 'workflow_step', { workflowId: run.wf.id, workflowName: run.wf.name, runId: run.id, nodeId, nodeType, status, summary: x.summary ?? x.error ?? '' }, WORKFLOW);
    }
  }
  function finish(run: Run, status: RunStatus, at: number | null, current: string[], error: string | null, x: { triggerEvent: Json; key: string | null; isTest?: boolean; context?: Json }) {
    h.runs.push({
      id: run.id, workspaceId, workflowId: run.wf.id, versionId: run.wf.versionId, leadId: run.s?.id ?? null, status, isTest: x.isTest ?? false, triggerEvent: x.triggerEvent,
      context: x.context ?? {}, currentNodeIds: current, idempotencyKey: x.key, error, startedAt: d(run.startedAt), finishedAt: at !== null ? d(at) : null, updatedAt: d(at ?? run.lastAt),
    });
    if (run.s) run.s.runEnd = Math.max(run.s.runEnd, at ?? now);
    if (status === 'failed' && run.s && error) {
      h.events.failedRuns.push({ runId: run.id, workflowId: run.wf.id, workflowName: run.wf.name, leadId: run.s.id, leadName: run.s.name, ownerId: run.s.ownerId, error, at: at ?? run.lastAt });
    }
  }
  /** Returns false when the run stops at this wait (still waiting, or cancelled because the lead closed). */
  function wait(run: Run, nodeId: string, startAt: number, scheduledFor: number, resumeAt: number, summary: string, meta: Parameters<typeof finish>[5]): boolean {
    if (resumeAt > now) {
      step(run, nodeId, 'waiting', startAt, null, { scheduledFor, summary: 'Waiting' });
      finish(run, 'waiting', null, [nodeId], null, meta);
      return false;
    }
    const closeAt = run.s?.closeAt ?? null;
    if (closeAt !== null && closeAt > startAt && closeAt < resumeAt) {
      step(run, nodeId, 'skipped', startAt, closeAt, { scheduledFor, summary: 'Cancelled: lead closed' });
      finish(run, 'cancelled', closeAt, [], null, meta);
      return false;
    }
    step(run, nodeId, 'succeeded', startAt, resumeAt, { scheduledFor, summary });
    return true;
  }

  const nurture = ctx.workflows.find((w) => w.templateKey === 'indiamart_nurturing' && w.active);
  const missedWf = ctx.workflows.find((w) => w.templateKey === 'missed_call_follow_up' && w.active);

  function runNurture(wf: SeedWorkflow, s: LeadState) {
    const run = newRun(wf, s, s.created + 2 * SEC);
    const t0 = run.startedAt;
    const meta = { triggerEvent: { type: 'lead.created', leadId: s.id, source: 'indiamart', sourceRef: s.d.lead.sourceRef ?? null }, key: `${wf.id}:${s.id}:lead.created` };
    step(run, 'trigger', 'succeeded', t0, t0 + 200, { summary: `IndiaMART enquiry ${s.d.lead.sourceRef ?? ''}`.trim(), output: { leadId: s.id } });
    if (chance(rng, 0.04)) {
      step(run, 'dedupe', 'succeeded', t0 + 300, t0 + 600, { branch: 'duplicate', summary: 'Same phone enquired in the last 90 days' });
      step(run, 'stop_dup', 'succeeded', t0 + 700, t0 + 800, { summary: 'Stopped: Duplicate enquiry' });
      return finish(run, 'completed', t0 + 800, [], null, meta);
    }
    step(run, 'dedupe', 'succeeded', t0 + 300, t0 + 600, { branch: 'unique', summary: 'No duplicate in the last 90 days' });
    step(run, 'contact', 'succeeded', t0 + 700, t0 + 1500, { summary: 'Contact and deal ready' });
    const owner = s.ownerId ? ctx.userById.get(s.ownerId) : undefined;
    s.nurtureAssignAt = t0 + 3 * SEC;
    step(run, 'assign', 'succeeded', t0 + 2 * SEC, t0 + 3 * SEC, { summary: owner ? `Assigned to ${owner.name} (round robin)` : 'No one available, left unassigned', output: { ownerId: s.ownerId } });
    const welcome = sendTemplate(s, 'indiamart_welcome', t0 + 5 * SEC, { runId: run.id, failP: 0.035 });
    if (welcome.status === 'failed') {
      step(run, 'welcome', 'failed', t0 + 4 * SEC, t0 + 5 * SEC, { error: welcome.error });
      return finish(run, 'failed', t0 + 5 * SEC, ['welcome'], welcome.error ?? null, meta);
    }
    const sent = welcome.status === 'sent';
    step(run, 'welcome', sent ? 'succeeded' : 'skipped', t0 + 4 * SEC, t0 + 5 * SEC, { summary: sent ? 'Sent template indiamart_welcome' : 'Skipped: no WhatsApp opt-in' });
    const replyAt = sent && s.score > 40 && chance(rng, 0.7) ? t0 + between(rng, 4 * MIN, 110 * MIN) : null;
    const replied = replyAt !== null && replyAt <= now && (s.closeAt === null || replyAt < s.closeAt);
    const resume = replied ? replyAt : t0 + 2 * HOUR;
    if (!wait(run, 'wait_2h', t0 + 6 * SEC, t0 + 2 * HOUR, resume, replied ? 'Resumed early: lead replied' : 'Waited 2 hours', meta)) return;
    if (replied) {
      const intent = weighted(rng, [['price', 0.5], ['catalog', 0.3], ['other', 0.2]] as const);
      inbound(s, resume, fill(pick(rng, C.WA_INBOUND_REPLIES[intent]), vars(s)));
      step(run, 'replied', 'succeeded', resume + 200, resume + 400, { branch: 'yes', summary: 'Lead replied' });
      step(run, 'intent', 'succeeded', resume + 500, resume + 700, { branch: intent === 'other' ? 'default' : intent, summary: intent === 'other' ? 'No keyword matched' : `Reply matched "${intent}"` });
      if (intent === 'other') {
        const task = addTask({ s, type: 'follow_up', title: fill('Reply to {name}', vars(s)), priority: 'normal', assigneeId: s.ownerId, createdById: null, createdAt: resume + SEC, dueAt: resume + 30 * MIN, source: 'workflow', runId: run.id });
        step(run, 'other_task', 'succeeded', resume + SEC, resume + 2 * SEC, { summary: `Created task "${task.title}"`, output: { taskId: task.id } });
        return finish(run, 'completed', resume + 2 * SEC, [], null, meta);
      }
      const tplName = intent === 'price' ? 'price_list' : 'product_catalog';
      sendTemplate(s, tplName, resume + 3 * SEC, { runId: run.id, failP: 0 });
      step(run, intent === 'price' ? 'price_list' : 'catalog', 'succeeded', resume + 2 * SEC, resume + 3 * SEC, { summary: `Sent template ${tplName}` });
      if (intent === 'catalog') return finish(run, 'completed', resume + 3 * SEC, [], null, meta);
      const task = addTask({ s, type: 'follow_up', title: fill('Follow up on price enquiry: {name}', vars(s)), priority: 'high', assigneeId: s.ownerId, createdById: null, createdAt: resume + 4 * SEC, dueAt: resume + HOUR, source: 'workflow', runId: run.id });
      step(run, 'price_task', 'succeeded', resume + 4 * SEC, resume + 5 * SEC, { summary: `Created task "${task.title}"`, output: { taskId: task.id } });
      return finish(run, 'completed', resume + 5 * SEC, [], null, meta);
    }
    step(run, 'replied', 'succeeded', resume + 200, resume + 400, { branch: 'no', summary: 'No reply yet' });
    const w1 = resume + DAY;
    if (!wait(run, 'wait_1d', resume + SEC, w1, w1, 'Waited 1 day', meta)) return;
    const follow = sent ? sendTemplate(s, 'indiamart_followup_1', w1 + 2 * SEC, { runId: run.id, failP: 0.04 }) : { status: 'skipped' as const, error: undefined };
    if (follow.status === 'failed') {
      step(run, 'followup_1', 'failed', w1 + SEC, w1 + 2 * SEC, { error: follow.error });
      return finish(run, 'failed', w1 + 2 * SEC, ['followup_1'], follow.error ?? null, meta);
    }
    step(run, 'followup_1', follow.status === 'sent' ? 'succeeded' : 'skipped', w1 + SEC, w1 + 2 * SEC, { summary: follow.status === 'sent' ? 'Sent template indiamart_followup_1' : 'Skipped: no WhatsApp opt-in' });
    const w2 = w1 + 2 * DAY;
    if (!wait(run, 'wait_2d', w1 + 3 * SEC, w2, w2, 'Waited 2 days', meta)) return;
    const task = addTask({ s, type: 'call', title: fill('Call {name} (no reply on WhatsApp)', vars(s)), priority: 'high', assigneeId: s.ownerId, createdById: null, createdAt: w2 + SEC, dueAt: w2 + 30 * MIN, source: 'workflow', runId: run.id });
    step(run, 'call_task', 'succeeded', w2 + SEC, w2 + 2 * SEC, { summary: `Created call task "${task.title}"`, output: { taskId: task.id } });
    s.temperature = 'cold';
    s.score = Math.min(s.score, int(rng, 18, 40));
    step(run, 'mark_cold', 'succeeded', w2 + 2 * SEC, w2 + 3 * SEC, { summary: 'Set temperature to cold' });
    finish(run, 'completed', w2 + 3 * SEC, [], null, meta);
  }

  function runMissed(wf: SeedWorkflow, m: { s: LeadState; userId: string; endedAt: number; callId: string }) {
    const s = m.s;
    const run = newRun(wf, s, m.endedAt + 2 * SEC);
    const t0 = run.startedAt;
    const meta = { triggerEvent: { type: 'call.missed', callId: m.callId, leadId: s.id }, key: `${wf.id}:${s.id}:call.missed:${m.callId}` };
    step(run, 'trigger', 'succeeded', t0, t0 + 200, { summary: `Missed call from ${s.name}`, output: { callId: m.callId } });
    const sorry = sendTemplate(s, 'missed_call_sorry', t0 + 3 * SEC, { runId: run.id, failP: 0.03 });
    if (sorry.status === 'failed') {
      step(run, 'sorry', 'failed', t0 + 2 * SEC, t0 + 3 * SEC, { error: sorry.error });
      return finish(run, 'failed', t0 + 3 * SEC, ['sorry'], sorry.error ?? null, meta);
    }
    step(run, 'sorry', sorry.status === 'sent' ? 'succeeded' : 'skipped', t0 + 2 * SEC, t0 + 3 * SEC, { summary: sorry.status === 'sent' ? 'Sent template missed_call_sorry' : 'Skipped: no WhatsApp opt-in' });
    const due = t0 + 15 * MIN;
    const done = due < now - HOUR && chance(rng, due < now - DAY ? 0.97 : 0.85);
    const task = addTask({
      s, type: 'call', title: fill('Call back {name} (missed call)', vars(s)), priority: 'urgent', assigneeId: s.ownerId ?? m.userId, createdById: null, createdAt: t0 + 4 * SEC, dueAt: due,
      source: 'workflow', runId: run.id, status: done ? 'done' : 'open', completedAt: done ? Math.min(now - MIN, due + between(rng, -12 * MIN, 50 * MIN)) : null,
    });
    step(run, 'callback', 'succeeded', t0 + 4 * SEC, t0 + 5 * SEC, { summary: `Created call task "${task.title}"`, output: { taskId: task.id } });
    const replyAt = sorry.status === 'sent' && chance(rng, 0.35) ? t0 + between(rng, 3 * MIN, 100 * MIN) : null;
    const replied = replyAt !== null && replyAt <= now && (s.closeAt === null || replyAt < s.closeAt);
    const resume = replied ? replyAt : t0 + 2 * HOUR;
    if (!wait(run, 'wait', t0 + 6 * SEC, t0 + 2 * HOUR, resume, replied ? 'Resumed early: lead replied' : 'Waited 2 hours', meta)) return;
    if (replied) {
      inbound(s, resume, pick(rng, C.WA_MISSED_CALL_REPLIES));
      step(run, 'replied', 'succeeded', resume + 200, resume + 400, { branch: 'yes', summary: 'Lead replied' });
      step(run, 'done', 'succeeded', resume + 500, resume + 600, { summary: 'Stopped' });
      return finish(run, 'completed', resume + 600, [], null, meta);
    }
    step(run, 'replied', 'succeeded', resume + 200, resume + 400, { branch: 'no', summary: 'No reply' });
    s.tags.add('missed-call-no-reply');
    step(run, 'tag', 'succeeded', resume + 500, resume + 700, { summary: 'Added tag missed-call-no-reply' });
    finish(run, 'completed', resume + 700, [], null, meta);
  }

  if (nurture) for (const s of states) if (s.d.source === 'indiamart' && s.created >= now - 30 * DAY) runNurture(nurture, s);
  if (missedWf) for (const m of missedInbound) runMissed(missedWf, m);
  // A manager's dry-run test runs from the builder (no lead, no side effects).
  if (nurture) {
    const tester = ctx.managers[0] ?? ctx.admin;
    for (let i = 0; i < 2; i++) {
      const run = newRun(nurture, null, now - between(rng, 2 * DAY, 9 * DAY));
      const t = run.startedAt;
      const plan: Array<[string, string, string?]> = [
        ['trigger', 'Test lead from the builder'], ['dedupe', 'No duplicate in the last 90 days', 'unique'], ['contact', 'Dry run: contact not saved'],
        ['assign', 'Dry run: would assign by round robin'], ['welcome', 'Dry run: would send indiamart_welcome'], ['wait_2h', 'Wait skipped in test run'],
        ['replied', 'Simulated reply', 'yes'], ['intent', 'Reply matched "price"', 'price'], ['price_list', 'Dry run: would send price_list'], ['price_task', 'Dry run: would create a task'],
      ];
      plan.forEach(([nodeId, summary, branch], j) => step(run, nodeId, 'succeeded', t + j * 300, t + j * 300 + 200, { summary, ...(branch ? { branch } : {}) }));
      finish(run, 'completed', t + plan.length * 300, [], null, { triggerEvent: { type: 'test', by: tester.id }, key: null, isTest: true, context: { dryRun: true, waitScale: 0, simulateReply: 'Rate kya hai?' } });
    }
  }

  // ------------------------------------------------------------ WhatsApp threads (about 40% of leads)
  const lastInbound = (s: LeadState, before = Infinity) => s.msgs.reduce<number | null>((a, m) => (m.direction === 'inbound' && m.at <= before && (a === null || m.at > a) ? m.at : a), null);
  const templateFor = (s: LeadState) => (s.finalIdx === 3 ? 'quote_reminder' : s.created < now - 45 * DAY ? 'revival_offer' : pick(rng, ['price_list', 'product_catalog', 'indiamart_followup_1']));
  function buildThread(s: LeadState) {
    if (!s.phone) return;
    const v = vars(s);
    const author = s.ownerId ?? managerOf(null).id;
    let t: number;
    if (s.msgs.length) {
      t = Math.max(...s.msgs.map((m) => m.at), s.runEnd) + between(rng, 20 * MIN, 2 * DAY);
      if (t > s.end - 10 * MIN) return;
      const li = lastInbound(s, t);
      if (li !== null && t - li < 24 * HOUR) outText(s, t, fill(pick(rng, C.WA_AGENT_REPLIES), v), author);
      else sendTemplate(s, templateFor(s), t, { authorId: author, failP: 0.03 });
    } else if (s.d.source === 'whatsapp') {
      t = s.created - 5 * SEC;
      inbound(s, t, fill(pick(rng, C.WA_INBOUND_OPENERS), v));
      const r = t + between(rng, 2 * MIN, 40 * MIN);
      if (r < s.end && r < now - MIN) {
        outText(s, r, fill(pick(rng, C.WA_AGENT_REPLIES), v), author);
        t = r;
      }
    } else {
      t = s.created + between(rng, 20 * MIN, 3 * DAY);
      if (s.touches.length) t = Math.max(t, Math.min(...s.touches));
      if (t > s.end - 10 * MIN) return;
      sendTemplate(s, templateFor(s), t, { authorId: author, failP: 0.03 });
    }
    const exchanges = int(rng, 1, 4);
    for (let i = 0; i < exchanges; i++) {
      const tIn = t + between(rng, 3 * MIN, 30 * HOUR);
      if (tIn > s.end - 2 * MIN) break;
      const pool = i === 0 ? (s.finalIdx >= 2 ? C.WA_INBOUND_REPLIES.price : pick(rng, [C.WA_INBOUND_REPLIES.catalog, C.WA_INBOUND_REPLIES.other])) : C.WA_INBOUND_FOLLOWUPS;
      inbound(s, tIn, fill(pick(rng, pool), v));
      t = tIn;
      if (!chance(rng, 0.82)) continue;
      const tOut = tIn + between(rng, MIN, 50 * MIN);
      if (tOut > s.end || tOut > now - MIN) break;
      outText(s, tOut, fill(pick(rng, C.WA_AGENT_REPLIES), v), author);
      t = tOut;
    }
    if (s.closeAt === null && chance(rng, 0.5)) {
      const tb = now - between(rng, 5 * MIN, 3 * DAY);
      if (tb > t + 30 * MIN) {
        if (chance(rng, 0.6)) {
          inbound(s, tb, fill(pick(rng, C.WA_INBOUND_FOLLOWUPS), v));
          const r = tb + between(rng, 2 * MIN, 45 * MIN);
          if (chance(rng, 0.55) && r < now - MIN) outText(s, r, fill(pick(rng, C.WA_AGENT_REPLIES), v), author);
        } else {
          sendTemplate(s, s.finalIdx === 3 ? 'quote_reminder' : 'indiamart_followup_1', tb, { authorId: author, failP: 0.04 });
          const r = tb + between(rng, 5 * MIN, 6 * HOUR);
          if (chance(rng, 0.45) && r < now - MIN) inbound(s, r, fill(pick(rng, C.WA_INBOUND_FOLLOWUPS), v));
        }
      }
    }
    if (s.finalIdx === 4 && s.closeAt !== null && chance(rng, 0.7)) {
      const ib = s.closeAt - between(rng, HOUR, 6 * HOUR);
      if (ib > t) {
        inbound(s, ib, fill(pick(rng, C.WA_WON_INBOUND), v));
        outText(s, Math.min(now - MIN, s.closeAt + between(rng, 5 * MIN, 2 * HOUR)), fill(pick(rng, C.WA_WON_AGENT), v), author);
      }
    }
    if (s.finalIdx === 5 && s.closeAt !== null && chance(rng, 0.5)) {
      const ib = s.closeAt - between(rng, 10 * MIN, 2 * HOUR);
      if (ib > t) inbound(s, ib, pick(rng, C.WA_LOST_INBOUND));
    }
    if (chance(rng, 0.1) && s.msgs.length >= 2) {
      const first = Math.min(...s.msgs.map((m) => m.at));
      const lastAt = Math.max(...s.msgs.map((m) => m.at));
      pushMsg(s, { at: between(rng, first, lastAt), direction: 'outbound', type: 'note', body: pick(rng, C.WA_INTERNAL_NOTES), authorId: author });
    }
    if (chance(rng, 0.015)) {
      const at = Math.min(now - 5 * MIN, Math.max(...s.msgs.map((m) => m.at)) + between(rng, HOUR, 3 * DAY));
      inbound(s, at, C.WA_STOP);
      s.optOutAt = at;
    }
  }

  const target = Math.round(states.length * 0.4);
  const inThread = new Set(states.filter((s) => s.msgs.length && s.phone).map((s) => s.id));
  const organic: LeadState[] = states.filter((s) => s.msgs.length && s.phone && chance(rng, 0.5));
  for (const s of states) {
    if (s.d.source !== 'whatsapp' || inThread.has(s.id) || !s.phone) continue;
    organic.push(s);
    inThread.add(s.id);
  }
  for (const s of shuffle(rng, states.filter((x) => !inThread.has(x.id) && x.optIn === 'opted_in' && x.phone))) {
    if (inThread.size >= target) break;
    organic.push(s);
    inThread.add(s.id);
  }
  for (const s of organic) buildThread(s);

  // ------------------------------------------------------------ tasks
  for (const c of callbacks) {
    const due = c.at + between(rng, HOUR, 26 * HOUR);
    addTask({ s: c.s, type: 'call', title: fill(pick(rng, C.TASK_TITLES.call), vars(c.s)), priority: c.s.temperature === 'hot' ? 'high' : 'normal', assigneeId: c.userId, createdById: c.userId, createdAt: c.at + 30 * SEC, dueAt: due, source: 'manual', remind: true });
  }
  for (const s of states) {
    const v = vars(s);
    const follow = s.d.lead.nextFollowUpAt instanceof Date ? s.d.lead.nextFollowUpAt.getTime() : null;
    if (follow !== null && s.ownerId && chance(rng, 0.55)) {
      const type = weighted(rng, [['follow_up', 0.45], ['call', 0.4], ['meeting', 0.1], ['email', 0.05]] as const);
      const priority: TaskPriority = s.temperature === 'hot' ? (chance(rng, 0.15) ? 'urgent' : 'high') : s.temperature === 'warm' ? 'normal' : 'low';
      const creator = chance(rng, 0.15) ? managerOf(s.ownerId).id : s.ownerId;
      const createdAt = Math.min(now - MIN, Math.max(s.created + 5 * MIN, follow - between(rng, 4 * HOUR, 4 * DAY)));
      // Most past-due follow-ups were done on time; the lead then has no next follow-up date.
      const doneOnTime = follow < now - HOUR && chance(rng, 0.6);
      if (doneOnTime) s.d.lead.nextFollowUpAt = null;
      addTask({
        s, type, title: fill(pick(rng, C.TASK_TITLES[type]), v), priority, assigneeId: s.ownerId, createdById: creator, createdAt, dueAt: follow, source: 'manual', status: doneOnTime ? 'done' : 'open',
        completedAt: doneOnTime ? Math.min(now - MIN, Math.max(createdAt + 5 * MIN, follow + between(rng, -2 * HOUR, 4 * HOUR))) : null, remind: chance(rng, 0.6), notes: chance(rng, 0.25) ? pick(rng, C.TASK_NOTES) : null,
      });
    }
    if (!s.changes.length || !s.ownerId) continue;
    const n = weighted(rng, [[0, 0.45], [1, 0.4], [2, 0.15]] as const);
    for (let i = 0; i < n; i++) {
      const createdAt = between(rng, s.created + 30 * MIN, Math.min(now, s.end) - 3 * HOUR);
      if (createdAt <= s.created || createdAt > Math.min(now, s.end) - 3 * HOUR) continue;
      const type = weighted(rng, [['follow_up', 0.35], ['call', 0.3], ['todo', 0.15], ['email', 0.1], ['meeting', 0.1]] as const);
      const due = createdAt + between(rng, 2 * HOUR, 3 * DAY);
      const cancelled = chance(rng, 0.08);
      addTask({
        s, type, title: fill(pick(rng, C.TASK_TITLES[type]), v), priority: weighted(rng, [['normal', 0.6], ['high', 0.25], ['low', 0.15]] as const), assigneeId: s.ownerId, createdById: s.ownerId, createdAt,
        dueAt: due, source: 'manual', status: cancelled ? 'cancelled' : 'done', completedAt: cancelled ? null : Math.min(now - MIN, Math.max(createdAt + 10 * MIN, due + between(rng, -HOUR, 20 * HOUR))),
      });
    }
  }
  for (const u of ctx.users) {
    if (u.kind === 'viewer') continue;
    const list = C.PERSONAL_TASKS[u.kind];
    for (const [i, p] of shuffle(rng, [...list]).slice(0, int(rng, 2, 3)).entries()) {
      const dueAt = i === 0 ? now + between(rng, 2 * HOUR, 4 * DAY) : i === 1 ? now - between(rng, 2 * DAY, 9 * DAY) : now - between(rng, 3 * HOUR, 30 * HOUR);
      addTask({ s: null, type: p.type, title: p.title, priority: p.priority, assigneeId: u.id, createdById: u.id, createdAt: dueAt - between(rng, DAY, 5 * DAY), dueAt, source: 'manual', status: i === 1 ? 'done' : 'open', completedAt: i === 1 ? dueAt + between(rng, -3 * HOUR, 5 * HOUR) : null });
    }
  }

  // ------------------------------------------------------------ notes, created, assigned, stage changes
  for (const s of states) {
    const v = vars(s);
    const author = s.ownerId ?? managerOf(null).id;
    const first = s.changes[0]?.at;
    if (first !== undefined && !s.touches.some((t) => t <= first) && !s.msgs.some((m) => m.direction === 'outbound' && m.type !== 'note' && m.at <= first)) {
      const at = Math.max(s.created + MIN, first - between(rng, MIN, 20 * MIN));
      act(s, at, 'note', { body: fill(pick(rng, C.FIRST_CONTACT_NOTES), v) }, user(author));
      s.touches.push(at);
    }
    const notes = weighted(rng, [[0, 0.4], [1, 0.35], [2, 0.18], [3, 0.07]] as const);
    for (let i = 0; i < notes; i++) {
      const at = between(rng, s.created + 15 * MIN, Math.min(now - MIN, s.end));
      if (at > s.created) act(s, at, 'note', { body: fill(pick(rng, C.LEAD_NOTES), v) }, user(author));
    }

    const manual = s.d.source === 'manual';
    const creator = s.ownerId ?? managerOf(null).id;
    act(s, s.created, 'lead_created', { source: s.d.source }, manual ? user(creator) : SYSTEM);
    if (s.ownerId) {
      const others = ctx.sales.filter((u) => u.id !== s.ownerId);
      const reassigned = others.length > 0 && chance(rng, 0.1) && s.end - s.created > 2 * HOUR;
      const firstTo = reassigned ? pick(rng, others).id : s.ownerId;
      const at = s.nurtureAssignAt ?? (manual ? s.created + SEC : s.created + between(rng, 20 * SEC, 10 * MIN));
      const actor = s.nurtureAssignAt ? WORKFLOW : manual ? user(creator) : SYSTEM;
      const rule = manual ? null : 'round_robin';
      act(s, at, 'assigned', { fromUserId: null, toUserId: firstTo, rule }, actor);
      h.events.assigned.push({ userId: firstTo, leadId: s.id, leadName: s.name, company: s.company, source: s.d.source, at });
      if (reassigned) {
        const at2 = between(rng, s.created + HOUR, Math.min(s.end, s.created + 10 * DAY));
        act(s, at2, 'assigned', { fromUserId: firstTo, toUserId: s.ownerId, rule: null }, user(managerOf(s.ownerId).id));
        h.events.assigned.push({ userId: s.ownerId, leadId: s.id, leadName: s.name, company: s.company, source: s.d.source, at: at2 });
      }
    }
    let from: string | null = ctx.stages[0]!.id;
    const stageActor = user(s.ownerId ?? managerOf(null).id);
    for (const c of s.changes) {
      const to = ctx.stages[c.to]!.id;
      act(s, c.at, 'stage_changed', { fromStageId: from, toStageId: to }, stageActor);
      from = to;
    }
  }

  // ------------------------------------------------------------ conversations, messages, consent
  for (const s of states) {
    if (!s.msgs.length || !s.phone) continue;
    s.msgs.sort((a, b) => a.at - b.at);
    if (s.optOutAt !== null) s.msgs = s.msgs.filter((m) => m.at <= s.optOutAt! || m.type === 'note');
    // 24 h rule: free-form text only within 24 h of the last inbound message; otherwise a template.
    let lastIn: number | null = null;
    for (const m of s.msgs) {
      if (m.direction === 'inbound') lastIn = m.at;
      else if (m.type === 'text' && (lastIn === null || m.at - lastIn > 24 * HOUR)) {
        const name = s.finalIdx === 3 ? 'quote_reminder' : 'indiamart_followup_1';
        const tpl = ctx.templates.get(name)!;
        Object.assign(m, { type: 'template', templateId: tpl.id, templateName: name, body: renderTemplate(tpl.body, [s.first]) });
      }
    }
    const real = s.msgs.filter((m) => m.type !== 'note');
    if (!real.length) continue;
    const lastOutIdx = real.reduce((a, m, i) => (m.direction === 'outbound' ? i : a), -1);
    const trailing = real.slice(lastOutIdx + 1).filter((m) => m.direction === 'inbound');
    const lastMsg = real[real.length - 1]!;
    const unread = trailing.length && lastMsg.at > now - 3 * DAY ? trailing.length : 0;
    const unreadIds = new Set(unread ? trailing.map((m) => m.id) : []);
    const conversationId = randomUUID();
    s.conversationId = conversationId;
    const inboundTimes = real.filter((m) => m.direction === 'inbound').map((m) => m.at);
    const lastInboundAt = inboundTimes.length ? Math.max(...inboundTimes) : null;
    const convStatus =
      s.optOutAt !== null || (s.closeAt !== null && lastMsg.at < now - 2 * DAY) || lastMsg.at < now - 7 * DAY ? 'closed' : lastMsg.direction === 'outbound' && now - lastMsg.at > DAY ? 'pending' : 'open';
    h.conversations.push({
      id: conversationId, workspaceId, channel: 'whatsapp', contactId: s.d.contact.id, leadId: s.id, assigneeId: s.ownerId, status: convStatus, unreadCount: unread,
      lastMessageAt: d(lastMsg.at), lastMessagePreview: lastMsg.body.slice(0, 120), lastInboundAt: lastInboundAt !== null ? d(lastInboundAt) : null,
      businessNumberId: ctx.business.phoneNumberId, createdAt: d(s.msgs[0]!.at), updatedAt: d(Math.max(...s.msgs.map((m) => m.at))),
    });
    for (const m of s.msgs) {
      const laterInbound = m.direction === 'outbound' && inboundTimes.some((t) => t > m.at);
      let status: MessageStatus;
      if (m.type === 'note') status = 'sent';
      else if (m.direction === 'inbound') status = unreadIds.has(m.id) ? 'delivered' : 'read';
      else if (m.error) status = 'failed';
      else if (laterInbound) status = 'read';
      else if (now - m.at < 2 * MIN) status = 'sent';
      else if (now - m.at < 3 * HOUR) status = chance(rng, 0.5) ? 'delivered' : 'read';
      else status = chance(rng, 0.75) ? 'read' : 'delivered';
      h.messages.push({
        id: m.id, workspaceId, conversationId, direction: m.direction, type: m.type, body: m.body, templateId: m.templateId, templateName: m.templateName, status, error: m.error,
        providerMessageId: m.type === 'note' ? null : `wamid.HBgM${hex(rng, 32).toUpperCase()}`, isInternalNote: m.type === 'note', authorId: m.authorId, workflowRunId: m.runId,
        createdAt: d(m.at), updatedAt: d(Math.min(now, m.at + (status === 'read' ? between(rng, MIN, 2 * HOUR) : SEC))),
      });
      if (m.type === 'note') continue;
      const actor: Actor = m.direction === 'inbound' ? SYSTEM : m.runId ? WORKFLOW : m.authorId ? user(m.authorId) : SYSTEM;
      act(s, m.at, 'message', { conversationId, messageId: m.id, direction: m.direction, preview: m.body.slice(0, 200) }, actor);
      if (m.direction === 'outbound' && !m.error) s.touches.push(m.at);
      if (m.direction === 'inbound') h.events.inbound.push({ userId: s.ownerId, conversationId, leadId: s.id, leadName: s.name, preview: m.body.slice(0, 120), at: m.at });
    }
  }
  for (const s of states) {
    if (s.optIn !== 'opted_in') continue;
    const firstIn = s.msgs.find((m) => m.direction === 'inbound');
    const src = s.d.source;
    const source = src === 'whatsapp' ? 'inbound_message' : src === 'website' ? 'web_form' : src === 'manual' ? 'manual' : 'api';
    const evidence: Json =
      src === 'whatsapp' && firstIn ? { messageId: firstIn.id, text: firstIn.body.slice(0, 80) }
      : src === 'website' ? { form: 'website-contact', page: '/contact', checkbox: 'I agree to receive WhatsApp updates' }
      : src === 'indiamart' ? { provider: 'IndiaMART', sourceRef: s.d.lead.sourceRef ?? null, note: 'Buyer opted in on the IndiaMART enquiry form' }
      : src === 'manual' ? { recordedBy: s.ownerId, note: 'Customer agreed on the phone' } : { provider: 'webhook', note: 'Consent flag in the payload' };
    h.consents.push({ id: randomUUID(), workspaceId, contactId: s.d.contact.id, channel: 'whatsapp', status: 'opted_in', source, evidence, createdAt: d(src === 'whatsapp' && firstIn ? firstIn.at : s.created) });
    if (s.optOutAt !== null) {
      h.consents.push({ id: randomUUID(), workspaceId, contactId: s.d.contact.id, channel: 'whatsapp', status: 'opted_out', source: 'keyword_stop', evidence: { keyword: 'STOP' }, createdAt: d(s.optOutAt) });
      s.optIn = 'opted_out';
    }
  }

  // ------------------------------------------------------------ derived lead, contact and deal fields
  for (const s of states) {
    const L = s.d.lead;
    const lastChange = s.changes[s.changes.length - 1]?.at ?? s.created;
    L.firstResponseAt = s.touches.length ? d(Math.max(s.created, Math.min(...s.touches))) : null;
    L.lastActivityAt = d(Math.min(now, s.lastAt));
    L.stageChangedAt = d(lastChange);
    L.wonAt = s.finalIdx === 4 && s.closeAt !== null ? d(s.closeAt) : null;
    L.lostAt = s.finalIdx === 5 && s.closeAt !== null ? d(s.closeAt) : null;
    L.updatedAt = d(Math.min(now, Math.max(s.lastAt, lastChange)));
    L.tags = [...s.tags];
    L.temperature = s.temperature;
    L.score = s.score;
    const cf: Record<string, string> = {};
    const code = C.GST_STATE_CODES[s.state];
    if (code && chance(rng, 0.4)) cf.gst_number = gstin(rng, code);
    if (chance(rng, 0.6)) cf.quantity = s.qty;
    if (chance(rng, 0.5)) cf.preferred_language = C.PREFERRED_LANGUAGE_BY_STATE[s.state] && chance(rng, 0.6) ? C.PREFERRED_LANGUAGE_BY_STATE[s.state]! : pick(rng, ['hi', 'en']);
    if (chance(rng, 0.25)) cf.delivery_by = dateKey(s.closeAt !== null ? s.closeAt + int(rng, 3, 20) * DAY : now + int(rng, 5, 40) * DAY);
    L.customFields = cf;
    if (s.optIn === 'opted_out') s.d.contact.whatsappOptIn = 'opted_out';
    s.d.contact.updatedAt = d(Math.max(s.created, s.optOutAt ?? s.created));
    if (s.d.deal) {
      s.d.deal.createdAt = d(s.changes[0]?.at ?? s.created);
      s.d.deal.closedAt = s.closeAt !== null ? d(s.closeAt) : null;
      s.d.deal.expectedCloseAt = s.closeAt === null ? d(startOfDay(now + int(rng, 5, 45) * DAY) + 18 * HOUR) : null;
      s.d.deal.updatedAt = d(s.closeAt ?? Math.min(now, s.lastAt));
    }
  }
  return h;
}
