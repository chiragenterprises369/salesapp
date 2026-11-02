import type { CallOutcome, MessageStatus, TargetMetric, TaskPriority, TaskType } from '../enums.js';
import type { Activity } from '../schemas/activity.js';
import type { Call } from '../schemas/call.js';
import type { Conversation, Message } from '../schemas/conversation.js';
import type { LeadListItem, SavedView } from '../schemas/lead.js';
import type { Notification } from '../schemas/notification.js';
import type { Task } from '../schemas/task.js';
import type { UserSummary } from '../schemas/workspace.js';
import type { WorkflowRun } from '../schemas/workflow.js';
import { EMPLOYEE_FIXTURES, SEED_WORKSPACE, WHATSAPP_TEMPLATE_FIXTURES } from './india.js';
import { int, pick, type Rng } from './mock.js';
import {
  between,
  DAY_MS,
  firstName,
  fixtureId,
  HOUR_MS,
  iso,
  istDate,
  istDayStart,
  istHour,
  istMonthStart,
  istPeriod,
  istWeekday,
  leadStory,
  memo,
  MINUTE_MS,
  rngFor,
  weighted,
  wonAt,
  worldLeadDetails,
  worldUuid,
  type ReplyIntent,
  type WorldContext,
} from './world-core.js';

/**
 * CRM world generators: tasks, calls, WhatsApp conversations, lead timelines, notifications,
 * targets and saved views for the main mock workspace. All of them link to the same users and
 * leads (mockUsers() / worldLeads()). Times are relative to `ctx.now`.
 */

const isoT = iso;
const summaryOf = (u: UserSummary): UserSummary => ({
  id: u.id,
  name: u.name,
  role: u.role,
  status: u.status,
  avatar: u.avatar,
});
const productOf = (lead: LeadListItem) =>
  worldLeadDetails(lead).productInterest ?? 'your requirement';
const isOpen = (ctx: WorldContext, lead: LeadListItem) =>
  ctx.stageById.get(lead.stageId)?.type === 'open';

/** A random time inside IST business hours (09:30-19:00) of the day starting at `dayStart`. */
const workTime = (rng: Rng, dayStart: number, from = 9.5, to = 19) =>
  dayStart + Math.round(between(rng, from, to) * 60) * MINUTE_MS;

// ---------------------------------------------------------------- tasks

const TASK_TITLES: Record<TaskType, Array<(l: LeadListItem, p: string) => string>> = {
  call: [
    (l) => `Call back ${l.name}`,
    (l, p) => `Call ${firstName(l.name)} about ${p}`,
    (l) => `Confirm quantity with ${l.name}`,
    (l) => `Discuss quote with ${l.name}`,
    (l) => `Call ${l.name} (no reply on WhatsApp)`,
  ],
  follow_up: [
    (l) => `Send revised quotation to ${l.companyName ?? l.name}`,
    (l) => `Follow up on sample feedback from ${l.name}`,
    (l) => `Check payment status with ${l.companyName ?? l.name}`,
    (l) => `Share GST invoice copy with ${l.companyName ?? l.name}`,
  ],
  todo: [
    (l) => `Share catalogue with ${l.name}`,
    (_l, p) => `Prepare quotation for ${p}`,
    (l) => `Update delivery schedule for ${l.companyName ?? l.name}`,
  ],
  meeting: [
    (l) => `Video call with ${l.name}`,
    (l) => `Factory visit at ${l.companyName ?? l.name}${l.city ? `, ${l.city}` : ''}`,
    (l) => `Product demo for ${l.companyName ?? l.name}`,
  ],
  email: [
    (l) => `Email price list to ${l.name}`,
    (l) => `Email proforma invoice to ${l.companyName ?? l.name}`,
  ],
};
const TASK_NOTES = [
  (p: string) => `Asked for price on ${p}`,
  () => 'Needs GST invoice and delivery within 10 days',
  () => 'Prefers a call after 4 pm',
  () => 'Customer ne bola kal tak final karenge',
  () => 'Comparing with two other suppliers, price is the main factor',
  (p: string) => `Wants a sample of ${p} before the bulk order`,
];
const PERSONAL_TASKS = [
  'Update the weekly pipeline sheet',
  'Prepare for the Monday sales review',
  'List pending payment follow-ups',
  'Clean up duplicate IndiaMART enquiries',
];
const TASK_TYPE_WEIGHTS: ReadonlyArray<readonly [TaskType, number]> = [
  ['call', 45],
  ['follow_up', 25],
  ['todo', 12],
  ['meeting', 10],
  ['email', 8],
];

function taskPriority(rng: Rng, lead: LeadListItem): TaskPriority {
  if (lead.temperature === 'hot')
    return weighted(rng, [
      ['urgent', 20],
      ['high', 55],
      ['normal', 25],
    ]);
  if (lead.temperature === 'warm')
    return weighted(rng, [
      ['high', 25],
      ['normal', 65],
      ['low', 10],
    ]);
  return weighted(rng, [
    ['normal', 60],
    ['low', 40],
  ]);
}

/**
 * Tasks for every owned lead: open tasks (overdue, due today, upcoming) on open leads, done and
 * cancelled history on all leads, plus a few personal to-dos per seller. About 8-15 calls to make
 * and 8-15 other tasks due today per seller.
 */
