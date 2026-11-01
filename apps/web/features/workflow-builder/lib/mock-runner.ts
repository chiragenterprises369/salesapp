import {
  NODE_CATALOG,
  renderTemplate,
  WHATSAPP_WINDOW_HOURS,
  type BusinessHours,
  type CompareOp,
  type DomainEvent,
  type LeadSource,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowRunStatus,
  type WorkflowRunStep,
  type WorkflowStepStatus,
} from '@vistar/shared';
import { mockUsers } from '@vistar/shared/fixtures';
import { isTrigger, outputsOf } from './catalog';
import { enumLabel, stageName } from './labels';
import { approvedTemplate, previewContext, type TemplateContext } from './preview';
import { dueText } from './summary';

/**
 * Wave 1 mock test run. Walks the draft graph locally and emits `workflow.step_updated` /
 * `workflow.run_updated` shaped events, the same envelopes the builder will receive from the
 * `run:<id>` room in Wave 3. Dry run: nothing is sent.
 */

export interface TestRunInput {
  lead: { name: string; phone: string; source: LeadSource };
  /** Pretend the lead replied with this text (empty = no reply). */
  simulateReply: string;
  /** 0 = skip waits; 1 = hold each wait for the longest preview pause. */
  waitScale: number;
  optedOut: boolean;
  /** The lead messaged us within the last 24 h before the run (WhatsApp window open). */
  recentInbound: boolean;
}

export type RunEvent = DomainEvent<'workflow.step_updated'> | DomainEvent<'workflow.run_updated'>;

/** Time a step shows as running before its result. */
export const RUN_STEP_MS = 280;
/** Time a packet travels along the next edge. */
export const PACKET_MS = 360;
const MAX_WAIT_HOLD_MS = 2400;
const MAX_STEPS = 200;

interface StepResult {
  status: WorkflowStepStatus;
  branch: string | null;
  summary: string;
  error: string | null;
  holdMs?: number;
  stop?: boolean;
}

const USERS = mockUsers();
const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
const iso = () => new Date().toISOString();

export function runContext(
  input: TestRunInput,
  workspaceName: string,
  ownerName: string | null,
): TemplateContext {
  const first = input.lead.name.trim().split(/\s+/)[0] ?? '';
  return previewContext({
    'lead.name': input.lead.name,
    'lead.firstName': first,
    'lead.phone': input.lead.phone,
    'lead.source': input.lead.source,
    'workspace.name': workspaceName,
    'reply.text': input.simulateReply,
    ...(ownerName ? { 'owner.name': ownerName } : {}),
  });
}

function get(ctx: TemplateContext, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, k) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined,
      ctx,
    );
}

