import type { Activity, Lead, Task, UserSummary } from '@vistar/shared';
import {
  createRng,
  int,
  mockPipeline,
  mockUuid,
  pick,
  REQUIREMENT_SNIPPETS,
  WHATSAPP_TEMPLATE_FIXTURES,
} from '@vistar/shared/fixtures';

/**
 * Deterministic mock timeline and tasks for a lead (Wave 1). Shapes match ActivitySchema / TaskSchema
 * so the components work unchanged when GET /leads/{id}/timeline and /tasks?leadId= land.
 */
const stages = mockPipeline().stages;

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

const NOTES = [
  'Asked for GST invoice and delivery within 10 days. Prefers calls after 4 pm.',
  'Comparing with two other suppliers; price is the main factor.',
  'Wants a sample before the bulk order. Shared the courier address on WhatsApp.',
  'Decision maker is the purchase head, Mr. Mehta. Follow up on Monday.',
  'Repeat buyer from last Diwali season. Offer the same payment terms.',
];

const INBOUND = [
  'Please share best price with GST.',
  'Is installation included?',
  'Send catalogue please',
  'Call me after 4 pm',
  'What is the delivery time to our factory?',
];

export function mockTimeline(lead: Lead, users: UserSummary[], now = Date.now()): Activity[] {
  const rng = createRng(seedOf(lead.id));
  const created = new Date(lead.createdAt).getTime();
  const span = Math.max(
    60_000,
    Math.min(now, new Date(lead.lastActivityAt ?? lead.updatedAt).getTime() + 3 * 86_400_000) -
      created,
  );
  const at = (frac: number) =>
    new Date(Math.min(now - 60_000, created + span * frac)).toISOString();
  const owner = lead.owner ?? (users.length ? pick(rng, users) : null);
  const out: Activity[] = [];
  const base = () => ({ id: mockUuid(rng), leadId: lead.id });

  out.push({
    ...base(),
    type: 'lead_created',
    actor: lead.source === 'manual' ? owner : null,
    createdAt: lead.createdAt,
    payload: { source: lead.source },
  });

  const runId = mockUuid(rng);
  const workflowId = mockUuid(rng);
  if (lead.source === 'indiamart' || lead.source === 'website') {
    out.push({
      ...base(),
      type: 'workflow_step',
      actor: null,
      createdAt: at(0.01),
      payload: {
        workflowId,
        workflowName: 'IndiaMART nurturing',
        runId,
        nodeId: 'dedupe',
        nodeType: 'logic.dedupe',
        status: 'succeeded',
        summary: 'No duplicate found by phone',
      },
    });
  }
  if (lead.owner) {
    out.push({
      ...base(),
      type: 'assigned',
      actor: null,
      createdAt: at(0.02),
      payload: { fromUserId: null, toUserId: lead.owner.id, rule: 'round_robin' },
    });
  }
  const welcome = WHATSAPP_TEMPLATE_FIXTURES[0]!;
  out.push({
    ...base(),
    type: 'message',
    actor: null,
    createdAt: at(0.03),
    payload: {
      conversationId: runId,
      messageId: mockUuid(rng),
      direction: 'outbound',
      preview: welcome.body
        .replace('{{1}}', lead.name.split(' ')[0] ?? '')
        .replace('{{2}}', 'Shakti Industries')
        .replace('{{3}}', 'your requirement')
        .slice(0, 200),
    },
  });
  if (lead.source === 'indiamart') {
    out.push({
      ...base(),
      type: 'workflow_step',
      actor: null,
      createdAt: at(0.035),
      payload: {
        workflowId,
        workflowName: 'IndiaMART nurturing',
        runId,
        nodeId: 'welcome',
        nodeType: 'action.send_whatsapp_template',
        status: 'succeeded',
        summary: 'Sent template indiamart_welcome',
      },
    });
  }
  if (rng() < 0.75) {
    out.push({
      ...base(),
      type: 'message',
      actor: null,
      createdAt: at(0.08),
      payload: {
        conversationId: runId,
        messageId: mockUuid(rng),
        direction: 'inbound',
        preview: pick(rng, INBOUND),
      },
    });
  }
  const calls = int(rng, 1, 3);
  for (let i = 0; i < calls; i++) {
    const missed = rng() < 0.3;
    out.push({
      ...base(),
      type: 'call',
      actor: owner,
      createdAt: at(0.15 + i * 0.25 + rng() * 0.1),
      payload: {
        callId: mockUuid(rng),
        status: missed ? 'missed' : 'completed',
        outcome: missed ? 'missed' : pick(rng, ['answered', 'interested', 'callback'] as const),
        durationSec: missed ? 0 : int(rng, 35, 420),
        hasRecording: !missed,
      },
    });
  }
  const stageIdx = stages.findIndex((s) => s.id === lead.stageId);
  let prev: string | null = stages[0]!.id;
  const openSteps = Math.min(stageIdx, 3);
  for (let i = 1; i <= openSteps; i++) {
    const to = stages[i]!.id;
    out.push({
      ...base(),
      type: 'stage_changed',
      actor: owner,
      createdAt: at(0.3 + i * 0.12),
      payload: { fromStageId: prev, toStageId: to },
    });
    prev = to;
  }
  if (stageIdx > 3) {
    out.push({
      ...base(),
      type: 'stage_changed',
      actor: owner,
      createdAt: at(0.9),
      payload: { fromStageId: prev, toStageId: lead.stageId },
    });
  }
  out.push({
    ...base(),
    type: 'note',
    actor: owner,
    createdAt: at(0.55),
    payload: { body: pick(rng, NOTES) },
  });
  if (rng() < 0.5)
    out.push({
      ...base(),
      type: 'note',
      actor: owner,
      createdAt: at(0.2),
      payload: { body: `Requirement: ${pick(rng, REQUIREMENT_SNIPPETS)}` },
    });
  if (stageIdx >= 2) {
    out.push({
      ...base(),
      type: 'workflow_step',
      actor: null,
      createdAt: at(0.7),
      payload: {
        workflowId: mockUuid(rng),
        workflowName: 'Quote reminder',
        runId: mockUuid(rng),
        nodeId: 'reminder',
        nodeType: 'action.send_whatsapp_template',
        status: rng() < 0.2 ? 'failed' : 'waiting',
        summary: 'Waiting 2 days before the quote reminder',
      },
    });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function mockTasks(lead: Lead, now = Date.now()): Task[] {
  const rng = createRng(seedOf(lead.id) ^ 0x9e3779b9);
  const first = lead.name.split(' ')[0] ?? lead.name;
  const due = lead.nextFollowUpAt ?? new Date(now + 86_400_000).toISOString();
  const mk = (
    title: string,
    type: Task['type'],
    dueAt: string | null,
    status: Task['status'],
    priority: Task['priority'],
  ): Task => ({
    id: mockUuid(rng),
    type,
    title,
    notes: null,
    status,
    priority,
    leadId: lead.id,
    leadName: lead.name,
    assignee: lead.owner,
    dueAt,
    remindAt: null,
    snoozedUntil: null,
    completedAt:
      status === 'done' ? new Date(now - int(rng, 1, 72) * 3_600_000).toISOString() : null,
    source: rng() < 0.4 ? 'workflow' : 'manual',
    workflowRunId: null,
    customFields: {},
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  });
  const tasks = [
    mk(
      `Call ${first} to confirm quantity and delivery`,
      'call',
      due,
      'open',
      lead.temperature === 'hot' ? 'high' : 'normal',
    ),
  ];
  if (rng() < 0.6)
    tasks.push(
      mk(
        'Send revised quotation with GST',
        'follow_up',
        new Date(new Date(due).getTime() + 2 * 86_400_000).toISOString(),
        'open',
        'normal',
      ),
    );
  tasks.push(mk('Share product catalogue on WhatsApp', 'todo', null, 'done', 'low'));
  return tasks;
}