export function worldTasks(ctx: WorldContext): Task[] {
  return memo(ctx, 'tasks', () => {
    const { now } = ctx;
    const today = istDayStart(now);
    const out: Task[] = [];
    const make = (
      rng: Rng,
      lead: LeadListItem | null,
      assignee: UserSummary,
      t: Partial<Task> & Pick<Task, 'type' | 'title' | 'status' | 'dueAt'>,
      createdAt: number,
    ): Task => ({
      id: worldUuid(rng),
      notes: null,
      priority: 'normal',
      leadId: lead?.id ?? null,
      leadName: lead?.name ?? null,
      assignee: summaryOf(assignee),
      remindAt: null,
      snoozedUntil: null,
      completedAt: null,
      source: 'manual',
      workflowRunId: null,
      customFields: {},
      createdAt: isoT(createdAt),
      updatedAt: isoT(createdAt),
      ...t,
    });

    for (const lead of ctx.leads) {
      if (!lead.owner) continue;
      const rng = rngFor(`tasks:${lead.id}`);
      const story = leadStory(ctx, lead);
      const product = productOf(lead);
      const created = story.createdAt;
      // History: one done (or cancelled) task between the first touch and the close.
      if (rng() < 0.5) {
        const type = weighted(rng, TASK_TYPE_WEIGHTS);
        const lo = Math.min(now - MINUTE_MS, story.firstTouchAt);
        const done = lo + rng() * Math.max(0, Math.min(now, story.closedAt ?? now) - lo);
        const cancelled = rng() < 0.06;
        out.push(
          make(
            rng,
            lead,
            lead.owner,
            {
              type,
              title: pick(rng, TASK_TITLES[type])(lead, product),
              status: cancelled ? 'cancelled' : 'done',
              priority: taskPriority(rng, lead),
              dueAt: isoT(done + Math.round(between(rng, -120, 240)) * MINUTE_MS),
              completedAt: cancelled ? null : isoT(done),
              updatedAt: isoT(done),
              source: type === 'call' && rng() < 0.4 ? 'workflow' : 'manual',
            },
            Math.max(created, done - Math.round(between(rng, 1, 48)) * HOUR_MS),
          ),
        );
      }
      if (!isOpen(ctx, lead) || rng() >= 0.62) continue;
      const type = weighted(rng, TASK_TYPE_WEIGHTS);
      const bucket = weighted(rng, [
        ['overdue', 12],
        ['today', 22],
        ['upcoming', 66],
      ] as const);
      let due: number;
      if (bucket === 'overdue' && now - created > HOUR_MS)
        due = Math.max(
          created + 30 * MINUTE_MS,
          now - Math.round(between(rng, 30, 3 * 1440)) * MINUTE_MS,
        );
      else if (bucket === 'upcoming') due = workTime(rng, today + int(rng, 1, 10) * DAY_MS, 10, 18);
      else due = workTime(rng, today);
      const createdAt = Math.max(
        created,
        Math.min(now - 5 * MINUTE_MS, due - Math.round(between(rng, 1, 48)) * HOUR_MS),
      );
      const fromWorkflow = type === 'call' && rng() < 0.5;
      out.push(
        make(
          rng,
          lead,
          lead.owner,
          {
            type,
            title: fromWorkflow
              ? `Call ${lead.name} (no reply on WhatsApp)`
              : pick(rng, TASK_TITLES[type])(lead, product),
            notes: rng() < 0.35 ? pick(rng, TASK_NOTES)(product) : null,
            status: 'open',
            priority: fromWorkflow ? 'high' : taskPriority(rng, lead),
            dueAt: isoT(due),
            remindAt: type === 'call' || type === 'meeting' ? isoT(due - 15 * MINUTE_MS) : null,
            source: fromWorkflow ? 'workflow' : 'manual',
          },
          createdAt,
        ),
      );
    }
    for (const seller of ctx.sellers) {
      const rng = rngFor(`tasks:personal:${seller.id}`);
      for (const [i, title] of PERSONAL_TASKS.entries()) {
        if (i > 1 && rng() < 0.5) continue;
        const due = workTime(rng, today + (i === 0 ? 0 : int(rng, 0, 3)) * DAY_MS, 11, 18);
        out.push(
          make(
            rng,
            null,
            seller,
            { type: 'todo', title, status: 'open', dueAt: isoT(due) },
            Math.min(now - HOUR_MS, due - 2 * DAY_MS),
          ),
        );
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------- calls

const CALL_NOTES = [
  'Discussed quantity and delivery schedule.',
  'Customer wants 5% discount for advance payment.',
  'Bola kal tak PO bhej denge.',
  'Asked to call after 4 pm, in a meeting.',
  'Shared rate on call, will send quotation on WhatsApp.',
  'Needs sample first, courier address taken.',
  'Purchase head not available, call again tomorrow.',
  'Already buying from a local supplier, price sensitive.',
];
const DISPOSITIONS: Record<CallOutcome, string[]> = {
  answered: [
    'Discussed requirement',
    'Shared price on call',
    'Confirmed delivery date',
    'Follow-up scheduled',
  ],
  interested: ['Interested - send quote', 'Asked for samples', 'Ready to order'],
  callback: ['Call back later', 'Busy, call tomorrow'],
  not_interested: ['Price too high', 'Bought elsewhere', 'Not interested'],
  voicemail: ['Left voicemail'],
  wrong_number: ['Wrong number'],
  missed: [],
};
const OUTBOUND_OUTCOMES: ReadonlyArray<readonly [CallOutcome, number]> = [
  ['answered', 34],
  ['interested', 12],
  ['callback', 12],
  ['not_interested', 7],
  ['missed', 22],
  ['voicemail', 10],
  ['wrong_number', 3],
];
const INBOUND_OUTCOMES: ReadonlyArray<readonly [CallOutcome, number]> = [
  ['answered', 55],
  ['interested', 15],
  ['callback', 5],
  ['missed', 25],
];
const TALK_SEC: Record<CallOutcome, [number, number]> = {
  answered: [45, 480],
  interested: [120, 720],
  callback: [20, 90],
  not_interested: [20, 120],
  voicemail: [15, 35],
  wrong_number: [5, 20],
  missed: [0, 0],
};
/** Calls per working day by fixture title. */
function callsPerDay(rng: Rng, key: string, title: string): number {
  if (key.startsWith('manager')) return int(rng, 5, 11);
  if (title === 'Field Sales') return int(rng, 5, 10);
  return int(rng, 16, 30);
}

/** Index of the first lead created after `t` (leads sorted by createdAt). */
function createdBefore(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Calls of the last 30 days for every seller (IST business hours, Monday-Saturday), inbound and
 * outbound, with outcomes, durations, notes, dispositions and recordings; today's calls stop at
 * `now`; sellers whose status is on_call have one call in progress. Newest first.
 */
export function worldCalls(ctx: WorldContext): Call[] {
  return memo(ctx, 'calls', () => {
    const { now } = ctx;
    const today = istDayStart(now);
    const out: Call[] = [];
    for (const seller of ctx.sellers) {
      const fx = EMPLOYEE_FIXTURES.find((e) => e.name === seller.name)!;
      const mine = ctx.leadsByOwner.get(seller.id) ?? [];
      const times = mine.map((l) => Date.parse(l.createdAt));
      const own = ctx.phoneOf.get(seller.id) ?? '+919810000000';
      for (let d = 29; d >= 0; d--) {
        const dayStart = today - d * DAY_MS;
        const weekday = istWeekday(dayStart + 12 * HOUR_MS);
        if (weekday === 6) continue;
        const rng = rngFor(`calls:${seller.id}:${istDate(dayStart + 12 * HOUR_MS)}`);
        const n = Math.round(callsPerDay(rng, fx.key, fx.title) * (weekday === 5 ? 0.5 : 1));
        const starts = Array.from({ length: n }, () => workTime(rng, dayStart, 9.75, 18.75)).sort(
          (a, b) => a - b,
        );
        for (const start of starts) {
          const id = worldUuid(rng);
          const inbound = rng() < 0.22;
          const outcome = weighted(rng, inbound ? INBOUND_OUTCOMES : OUTBOUND_OUTCOMES);
          const failed = !inbound && rng() < 0.015;
          const upto = createdBefore(times, start);
          const recentFrom = createdBefore(times, start - 7 * DAY_MS);
          const lead =
            upto === 0 || (inbound && rng() < 0.15)
              ? null
              : mine[
                  rng() < 0.6 && upto > recentFrom
                    ? int(rng, recentFrom, upto - 1)
                    : int(rng, 0, upto - 1)
                ]!;
          const [lo, hi] = TALK_SEC[outcome];
          const talk = failed ? 0 : int(rng, lo, hi);
          const ring = int(rng, 4, 18) * 1000;
          const noteRoll = rng();
          if (start > now) continue;
          const missed = outcome === 'missed' || failed;
          const other =
            lead?.phone ??
            `+91${pick(rng, ['9', '8', '7'])}${String(int(rng, 0, 999_999_999)).padStart(9, '0')}`;
          out.push({
            id,
            direction: inbound ? 'inbound' : 'outbound',
            status: failed ? 'failed' : missed ? 'missed' : 'completed',
            outcome: failed ? null : outcome,
            leadId: lead?.id ?? null,
            leadName: lead?.name ?? null,
            user: summaryOf(seller),
            from: inbound ? other : own,
            to: inbound ? own : other,
            startedAt: isoT(start),
            answeredAt: missed ? null : isoT(start + ring),
            endedAt: isoT(Math.min(now, start + ring + (missed ? 22_000 : talk * 1000))),
            durationSec: missed ? 0 : talk,
            hasRecording: !missed && talk > 10 && outcome !== 'voicemail',
            notes:
              !missed && noteRoll < 0.35
                ? CALL_NOTES[Math.floor(noteRoll * 100) % CALL_NOTES.length]!
                : null,
            disposition: missed
              ? null
              : (DISPOSITIONS[outcome][
                  Math.floor(noteRoll * 1000) % DISPOSITIONS[outcome].length
                ] ?? null),
            provider: 'mock',
            customFields: {},
            source: 'mock',
            result: failed ? 'failed' : missed ? (inbound ? 'missed' : 'no_answer') : 'connected',
            phone: other,
            deviceCallId: null,
            recordingFileId: null,
          });
        }
      }
      if (seller.status === 'on_call') {
        const rng = rngFor(`calls:live:${seller.id}`);
        const lead = mine.length
          ? mine[mine.length - 1 - int(rng, 0, Math.min(10, mine.length - 1))]!
          : null;
        const start = now - int(rng, 40, 360) * 1000;
        out.push({
          id: worldUuid(rng),
          direction: 'outbound',
          status: 'in_progress',
          outcome: null,
          leadId: lead?.id ?? null,
          leadName: lead?.name ?? null,
          user: summaryOf(seller),
          from: own,
          to: lead?.phone ?? '+919999999999',
          startedAt: isoT(start),
          answeredAt: isoT(start + 9000),
          endedAt: null,
          durationSec: 0,
          hasRecording: false,
          notes: null,
          disposition: null,
          provider: 'mock',
          customFields: {},
          source: 'mock',
          result: null,
          phone: lead?.phone ?? '+919999999999',
          deviceCallId: null,
          recordingFileId: null,
        });
      }
    }
    return out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  });
}

// ---------------------------------------------------------------- WhatsApp conversations

const OPENERS = [
  'Hi, I saw your listing. {req}',
  'Namaste, {product} ka rate chahiye.',
  'Hello, need {product}. Please share details.',
  'Hi, kya aap {city} mein delivery karte ho?',
];
const INBOUND_BY_INTENT: Record<ReplyIntent, string[]> = {
  price: [
    'Rate kya hai? GST ke saath batana',
    'Please share best price with GST',
    'Kitna lagega 500 pcs ka?',
    'PRICE',
    'Price list bhej dijiye',
    'What is the rate per kg delivered to our factory?',
  ],
  catalog: [
    'CATALOG',
    'Catalogue bhej do please',
    'Send catalogue and photos please',
    'Details share karo, specification chahiye',
    'Brochure milega?',
  ],
  not_interested: [
    'Not interested now, thanks',
    'Abhi zarurat nahi hai',
    'Nahi chahiye, already bought',
    'Please stop messages',
  ],
  other: [
    'Call me after 4 pm',
    'Delivery kab tak hogi?',
    'Is installation included?',
    'Kal baat karte hain',
    'Can you share your GST number and address?',
    'Sample mil sakta hai?',
  ],
};
const AGENT_REPLY: Record<ReplyIntent, string[]> = {
  price: [
    'Ji sir, price list share kar di hai. Quantity confirm kar dijiye, best rate denge.',
    'Sure, sharing the quotation with GST shortly.',
    'Namaste ji, rate list bhej di hai. Freight extra rahega.',
  ],
  catalog: [
    'Catalogue bhej diya hai sir. Koi model pasand aaye toh batana.',
    'Sharing our latest catalogue. Let me know which items you need.',
  ],
  not_interested: [
    'Theek hai sir, future mein zarurat ho toh zaroor batana.',
    'No problem, thank you for letting us know.',
  ],
  other: [
    'Ji sir, main 4 baje call karta hoon.',
    'Delivery 7-10 din mein ho jayegi.',
    'Yes, installation is included within city limits.',
    'Sure, sharing GST and address details now.',
  ],
};
const FOLLOW_INBOUND = [
  'Quotation mil gaya, thoda discount milega?',
  'Payment terms kya hain?',
  'Can you do delivery by next week?',
  'Thik hai, PO bhejta hoon kal tak',
  'Please call, I am free now',
  'Sample received, quality achhi hai',
  'Final rate kya hoga 2 tonne ka?',
  'GST invoice milega na?',
  'Ok noted, will confirm by evening',
];
const FOLLOW_OUTBOUND = [
  'Ji sir, 3% discount possible hai for advance payment.',
  '50% advance, balance before dispatch.',
  'Haan ji, dispatch Monday tak ho jayega.',
  'Thank you sir, PO milte hi confirm karte hain.',
  'Calling you in 5 minutes.',
  'Glad you liked it. Shall we book the order?',
  'Yes, GST invoice will be shared with the dispatch.',
];
const WON_INBOUND = [
  'Order confirm. PO bhej diya hai.',
  'Payment done, please share dispatch details.',
];
const INTERNAL_NOTES = [
  'Customer wants 5% discount, checking with Anil sir.',
  'Old customer, give priority dispatch.',
  'Ask for advance before confirming.',
];

export function renderTemplate(name: string, lead: LeadListItem): string {
  const t = WHATSAPP_TEMPLATE_FIXTURES.find((x) => x.name === name);
  if (!t) return name;
  return t.body
    .replace('{{1}}', firstName(lead.name))
    .replace('{{2}}', name === 'missed_call_sorry' ? '11:20 am' : SEED_WORKSPACE.name)
    .replace('{{3}}', productOf(lead));
}

export interface WorldInbox {
  conversations: Conversation[];
  /** Oldest first per conversation. */
  messagesByConversation: Map<string, Message[]>;
  conversationByLead: Map<string, Conversation>;
}

/**
 * WhatsApp conversations for about 40% of leads: automated templates (welcome, price list,
 * catalogue, follow-up, quote reminder), Hinglish and English replies, agent answers, internal
 * notes, delivered/read/failed statuses, unread counts and the 24 h customer-service window.
 */
export function worldInbox(ctx: WorldContext): WorldInbox {
  return memo(ctx, 'inbox', () => {
    const { now } = ctx;
    const conversations: Conversation[] = [];
    const messagesByConversation = new Map<string, Message[]>();
    const conversationByLead = new Map<string, Conversation>();
    for (const lead of ctx.leads) {
      const story = leadStory(ctx, lead);
      if (!story.whatsapp) continue;
      const rng = rngFor(`chat:${lead.id}`);
      const id = worldUuid(rng);
      const contactId = worldUuid(rng);
      const owner = lead.owner ? summaryOf(lead.owner) : null;
      const product = productOf(lead);
      const msgs: Message[] = [];
      const add = (
        at: number,
        m: Pick<Message, 'direction' | 'type' | 'body'> & Partial<Message>,
      ) => {
        if (at > now - 30_000) return;
        msgs.push({
          id: worldUuid(rng),
          conversationId: id,
          templateName: null,
          media: null,
          status: 'read',
          error: null,
          isInternalNote: false,
          author: null,
          createdAt: isoT(at),
          ...m,
        });
      };
      const template = (at: number, name: string, failed = false) =>
        add(at, {
          direction: 'outbound',
          type: 'template',
          body: renderTemplate(name, lead),
          templateName: name,
          status: failed ? 'failed' : 'read',
          error: failed
            ? 'Template could not be delivered: this number has not opted in to WhatsApp messages'
            : null,
        });
      const created = story.createdAt;
      const closed = story.closedAt;
      const won = ctx.stageById.get(lead.stageId)?.type === 'won';
      if (lead.source === 'whatsapp') {
        add(created, {
          direction: 'inbound',
          type: 'text',
          body: pick(rng, OPENERS)
            .replace('{req}', worldLeadDetails(lead).requirement ?? '')
            .replace('{product}', product)
            .replace('{city}', lead.city ?? 'aapke city'),
        });
        add(story.firstTouchAt, {
          direction: 'outbound',
          type: 'text',
          body: `Namaste ${firstName(lead.name)} ji, thank you for your message. ${pick(rng, AGENT_REPLY.price)}`,
          author: owner,
        });
      } else {
        template(story.firstTouchAt, 'indiamart_welcome', story.welcomeFailed);
      }
      if (story.replied && story.replyAt && story.intent) {
        add(story.replyAt, {
          direction: 'inbound',
          type: 'text',
          body: pick(rng, INBOUND_BY_INTENT[story.intent]),
        });
        const answer = story.replyAt + Math.round(between(rng, 2, 25)) * MINUTE_MS;
        if (story.intent === 'price') template(answer, 'price_list');
        if (story.intent === 'catalog') {
          template(answer, 'product_catalog');
          add(answer + 20_000, {
            direction: 'outbound',
            type: 'document',
            body: null,
            media: {
              fileId: worldUuid(rng),
              mime: 'application/pdf',
              name: 'Shakti-Industries-catalogue-2026.pdf',
              size: int(rng, 1_200_000, 4_800_000),
            },
            author: owner,
          });
        }
        add(answer + Math.round(between(rng, 1, 40)) * MINUTE_MS, {
          direction: 'outbound',
          type: 'text',
          body: pick(rng, AGENT_REPLY[story.intent]),
          author: owner,
        });
      } else if (
        !story.welcomeFailed &&
        lead.source !== 'whatsapp' &&
        story.firstTouchAt + DAY_MS < now
      ) {
        template(
          story.firstTouchAt + DAY_MS + int(rng, 0, 120) * MINUTE_MS,
          'indiamart_followup_1',
        );
      }
      // Later back-and-forth, sometimes ending with fresh unread messages from the customer.
      const base = (story.replyAt ?? story.firstTouchAt) + HOUR_MS;
      const recent = closed === null && story.replied && rng() < 0.3;
      const end = recent
        ? now - Math.round(between(rng, 5, 22 * 60)) * MINUTE_MS
        : Math.min(now - HOUR_MS, (closed ?? now) + int(rng, 0, 12) * HOUR_MS);
      const extra = story.replied && end > base ? int(rng, recent ? 2 : 0, 5) : 0;
      const times = Array.from({ length: extra }, () => base + rng() * (end - base)).sort(
        (a, b) => a - b,
      );
      if (recent && times.length) times[times.length - 1] = end;
      const endsInbound = recent && rng() < 0.55;
      times.forEach((t, i) => {
        const inbound = endsInbound ? (times.length - 1 - i) % 2 === 0 : i % 2 === 0;
        if (inbound)
          add(t, {
            direction: 'inbound',
            type: 'text',
            body:
              won && i === times.length - 1 ? pick(rng, WON_INBOUND) : pick(rng, FOLLOW_INBOUND),
          });
        else
          add(t, {
            direction: 'outbound',
            type: 'text',
            body: pick(rng, FOLLOW_OUTBOUND),
            author: owner,
          });
      });
      if (story.replied && rng() < 0.08 && owner)
        add(base + 30 * MINUTE_MS, {
          direction: 'outbound',
          type: 'note',
          body: pick(rng, INTERNAL_NOTES),
          isInternalNote: true,
          author: owner,
        });
      const quoteAt = story.stagePath.find(
        (s) => ctx.stageById.get(s.stageId)?.key === 'quote_sent',
      )?.at;
      // Quote reminders went out until the workflow was paused three days ago.
      if (quoteAt && quoteAt + 2 * DAY_MS < now - 72 * HOUR_MS)
        template(quoteAt + 2 * DAY_MS, 'quote_reminder', rng() < 0.25);
      if (!msgs.length) continue;
      msgs.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

      // Statuses: recent outbound may still be sent/delivered; trailing inbound is unread.
      let unread = 0;
      for (let i = msgs.length - 1; i >= 0 && msgs[i]!.direction === 'inbound'; i--) unread++;
      if (Date.parse(msgs[msgs.length - 1]!.createdAt) < now - 2 * DAY_MS) unread = 0;
      msgs.forEach((m, i) => {
        if (m.status === 'failed') return;
        const age = now - Date.parse(m.createdAt);
        let status: MessageStatus;
        if (m.direction === 'inbound') status = i >= msgs.length - unread ? 'delivered' : 'read';
        else if (age < 10 * MINUTE_MS) status = 'sent';
        else if (age < 6 * HOUR_MS) status = rng() < 0.5 ? 'delivered' : 'read';
        else status = rng() < 0.12 ? 'delivered' : 'read';
        m.status = status;
      });
      const visible = msgs.filter((m) => !m.isInternalNote);
      const last = visible[visible.length - 1] ?? msgs[msgs.length - 1]!;
      const lastInbound = [...msgs].reverse().find((m) => m.direction === 'inbound');
      const lastInboundAt = lastInbound ? Date.parse(lastInbound.createdAt) : null;
      const conversation: Conversation = {
        id,
        channel: 'whatsapp',
        contactId,
        contactName: lead.name,
        contactPhone: lead.phone ?? '+919999999999',
        leadId: lead.id,
        assignee: owner,
        status:
          closed !== null && closed < now - DAY_MS
            ? 'closed'
            : last.direction === 'outbound'
              ? 'pending'
              : 'open',
        unreadCount: unread,
        lastMessagePreview: (
          last.body ?? (last.media ? `Document: ${last.media.name}` : 'Message')
        ).slice(0, 120),
        lastMessageAt: last.createdAt,
        lastInboundAt: lastInboundAt === null ? null : isoT(lastInboundAt),
        windowExpiresAt: lastInboundAt === null ? null : isoT(lastInboundAt + 24 * HOUR_MS),
        optIn: story.welcomeFailed
          ? null
          : story.intent === 'not_interested' && rng() < 0.3
            ? 'opted_out'
            : 'opted_in',
      };
      conversations.push(conversation);
      messagesByConversation.set(id, msgs);
      conversationByLead.set(lead.id, conversation);
    }
    conversations.sort((a, b) => ((a.lastMessageAt ?? '') < (b.lastMessageAt ?? '') ? 1 : -1));
    return { conversations, messagesByConversation, conversationByLead };
  });
}

// ---------------------------------------------------------------- lead timeline

const TIMELINE_NOTES = [
  'Asked for GST invoice and delivery within 10 days. Prefers calls after 4 pm.',
  'Comparing with two other suppliers; price is the main factor.',
  'Wants a sample before the bulk order. Shared the courier address on WhatsApp.',
  'Decision maker is the purchase head, Mr. Mehta. Follow up on Monday.',
  'Repeat buyer from last Diwali season. Offer the same payment terms.',
  'Customer bola budget thoda tight hai, 5% discount pe close ho sakta hai.',
  'Factory visit planned next week. Take samples and the price list.',
  'Payment 30 days credit chahiye. Checking with Anil sir.',
];

export interface LeadTimelineInput {
  calls: readonly Call[];
  tasks: readonly Task[];
  messages: readonly Message[];
  runs: readonly WorkflowRun[];
  /** Workflow name per workflow id (for workflow_step entries). */
  workflowNames: ReadonlyMap<string, string>;
}

/**
 * Unified timeline of one lead, newest first: created, assigned, stage changes, calls, WhatsApp
 * messages, emails, notes, tasks, files, field edits and workflow steps, all from the world data.
 */
export function worldLeadTimeline(
  ctx: WorldContext,
  lead: LeadListItem,
  input: LeadTimelineInput,
): Activity[] {
  const { now } = ctx;
  const rng = rngFor(`timeline:${lead.id}`);
  const story = leadStory(ctx, lead);
  const owner = lead.owner ? summaryOf(lead.owner) : null;
  const admin = summaryOf(ctx.users.find((u) => u.role === 'company_admin') ?? ctx.users[0]!);
  const out: Activity[] = [];
  const at = (t: number) => isoT(Math.min(now - MINUTE_MS, t));
  const base = () => ({ id: worldUuid(rng), leadId: lead.id });
  const span = Math.max(MINUTE_MS, Math.min(now, story.closedAt ?? now) - story.createdAt);
  const within = (lo: number, hi: number) => story.createdAt + span * between(rng, lo, hi);

  out.push({
    ...base(),
    type: 'lead_created',
    actor: lead.source === 'manual' ? owner : null,
    createdAt: at(story.createdAt),
    payload: { source: lead.source },
  });
  if (lead.owner) {
    const reassigned =
      rng() < 0.15
        ? pick(
            rng,
            ctx.sellers.filter((s) => s.id !== lead.owner!.id),
          )
        : null;
    if (reassigned) {
      out.push({
        ...base(),
        type: 'assigned',
        actor: null,
        createdAt: at(story.createdAt + 40_000),
        payload: { fromUserId: null, toUserId: reassigned.id, rule: 'round_robin' },
      });
      out.push({
        ...base(),
        type: 'assigned',
        actor: admin,
        createdAt: at(within(0.05, 0.2)),
        payload: { fromUserId: reassigned.id, toUserId: lead.owner.id, rule: null },
      });
    } else {
      out.push({
        ...base(),
        type: 'assigned',
        actor: null,
        createdAt: at(story.createdAt + 40_000),
        payload: { fromUserId: null, toUserId: lead.owner.id, rule: 'round_robin' },
      });
    }
  }
  for (let i = 1; i < story.stagePath.length; i++) {
    const step = story.stagePath[i]!;
    if (step.at > now) break;
    out.push({
      ...base(),
      type: 'stage_changed',
      actor: owner,
      createdAt: at(step.at),
      payload: { fromStageId: story.stagePath[i - 1]!.stageId, toStageId: step.stageId },
    });
  }
  for (const c of input.calls) {
    if (c.status === 'in_progress') continue;
    out.push({
      ...base(),
      type: 'call',
      actor: c.user,
      createdAt: c.startedAt,
      payload: {
        callId: c.id,
        status: c.status,
        outcome: c.outcome,
        durationSec: c.durationSec,
        hasRecording: c.hasRecording,
      },
    });
  }
  for (const m of input.messages) {
    if (m.isInternalNote) {
      out.push({
        ...base(),
        type: 'note',
        actor: m.author,
        createdAt: m.createdAt,
        payload: { body: m.body ?? '' },
      });
      continue;
    }
    out.push({
      ...base(),
      type: 'message',
      actor: m.direction === 'outbound' ? m.author : null,
      createdAt: m.createdAt,
      payload: {
        conversationId: m.conversationId,
        messageId: m.id,
        direction: m.direction,
        preview: (m.body ?? (m.media ? `Document: ${m.media.name}` : 'Message')).slice(0, 200),
      },
    });
  }
  const notes = int(rng, 1, 3);
  for (let i = 0; i < notes; i++)
    out.push({
      ...base(),
      type: 'note',
      actor: owner ?? admin,
      createdAt: at(within(0.1, 0.95)),
      payload: { body: pick(rng, TIMELINE_NOTES) },
    });
  if (lead.email && rng() < 0.35) {
    const t = within(0.3, 0.8);
    out.push({
      ...base(),
      type: 'email',
      actor: owner,
      createdAt: at(t),
      payload: {
        subject: `Quotation for ${productOf(lead)} - ${SEED_WORKSPACE.name}`,
        direction: 'outbound',
      },
    });
    if (rng() < 0.6)
      out.push({
        ...base(),
        type: 'email',
        actor: null,
        createdAt: at(t + int(rng, 2, 30) * HOUR_MS),
        payload: { subject: `Re: Quotation for ${productOf(lead)}`, direction: 'inbound' },
      });
  }
  if (
    story.stagePath.some((s) => ctx.stageById.get(s.stageId)?.key === 'quote_sent') &&
    rng() < 0.6
  ) {
    out.push({
      ...base(),
      type: 'file_uploaded',
      actor: owner,
      createdAt: at(within(0.5, 0.9)),
      payload: {
        fileId: worldUuid(rng),
        name: `Quotation-${(lead.companyName ?? lead.name).replace(/\s+/g, '-')}.pdf`,
        size: int(rng, 80_000, 450_000),
      },
    });
  }
  if (rng() < 0.2) {
    const from = Math.round((lead.valueInr * between(rng, 0.6, 0.95)) / 500) * 500;
    out.push({
      ...base(),
      type: 'field_updated',
      actor: owner,
      createdAt: at(within(0.4, 0.9)),
      payload: { field: 'valueInr', from, to: lead.valueInr },
    });
  }
  for (const t of input.tasks) {
    if (Date.parse(t.createdAt) <= now)
      out.push({
        ...base(),
        type: 'task_created',
        actor: t.source === 'workflow' ? null : t.assignee,
        createdAt: t.createdAt,
        payload: { taskId: t.id, title: t.title },
      });
    if (t.completedAt)
      out.push({
        ...base(),
        type: 'task_completed',
        actor: t.assignee,
        createdAt: t.completedAt,
        payload: { taskId: t.id, title: t.title },
      });
  }
  for (const run of input.runs) {
    for (const s of run.steps ?? []) {
      // Plain waits and branches that simply passed add noise; keep actions, failures and waits in progress.
      const quietLogic =
        s.nodeType.startsWith('logic.') &&
        s.status === 'succeeded' &&
        s.nodeType !== 'logic.dedupe' &&
        s.nodeType !== 'logic.stop';
      if (!s.startedAt || quietLogic) continue;
      out.push({
        ...base(),
        type: 'workflow_step',
        actor: null,
        createdAt: s.startedAt,
        payload: {
          workflowId: run.workflowId,
          workflowName: input.workflowNames.get(run.workflowId) ?? 'Workflow',
          runId: run.id,
          nodeId: s.nodeId,
          nodeType: s.nodeType,
          status: s.status,
          summary: s.summary ?? s.nodeType,
        },
      });
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

// ---------------------------------------------------------------- notifications

export interface WorldNotificationInput {
  tasks: readonly Task[];
  inbox: WorldInbox;
  runs: readonly WorkflowRun[];
  /** Workflow template key per workflow id (deep links). */
  workflowKeys: ReadonlyMap<string, string>;
}

/**
 * 25-40 notifications for one user, newest first, about a quarter unread: new leads assigned,
 * tasks due and overdue, WhatsApp replies, failed workflow steps (admins and managers), mentions,
 * import results and system notices. `href` is relative to the panel ("/leads?lead=<id>").
 */
export function worldNotifications(
  ctx: WorldContext,
  userId: string,
  input: WorldNotificationInput,
): Notification[] {
  const { now } = ctx;
  const user = ctx.users.find((u) => u.id === userId);
  if (!user) return [];
  const rng = rngFor(`notifications:${userId}`);
  const list: Array<Omit<Notification, 'readAt'>> = [];
  const push = (
    n: Omit<Notification, 'id' | 'readAt' | 'data'> & { data?: Notification['data'] },
  ) => {
    if (Date.parse(n.createdAt) > now) return;
    list.push({ id: worldUuid(rng), data: {}, ...n });
  };
  const mine = (ctx.leadsByOwner.get(userId) ?? []).slice(-14).reverse();
  for (const l of mine) {
    push({
      type: 'lead_assigned',
      title: `New lead assigned: ${l.name}`,
      body: [l.companyName, l.city].filter(Boolean).join(', ') || null,
      href: `/leads?lead=${l.id}`,
      data: { leadId: l.id },
      createdAt: isoT(Date.parse(l.createdAt) + 45_000),
    });
  }
  const open = input.tasks.filter(
    (t) => t.assignee?.id === userId && t.status === 'open' && t.dueAt,
  );
  for (const t of open
    .filter((t) => Date.parse(t.dueAt!) < now)
    .sort((a, b) => (a.dueAt! < b.dueAt! ? 1 : -1))
    .slice(0, 6)) {
    push({
      type: 'task_overdue',
      title: `Overdue: ${t.title}`,
      body: t.leadName ? `Lead ${t.leadName}` : null,
      href: t.leadId ? `/leads?lead=${t.leadId}` : '/tasks',
      data: { taskId: t.id },
      createdAt: isoT(Date.parse(t.dueAt!) + 5 * MINUTE_MS),
    });
  }
  for (const t of open
    .filter((t) => Date.parse(t.dueAt!) >= now && Date.parse(t.dueAt!) - now < 4 * HOUR_MS)
    .slice(0, 4)) {
    push({
      type: 'task_due',
      title: `Due soon: ${t.title}`,
      body: t.leadName ? `Lead ${t.leadName}` : null,
      href: '/tasks',
      data: { taskId: t.id },
      createdAt: isoT(Math.min(now - MINUTE_MS, Date.parse(t.dueAt!) - 30 * MINUTE_MS)),
    });
  }
  const chats = input.inbox.conversations
    .filter(
      (c) =>
        (user.role === 'company_admin' ? c.assignee === null : c.assignee?.id === userId) &&
        c.lastInboundAt,
    )
    .slice(0, 9);
  for (const c of chats) {
    const msgs = input.inbox.messagesByConversation.get(c.id) ?? [];
    const inbound = [...msgs].reverse().find((m) => m.direction === 'inbound');
    push({
      type: 'message_received',
      title: `WhatsApp reply from ${c.contactName}`,
      body: inbound?.body ? `“${inbound.body.slice(0, 90)}”` : null,
      href: `/inbox?conversation=${c.id}`,
      data: { conversationId: c.id, leadId: c.leadId },
      createdAt: c.lastInboundAt!,
    });
  }
  if (user.role === 'company_admin' || user.role === 'manager') {
    for (const r of input.runs.filter((r) => r.status === 'failed').slice(0, 4)) {
      push({
        type: 'workflow_failed',
        title: `Workflow step failed for ${r.leadName ?? 'a lead'}`,
        body: r.error,
        href: `/workflows/${input.workflowKeys.get(r.workflowId) ?? ''}`,
        data: { runId: r.id },
        createdAt: r.finishedAt ?? r.startedAt,
      });
    }
    const manager = ctx.users.find((u) => u.role === 'manager' && u.id !== userId);
    for (let i = 0; i < 3; i++) {
      const l = pick(rng, ctx.leads);
      push({
        type: 'mention',
        title: `${manager?.name ?? 'A teammate'} mentioned you on ${l.name}`,
        body: '“Can you approve a 5% discount for this one?”',
        href: `/leads?lead=${l.id}`,
        createdAt: isoT(now - int(rng, 30, 6 * 1440) * MINUTE_MS),
      });
    }
  } else {
    const manager = ctx.users.find((u) => u.role === 'manager');
    for (let i = 0; i < 3 && mine.length; i++) {
      const l = pick(rng, mine);
      push({
        type: 'mention',
        title: `${manager?.name ?? 'Your manager'} mentioned you on ${l.name}`,
        body: pick(rng, [
          '“Please call them before 5 pm today.”',
          '“Send the revised quote today, they are ready to order.”',
          '“Is the sample dispatched?”',
        ]),
        href: `/leads?lead=${l.id}`,
        createdAt: isoT(now - int(rng, 20, 5 * 1440) * MINUTE_MS),
      });
    }
  }
  if (user.role === 'company_admin' || user.role === 'viewer') {
    push({
      type: 'import_completed',
      title: 'Import finished: 312 leads added',
      body: '14 duplicates skipped (matched by phone). 2 rows had errors.',
      href: '/leads',
      createdAt: isoT(now - int(rng, 26, 70) * HOUR_MS),
    });
    push({
      type: 'system',
      title: 'Weekly report is ready',
      body: 'Conversion rose to 21% last week. IndiaMART is still the top source.',
      href: '/reports',
      createdAt: isoT(istDayStart(now) - (istWeekday(now) + 0) * DAY_MS + 9 * HOUR_MS),
    });
  }
  push({
    type: 'system',
    title: 'Diwali holiday added to business hours',
    body: 'Leads arriving on 8 Nov wait unassigned until the team is back.',
    href: null,
    createdAt: isoT(now - int(rng, 3, 9) * DAY_MS),
  });
  push({
    type: 'system',
    title: 'WhatsApp template approved: price_list',
    body: 'Meta approved the template. Workflows can use it now.',
    href: null,
    createdAt: isoT(now - int(rng, 10, 20) * DAY_MS),
  });
  // Older assignments fill the list up to the target size.
  const target = int(rng, 25, 40);
  const older = (ctx.leadsByOwner.get(userId) ?? []).slice(0, -14).reverse();
  for (const l of older) {
    if (list.length >= target) break;
    push({
      type: 'lead_assigned',
      title: `New lead assigned: ${l.name}`,
      body: [l.companyName, l.city].filter(Boolean).join(', ') || null,
      href: `/leads?lead=${l.id}`,
      data: { leadId: l.id },
      createdAt: isoT(Date.parse(l.createdAt) + 45_000),
    });
  }
  for (let i = 0; list.length < 25; i++) {
    push({
      type: 'system',
      title: pick(rng, [
        'Business hours updated',
        'New team member joined: Farah Khan',
        'Lead routing switched to round robin',
        'IndiaMART sync reconnected',
      ]),
      body: null,
      href: null,
      createdAt: isoT(now - (8 + i) * DAY_MS - int(rng, 0, 600) * MINUTE_MS),
    });
  }
  return list
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, target)
    .map((n, i) => {
      const age = now - Date.parse(n.createdAt);
      const unread =
        i < 2 ||
        (age < 3 * HOUR_MS && rng() < 0.55) ||
        (age < DAY_MS && rng() < 0.2) ||
        (age < 3 * DAY_MS && rng() < 0.05);
      return {
        ...n,
        readAt: unread
          ? null
          : isoT(Math.min(now, Date.parse(n.createdAt) + int(rng, 2, 180) * MINUTE_MS)),
      };
    });
}

// ---------------------------------------------------------------- targets

export interface MockTarget {
  id: string;
  subjectType: 'user' | 'team';
  subjectId: string;
  subjectName: string;
  metric: TargetMetric;
  /** YYYY-MM (workspace timezone). */
  period: string;
  target: number;
  achieved: number;
}

const roundTo = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);

/**
 * Monthly targets for every seller and team, for the current and the previous month. Targets come
 * from each person's last-30-day pace; achieved values are counted from the world (calls, won
 * leads by close date, leads that reached Interested).
 */
export function worldTargets(ctx: WorldContext): MockTarget[] {
  return memo(ctx, 'targets', () => {
    const { now } = ctx;
    const calls = worldCalls(ctx)
      .filter((c) => c.status !== 'in_progress' && c.user)
      .map((c) => ({ userId: c.user!.id, t: Date.parse(c.startedAt) }));
    const interestedId = ctx.stages.find((s) => s.key === 'interested')?.id;
    const periods = [istMonthStart(now, -1), istMonthStart(now, 0)];
    const out: MockTarget[] = [];
    const tally = (userIds: Set<string>, from: number, to: number) => {
      const res: Record<TargetMetric, number> = {
        revenue_inr: 0,
        deals_won: 0,
        calls: 0,
        leads_converted: 0,
      };
      for (const c of calls) if (c.t >= from && c.t < to && userIds.has(c.userId)) res.calls++;
      for (const id of userIds) {
        for (const l of ctx.leadsByOwner.get(id) ?? []) {
          const w = wonAt(ctx, l);
          if (w !== null && w >= from && w < to && w <= now) {
            res.deals_won++;
            res.revenue_inr += l.valueInr;
          }
          const reached = leadStory(ctx, l).stagePath.find((s) => s.stageId === interestedId)?.at;
          if (reached !== undefined && reached >= from && reached < to && reached <= now)
            res.leads_converted++;
        }
      }
      return res;
    };
    const subjects = [
      ...ctx.sellers.map((u) => ({
        type: 'user' as const,
        id: u.id,
        name: u.name,
        members: new Set([u.id]),
      })),
      ...ctx.teams.map((t) => ({
        type: 'team' as const,
        id: t.id,
        name: t.name,
        members: new Set(t.memberIds),
      })),
    ];
    for (const s of subjects) {
      const pace = tally(s.members, now - 30 * DAY_MS, now + 1);
      const rng = rngFor(`targets:${s.id}`);
      const stretch = between(rng, 1.0, 1.25);
      const goal: Record<TargetMetric, number> = {
        revenue_inr: roundTo(pace.revenue_inr * stretch, 50_000),
        deals_won: roundTo(pace.deals_won * stretch, 1),
        calls: roundTo(pace.calls * stretch, 10),
        leads_converted: roundTo(pace.leads_converted * stretch, 1),
      };
      for (const from of periods) {
        const to = istMonthStart(from + 2 * DAY_MS, 1);
        const got = tally(s.members, from, to);
        for (const metric of ['revenue_inr', 'deals_won', 'calls', 'leads_converted'] as const) {
          out.push({
            id: worldUuid(rng),
            subjectType: s.type,
            subjectId: s.id,
            subjectName: s.name,
            metric,
            period: istPeriod(from + DAY_MS),
            target: goal[metric],
            achieved: got[metric],
          });
        }
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------- saved views

/** Saved views of the Leads page (shared team views and personal ones). */
export function worldSavedViews(ctx: WorldContext): SavedView[] {
  const stage = (key: string) => ctx.stages.find((s) => s.key === key)!.id;
  const manager = ctx.users.find((u) => u.role === 'manager')!;
  const rep = ctx.users.find((u) => u.role === 'employee')!;
  const cols = ['name', 'company', 'stage', 'owner', 'value', 'score', 'nextFollowUp'];
  const view = (
    n: number,
    v: Omit<SavedView, 'id' | 'entity' | 'columns' | 'viewMode'> &
      Partial<Pick<SavedView, 'columns' | 'viewMode'>>,
  ): SavedView => ({
    id: fixtureId('a1', n),
    entity: 'lead',
    columns: cols,
    viewMode: null,
    ...v,
  });
  return [
    view(1, {
      name: 'Hot IndiaMART enquiries',
      filters: { source: ['indiamart'], temperature: ['hot'], sort: 'score', dir: 'desc' },
      isShared: true,
      ownerId: null,
    }),
    view(2, {
      name: 'Unassigned leads',
      filters: { ownerId: ['unassigned'], sort: 'createdAt', dir: 'desc' },
      isShared: true,
      ownerId: null,
      viewMode: 'table',
    }),
    view(3, {
      name: 'Quotes above ₹1L',
      filters: { stageId: [stage('quote_sent')], scoreMin: 40, sort: 'valueInr', dir: 'desc' },
      isShared: true,
      ownerId: manager.id,
    }),
    view(4, {
      name: 'Export buyers',
      filters: { tag: ['export'], sort: 'valueInr', dir: 'desc' },
      isShared: true,
      ownerId: manager.id,
    }),
    view(5, {
      name: 'Lost this month',
      filters: {
        stageId: [stage('lost')],
        createdFrom: isoT(istMonthStart(ctx.now, -1)),
        sort: 'updatedAt',
        dir: 'desc',
      },
      isShared: false,
      ownerId: manager.id,
      viewMode: 'table',
    }),
    view(6, {
      name: 'My follow-ups',
      filters: {
        ownerId: ['me'],
        stageId: [stage('contacted'), stage('interested')],
        sort: 'nextFollowUpAt',
        dir: 'asc',
      },
      isShared: false,
      ownerId: rep.id,
    }),
    view(7, {
      name: 'WhatsApp leads this week',
      filters: {
        source: ['whatsapp'],
        createdFrom: isoT(istDayStart(ctx.now) - istWeekday(ctx.now) * DAY_MS),
      },
      isShared: true,
      ownerId: null,
    }),
  ];
}

/** Hours (IST) a seller made calls in, for charts: hour -> [answered, missed]. */
export function callsByIstHour(calls: readonly Call[]): Map<number, [number, number]> {
  const m = new Map<number, [number, number]>();
  for (const c of calls) {
    if (c.status === 'in_progress') continue;
    const h = istHour(Date.parse(c.startedAt));
    const v = m.get(h) ?? [0, 0];
    if (c.status === 'completed') v[0]++;
    else v[1]++;
    m.set(h, v);
  }
  return m;
}