export function compare(actual: unknown, op: CompareOp, expected: unknown): boolean {
  const a = typeof actual === 'string' ? actual.toLowerCase() : actual;
  const list = (Array.isArray(expected) ? expected : [expected]).map((v) =>
    typeof v === 'string' ? v.toLowerCase() : v,
  );
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  switch (op) {
    case 'exists':
      return a !== undefined && a !== null && a !== '';
    case 'eq':
      return list.some((v) => String(v) === String(a));
    case 'neq':
      return list.every((v) => String(v) !== String(a));
    case 'in':
      return list.some((v) => String(v) === String(a));
    case 'contains':
      return (
        typeof a === 'string' &&
        list.some((v) => typeof v === 'string' && v.length > 0 && a.includes(v))
      );
    case 'gt':
      return num(a) > num(list[0]);
    case 'gte':
      return num(a) >= num(list[0]);
    case 'lt':
      return num(a) < num(list[0]);
    case 'lte':
      return num(a) <= num(list[0]);
  }
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Is `now` inside business hours in the workspace timezone? Returns the next opening if not. */
export function businessHoursState(
  hours: BusinessHours,
  timeZone: string,
  now = new Date(),
): { open: boolean; nextOpening: string | null } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const day = WEEKDAYS.findIndex((d) => d === String(parts.weekday).slice(0, 3).toLowerCase());
  const hhmm = `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  const slots = (d: number) =>
    (hours as Record<string, Array<{ start: string; end: string }>>)[WEEKDAYS[d]!] ?? [];
  if (slots(day).some((s) => hhmm >= s.start && hhmm < s.end))
    return { open: true, nextOpening: null };
  for (let i = 0; i < 8; i++) {
    const d = (day + i) % 7;
    const next = slots(d).find((s) => i > 0 || s.start > hhmm);
    if (next) {
      const label = i === 0 ? 'today' : i === 1 ? 'tomorrow' : enumLabel(WEEKDAYS[d]!);
      return { open: false, nextOpening: `${label} at ${next.start}` };
    }
  }
  return { open: false, nextOpening: null };
}

export function startMockRun(opts: {
  graph: WorkflowGraph;
  workflowId: string;
  workspaceId: string;
  workspaceName: string;
  businessHours: BusinessHours;
  timeZone: string;
  input: TestRunInput;
  onEvent: (e: RunEvent) => void;
}): { runId: string; cancel: () => void } {
  const { graph, input } = opts;
  const runId = uuid();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let cancelled = false;
  let steps = 0;
  const visits = new Map<string, number>();
  const state = {
    sentMessage: false,
    inboundAt: input.recentInbound ? Date.now() - 60 * 60 * 1000 : (null as number | null),
    owner: null as string | null,
  };
  const reply = input.simulateReply.trim();
  const ctx = () => runContext(input, opts.workspaceName, state.owner);
  const first = input.lead.name.trim().split(/\s+/)[0] || 'The lead';

  const envelope = <E extends RunEvent['type']>(
    type: E,
    payload: Extract<RunEvent, { type: E }>['payload'],
  ) =>
    ({
      id: uuid(),
      type,
      workspaceId: opts.workspaceId,
      occurredAt: iso(),
      actor: { type: 'workflow', id: opts.workflowId, name: 'Test run' },
      payload,
    }) as Extract<RunEvent, { type: E }>;

  const later = (ms: number, fn: () => void) => {
    timers.push(
      setTimeout(() => {
        if (!cancelled) fn();
      }, ms),
    );
  };

  const runUpdated = (status: WorkflowRunStatus) =>
    opts.onEvent(
      envelope('workflow.run_updated', {
        runId,
        workflowId: opts.workflowId,
        leadId: null,
        status,
        isTest: true,
      }),
    );

  const stepEvent = (step: WorkflowRunStep, nextEdgeId: string | null) =>
    opts.onEvent(
      envelope('workflow.step_updated', { runId, workflowId: opts.workflowId, step, nextEdgeId }),
    );

  const edgeFor = (node: WorkflowNode, handle: string | null): WorkflowEdge | null =>
    graph.edges.find(
      (e) => e.source === node.id && (e.sourceHandle ?? 'out') === (handle ?? 'out'),
    ) ?? null;

  const replyArrives = () => {
    if (reply && state.inboundAt === null) state.inboundAt = Date.now();
  };

  const guard = (node: WorkflowNode): StepResult | null => {
    if (input.optedOut)
      return {
        status: 'skipped',
        branch: 'out',
        summary: `Skipped: ${first} opted out of messages (DND). The run continues.`,
        error: 'CONSENT_OPTED_OUT',
      };
    if (node.type === 'action.send_whatsapp_template') {
      const name = String((node.data.config as Record<string, unknown>).templateName ?? '');
      if (!approvedTemplate(name))
        return {
          status: 'failed',
          branch: null,
          summary: `Template "${name || 'none'}" is not approved. Pick an approved template.`,
          error: 'WHATSAPP_TEMPLATE_NOT_APPROVED',
        };
    }
    if (node.type === 'action.send_whatsapp_text') {
      const open =
        state.inboundAt !== null && Date.now() - state.inboundAt < WHATSAPP_WINDOW_HOURS * 3600_000;
      if (!open)
        return {
          status: 'skipped',
          branch: 'out',
          summary: `Skipped: no message from ${first} in the last ${WHATSAPP_WINDOW_HOURS} hours, so free-form WhatsApp is blocked. Use an approved template.`,
          error: 'WHATSAPP_WINDOW_CLOSED',
        };
    }
    return null;
  };

  const quietNote = () => {
    const bh = businessHoursState(opts.businessHours, opts.timeZone);
    return bh.open
      ? ''
      : ` Outside business hours: a live run would send ${bh.nextOpening ?? 'at the next opening'}.`;
  };

  const execute = (node: WorkflowNode, visit: number): StepResult => {
    const c = node.data.config as Record<string, unknown>;
    const def = NODE_CATALOG[node.type];
    const ok = (summary: string, branch: string | null = 'out'): StepResult => ({
      status: 'succeeded',
      branch,
      summary,
      error: null,
    });

    if (def.sendsMessage) {
      const blocked = guard(node);
      if (blocked) return blocked;
      state.sentMessage = true;
      const note = quietNote();
      switch (node.type) {
        case 'action.send_whatsapp_template':
          return ok(
            `Sent template ${String(c.templateName)} to ${input.lead.phone} (dry run).${note}`,
          );
        case 'action.send_whatsapp_text':
          return ok(`Sent WhatsApp message to ${input.lead.phone} (dry run).${note}`);
        case 'action.send_email':
          return ok(
            `Sent email "${renderTemplate(String(c.subject ?? ''), ctx())}" (dry run).${note}`,
          );
        default:
          return ok(`Sent SMS to ${input.lead.phone} (dry run).${note}`);
      }
    }

    switch (node.type) {
      case 'trigger.indiamart_lead':
        return ok(`New IndiaMART enquiry from ${input.lead.name}`);
      case 'trigger.call_missed':
        return ok(`Missed call from ${input.lead.phone}`);
      case 'trigger.whatsapp_message':
        return ok(`WhatsApp message from ${input.lead.name}`);
      case 'trigger.schedule':
        return ok(`Scheduled run picked ${input.lead.name}`);
      case 'trigger.stage_changed':
        return ok(
          `${input.lead.name} moved to ${stageName(String(c.toStageKey ?? '')) || 'a new stage'}`,
        );
      case 'action.upsert_contact':
        return ok(
          c.createDeal === false
            ? `Created contact ${input.lead.name}`
            : `Created contact ${input.lead.name} and a deal`,
        );
      case 'action.assign_owner': {
        const pool = (c.userIds as string[] | undefined)?.length
          ? (c.userIds as string[])
          : USERS.filter((u) => u.role === 'employee').map((u) => u.id);
        const strategy = String(c.strategy ?? 'round_robin');
        const pick = strategy === 'least_busy' ? pool[pool.length > 2 ? 2 : 0] : pool[0];
        const user = USERS.find((u) => u.id === pick);
        state.owner = user?.name ?? null;
        return ok(
          user
            ? `Assigned to ${user.name} (${enumLabel(strategy).toLowerCase()})`
            : 'No one available to assign; owner unchanged',
        );
      }
      case 'action.create_task': {
        const who =
          c.assignTo === 'user'
            ? (USERS.find((u) => u.id === c.userId)?.name ?? 'the chosen user')
            : (state.owner ?? 'the lead owner');
        return ok(
          `Created task "${renderTemplate(String(c.title ?? ''), ctx())}" for ${who}, due in ${dueText(Number(c.dueInMinutes ?? 60))}`,
        );
      }
      case 'action.create_call_task':
        return ok(
          `Created call task "${renderTemplate(String(c.title ?? ''), ctx())}", due in ${dueText(Number(c.dueInMinutes ?? 30))}`,
        );
      case 'action.add_tag':
        return ok(`Added tags ${((c.tags as string[]) ?? []).join(', ')}`);
      case 'action.change_stage':
        return ok(`Moved ${input.lead.name} to ${stageName(String(c.stageKey ?? ''))}`);
      case 'action.update_field':
        return ok(`Set ${String(c.field)} to ${String(c.value)}`);
      case 'action.outbound_webhook': {
        let host = String(c.url ?? '');
        try {
          host = new URL(host).host;
        } catch {
          /* keep raw */
        }
        return ok(`Would POST the lead to ${host} (dry run, not sent)`);
      }
      case 'logic.wait': {
        const amount = Number(c.amount ?? 0);
        const unit = String(c.unit ?? 'hours');
        const label = `${amount} ${c.businessHoursOnly ? 'business ' : ''}${amount === 1 ? unit.replace(/s$/, '') : unit}`;
        if (c.resumeOnReply && reply && state.sentMessage) {
          replyArrives();
          return ok(`${first} replied, so the ${label} wait ended early`);
        }
        const hold = Math.round(Math.max(0, Math.min(1, input.waitScale)) * MAX_WAIT_HOLD_MS);
        return {
          ...ok(
            hold
              ? `Waited ${label} (shortened for the test)`
              : `Skipped a ${label} wait (test run)`,
          ),
          holdMs: hold,
        };
      }
      case 'logic.condition': {
        if (c.kind === 'replied') {
          if (reply) {
            replyArrives();
            return ok(`${first} replied: "${reply}"`, 'yes');
          }
          return ok('No reply from the lead', 'no');
        }
        if (c.kind === 'keyword') {
          const words = ((c.keywords as string[]) ?? []).map((w) => w.toLowerCase());
          const text = reply.toLowerCase();
          const hit = c.matchAll
            ? words.every((w) => text.includes(w))
            : words.some((w) => text.includes(w));
          return ok(
            hit
              ? `Reply matched ${words.filter((w) => text.includes(w)).join(', ')}`
              : 'No keyword matched',
            hit ? 'yes' : 'no',
          );
        }
        const rule = (c.rule ?? {}) as { field?: string; op?: CompareOp; value?: unknown };
        const pass = compare(get(ctx(), rule.field ?? ''), rule.op ?? 'eq', rule.value);
        return ok(
          `${rule.field ?? 'Field'} check: ${pass ? 'matched' : 'did not match'}`,
          pass ? 'yes' : 'no',
        );
      }
      case 'logic.switch': {
        const on = String(c.on ?? 'reply_keyword');
        const actual =
          on === 'reply_keyword'
            ? reply
            : on === 'source'
              ? input.lead.source
              : on === 'city'
                ? get(ctx(), 'lead.city')
                : on === 'valueInr'
                  ? Number(get(ctx(), 'lead.valueInr'))
                  : get(ctx(), String(c.field ?? ''));
        const cases =
          (c.cases as Array<{ key: string; label: string; op: CompareOp; value: unknown }>) ?? [];
        const hit = cases.find((k) => compare(actual, k.op, k.value));
        if (hit)
          return ok(
            `Matched ${hit.label || hit.key}${on === 'reply_keyword' ? ` in "${reply}"` : ''}`,
            hit.key,
          );
        return ok(
          on === 'reply_keyword' && !reply
            ? 'No reply text, took Default'
            : 'No case matched, took Default',
          'default',
        );
      }
      case 'logic.dedupe':
        return ok(`No matching lead in the last ${Number(c.withinDays ?? 90)} days`, 'unique');
      case 'logic.loop_limit': {
        const max = Number(c.max ?? 1);
        return visit > max
          ? ok(`Limit of ${max} passes reached`, 'exceeded')
          : ok(`Pass ${visit} of ${max}`, 'out');
      }
      case 'logic.stop':
        return { ...ok(`Run stopped${c.reason ? `: ${String(c.reason)}` : ''}`, null), stop: true };
      case 'ai.classify_intent': {
        const labels = (c.labels as string[]) ?? [];
        const text = reply.toLowerCase();
        const guess =
          labels.find((l) => l !== 'other' && text.includes(l.replace(/_/g, ' '))) ??
          (labels.includes('other') ? 'other' : labels[0]);
        return ok(`Intent: ${guess ?? 'unknown'}`, guess ?? null);
      }
      default:
        return ok(def.label);
    }
  };

  const finish = (status: WorkflowRunStatus) => runUpdated(status);

  const visitNode = (nodeId: string) => {
    const node = byId.get(nodeId);
    if (!node) return finish('completed');
    steps++;
    if (steps > MAX_STEPS) return finish('failed');
    const visit = (visits.get(nodeId) ?? 0) + 1;
    visits.set(nodeId, visit);
    const base: WorkflowRunStep = {
      id: uuid(),
      runId,
      nodeId,
      nodeType: node.type,
      status: 'running',
      attempt: 1,
      branch: null,
      summary: null,
      error: null,
      scheduledFor: null,
      startedAt: iso(),
      finishedAt: null,
    };
    stepEvent(base, null);

    later(RUN_STEP_MS, () => {
      const res = execute(node, visit);
      const complete = () => {
        const valid =
          res.branch === null ||
          outputsOf(node.type, node.data.config as Record<string, unknown>).includes(res.branch);
        const edge =
          res.status === 'failed' || res.stop || !valid ? null : edgeFor(node, res.branch);
        stepEvent(
          {
            ...base,
            status: res.status,
            branch: res.branch,
            summary: res.summary,
            error: res.error,
            finishedAt: iso(),
          },
          edge?.id ?? null,
        );
        if (res.status === 'failed') return finish('failed');
        if (!edge) return finish('completed');
        later(PACKET_MS, () => visitNode(edge.target));
      };
      if (res.holdMs) {
        stepEvent(
          {
            ...base,
            status: 'waiting',
            scheduledFor: new Date(Date.now() + res.holdMs).toISOString(),
          },
          null,
        );
        later(res.holdMs, complete);
      } else complete();
    });
  };

  const trigger = graph.nodes.find((n) => isTrigger(n.type));
  runUpdated('running');
  if (trigger) later(120, () => visitNode(trigger.id));
  else later(120, () => finish('failed'));

  return {
    runId,
    cancel: () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    },
  };
}
