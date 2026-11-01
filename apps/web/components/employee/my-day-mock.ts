import type { Call, CallOutcome, LeadListItem, MeResponse, MyToday, Task, TaskPriority, TaskType, UserSummary } from '@vistar/shared';
import { createRng, int, mockLeads, mockUuid, pick, PRODUCTS } from '@vistar/shared/fixtures';

/**
 * Wave 1 mock for the Employee panel. Uses the same lead records as the Leads mock source
 * (mockLeads(240, 7), so ids open the right lead) owned by the signed-in user, with times shifted
 * around "now" so the day looks current. Wave 3: GET /me/today, GET /tasks?scope=mine, GET /calls.
 */
const MIN = 60_000;
const HOUR = 60 * MIN;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function myLeads(me: MeResponse): LeadListItem[] {
  const all = mockLeads(240, 7);
  const mine = all.filter((l) => l.owner?.id === me.user.id);
  // Managers/admins with few own leads still get a realistic day.
  return mine.length >= 12 ? mine : [...mine, ...all.filter((l) => !mine.includes(l))].slice(0, 16);
}

function summary(me: MeResponse): UserSummary {
  return { id: me.user.id, name: me.user.name, role: me.user.role, status: me.user.status, avatar: me.user.avatar };
}

function task(me: MeResponse, rng: () => number, lead: LeadListItem, type: TaskType, title: string, dueAt: number, priority: TaskPriority, now: number, notes: string | null = null): Task {
  return {
    id: mockUuid(rng),
    type,
    title,
    notes,
    status: 'open',
    priority,
    leadId: lead.id,
    leadName: lead.name,
    assignee: summary(me),
    dueAt: new Date(dueAt).toISOString(),
    remindAt: null,
    snoozedUntil: null,
    completedAt: null,
    source: type === 'call' ? 'workflow' : 'manual',
    workflowRunId: null,
    createdAt: new Date(now - 6 * HOUR).toISOString(),
    updatedAt: new Date(now - 6 * HOUR).toISOString(),
  };
}

export interface MyDay {
  today: MyToday;
  /** Phone numbers for leads referenced by tasks (tasks only carry leadId/leadName). */
  phones: Record<string, string | null>;
  /** Upcoming tasks after today (Tasks page). */
  later: Task[];
}

export function buildMyDay(me: MeResponse, nowMs: number): MyDay {
  const rng = createRng(hashSeed(me.user.id));
  const leads = myLeads(me);
  const at = (i: number) => leads[i % leads.length]!;
  const product = () => pick(rng, PRODUCTS).name;

  const callsToMake = [
    task(me, rng, at(0), 'call', `Call back ${at(0).name}`, nowMs - 40 * MIN, 'high', nowMs, `Asked for price on ${product()}`),
    task(me, rng, at(1), 'call', `Call ${at(1).name}: no reply on WhatsApp`, nowMs + 30 * MIN, 'high', nowMs),
    task(me, rng, at(2), 'call', `Confirm delivery date with ${at(2).name}`, nowMs + 2 * HOUR, 'normal', nowMs),
  ];
  const tasksDue = [
    task(me, rng, at(3), 'follow_up', `Send revised quotation to ${at(3).companyName ?? at(3).name}`, nowMs - 90 * MIN, 'urgent', nowMs),
    task(me, rng, at(4), 'todo', `Share catalogue with ${at(4).name}`, nowMs + 75 * MIN, 'normal', nowMs),
    task(me, rng, at(5), 'meeting', `Video call with ${at(5).name}`, nowMs + 4 * HOUR, 'normal', nowMs),
  ];
  const later = [
    task(me, rng, at(6), 'follow_up', `Check sample feedback from ${at(6).name}`, nowMs + 26 * HOUR, 'normal', nowMs),
    task(me, rng, at(7), 'email', `Email GST invoice to ${at(7).companyName ?? at(7).name}`, nowMs + 50 * HOUR, 'low', nowMs),
  ];
  const followUps = [at(8), at(9), at(10)].map((l, i) => ({ ...l, nextFollowUpAt: new Date(nowMs + [-26 * 60, 45, 5 * 60][i]! * MIN).toISOString() }));
  const newAssigned = [at(11), at(12), at(13)].map((l, i) => ({ ...l, createdAt: new Date(nowMs - [18, 140, 320][i]! * MIN).toISOString() }));

  const d = new Date(nowMs);
  const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const wonInr = int(rng, 22, 40) * 10_000;
  const phones = Object.fromEntries(leads.map((l) => [l.id, l.phone]));

  return {
    phones,
    later,
    today: {
      tasksDue,
      followUps,
      callsToMake,
      newAssigned,
      targets: [
        { metric: 'revenue_inr', period, target: 5_00_000, achieved: wonInr },
        { metric: 'deals_won', period, target: 8, achieved: int(rng, 3, 7) },
        { metric: 'calls', period, target: 600, achieved: int(rng, 280, 520) },
        { metric: 'leads_converted', period, target: 12, achieved: int(rng, 4, 13) },
      ],
      stats: {
        callsToday: int(rng, 8, 22),
        talkSecToday: int(rng, 1800, 5400),
        leadsContactedToday: int(rng, 5, 14),
        wonInrThisMonth: wonInr,
        rank: me.workspace.showEmployeeRank ? int(rng, 1, 6) : null,
      },
      generatedAt: new Date(nowMs).toISOString(),
    },
  };
}

/** Recent calls (most recent first) for the Calls page. */
export function buildRecentCalls(me: MeResponse, nowMs: number): Call[] {
  const rng = createRng(hashSeed(`${me.user.id}:calls`));
  const leads = myLeads(me);
  const outcomes: CallOutcome[] = ['interested', 'answered', 'missed', 'callback', 'not_interested', 'answered', 'voicemail', 'interested'];
  let t = nowMs - 12 * MIN;
  return outcomes.map((outcome, i) => {
    const lead = leads[(i + 3) % leads.length]!;
    const inbound = outcome === 'missed' || i === 5;
    const duration = outcome === 'missed' ? 0 : outcome === 'voicemail' ? int(rng, 20, 40) : int(rng, 45, 420);
    const startedAt = t;
    t -= int(rng, 18, 70) * MIN;
    return {
      id: mockUuid(rng),
      direction: inbound ? 'inbound' : 'outbound',
      status: outcome === 'missed' ? 'missed' : 'completed',
      outcome,
      leadId: lead.id,
      leadName: lead.name,
      user: summary(me),
      from: inbound ? (lead.phone ?? '+919000000000') : (me.user.phone ?? '+919000000000'),
      to: inbound ? (me.user.phone ?? '+919000000000') : (lead.phone ?? '+919000000000'),
      startedAt: new Date(startedAt).toISOString(),
      answeredAt: outcome === 'missed' ? null : new Date(startedAt + 8_000).toISOString(),
      endedAt: new Date(startedAt + duration * 1000 + 8_000).toISOString(),
      durationSec: duration,
      hasRecording: outcome !== 'missed',
      notes: null,
      disposition: null,
      provider: 'mock',
    } satisfies Call;
  });
}

/** Weekly call counts (Mon..Sun) for My performance. */
export function buildWeekCalls(me: MeResponse): number[] {
  const rng = createRng(hashSeed(`${me.user.id}:week`));
  return Array.from({ length: 7 }, (_, i) => (i === 6 ? int(rng, 0, 4) : int(rng, 14, 38)));
}
