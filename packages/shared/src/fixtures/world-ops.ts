import type { WorkflowRunStatus, WorkflowStatus } from '../enums.js';
import type { OutboundWebhookEvent } from '../webhooks.js';
import type { AuditLog } from '../schemas/notification.js';
import type { Integration, WebhookDelivery, WebhookEndpoint } from '../schemas/integration.js';
import type { LeadListItem } from '../schemas/lead.js';
import type { PlanDefinition, UsageSnapshot } from '../schemas/platform.js';
import type { WorkflowRun, WorkflowRunStep } from '../schemas/workflow.js';
import type { WorkflowNode } from '../workflow/graph.js';
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '../workflow/templates.js';
import { maskPhone } from '../format.js';
import { EMPLOYEE_FIXTURES, SUPER_ADMIN_FIXTURE } from './india.js';
import { int, MOCK_WORKSPACE_ID, pick, type Rng } from './mock.js';
import { worldCalls, worldInbox } from './world-crm.js';
import {
  between,
  DAY_MS,
  fixtureId,
  HOUR_MS,
  iso,
  istDayStart,
  istMonthStart,
  istPeriod,
  leadStory,
  memo,
  MINUTE_MS,
  MOCK_LEAD_COUNT,
  rngFor,
  worldUuid,
  type WorldContext,
} from './world-core.js';
import { MOCK_PLAN_DEFINITIONS } from './world-platform.js';

/**
 * Operations world: workflow runs with steps, the company audit log, integrations, webhooks and
 * billing for the main mock workspace.
 */

const isoT = iso;

// ---------------------------------------------------------------- workflows

/** Stable UUIDs for the four shipped workflows (the web routes by template key). */
export const WORKFLOW_FIXTURE_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  WORKFLOW_TEMPLATES.map((t, i) => [t.key, fixtureId('b0', i + 1)]),
);

export interface WorkflowFixtureState {
  status: WorkflowStatus;
  /** Last edit, hours before now. */
  editedHoursAgo: number;
  version: number;
}
export const WORKFLOW_FIXTURE_STATE: Readonly<Record<string, WorkflowFixtureState>> = {
  indiamart_nurturing: { status: 'active', editedHoursAgo: 3, version: 3 },
  missed_call_follow_up: { status: 'active', editedHoursAgo: 26, version: 2 },
  quote_reminder: { status: 'paused', editedHoursAgo: 72, version: 1 },
  inactive_lead_revival: { status: 'draft', editedHoursAgo: 150, version: 0 },
};

type Branch = (node: WorkflowNode, rng: Rng) => string;

interface WalkInput {
  tpl: WorkflowTemplate;
  lead: LeadListItem | null;
  start: number;
  /** Runs stop advancing at this time (now, or when the workflow was paused). */
  until: number;
  pausedReason?: string;
  branch: Branch;
  whatsapp: boolean;
  failAt?: { nodeId: string; error: string };
  ownerName: string | null;
  isTest?: boolean;
}

const unitMs = { minutes: MINUTE_MS, hours: HOUR_MS, days: DAY_MS } as const;

function stepSummary(
  node: WorkflowNode,
  lead: LeadListItem | null,
  branch: string | null,
  ownerName: string | null,
): string {
  const c = (node.data.config ?? {}) as Record<string, unknown>;
  const name = lead?.name ?? 'the lead';
  switch (node.type) {
    case 'trigger.indiamart_lead':
      return `New IndiaMART enquiry from ${name}`;
    case 'trigger.call_missed':
      return `Missed call from ${name}`;
    case 'trigger.stage_changed':
      return `${name} moved to Quote sent`;
    case 'trigger.schedule':
      return 'Weekly schedule fired';
    case 'logic.dedupe':
      return branch === 'duplicate'
        ? 'Duplicate of an enquiry from last week (same phone)'
        : 'No duplicate found by phone';
    case 'action.upsert_contact':
      return 'Contact and deal created';
    case 'action.assign_owner':
      return ownerName
        ? `Assigned to ${ownerName} (round robin)`
        : 'Nobody available, left unassigned';
    case 'action.send_whatsapp_template':
      return `Sent template ${String(c.templateName ?? '')}`;
    case 'logic.wait':
      return `Wait ${String(c.amount ?? '')} ${String(c.unit ?? '')} (business hours)`;
    case 'logic.condition':
      if (c.kind === 'replied') return branch === 'yes' ? 'Lead replied' : 'No reply yet';
      return branch === 'yes' ? 'Still in Quote sent' : 'Lead moved on';
    case 'logic.switch':
      return `Reply intent: ${branch === 'not_interested' ? 'not interested' : branch === 'default' ? 'other' : (branch ?? 'other')}`;
    case 'action.create_task':
    case 'action.create_call_task':
      return `Created task: ${String(c.title ?? 'Follow up').replace('{{lead.name}}', name)}`;
    case 'action.change_stage':
      return `Moved to ${String(c.stageKey ?? '') === 'lost' ? 'Lost' : String(c.stageKey ?? '')}`;
    case 'action.update_field':
      return `Set ${String(c.field ?? 'field')} to ${String(c.value ?? '')}`;
    case 'action.add_tag':
      return `Tagged ${(c.tags as string[] | undefined)?.join(', ') ?? ''}`;
    case 'logic.stop':
      return c.reason ? `Stopped: ${String(c.reason)}` : 'Finished';
    default:
      return node.data.label ?? node.type;
  }
}

/**
 * Walk a template graph for one run, following the chosen branches and timing waits. The same key
 * and input always give the same run; `withSteps` only adds the step rows (ids from a separate
 * stream), so lists stay cheap and detail views rebuild the steps on demand.
 */
function walk(key: string, input: WalkInput, withSteps: boolean): WorkflowRun {
  const rng = rngFor(key);
  const ids = rngFor(`${key}:steps`);
  const { tpl, lead } = input;
  const runId = worldUuid(rng);
  const steps: WorkflowRunStep[] = [];
  let status: WorkflowRunStatus = 'completed';
  let error: string | null = null;
  let current: string[] = [];
  let t = input.start;
  let node: WorkflowNode | undefined = tpl.graph.nodes.find((n) => n.type.startsWith('trigger.'));
  let finishedAt: number | null = null;
  let guard = 0;
  const push = (
    n: WorkflowNode,
    s: WorkflowRunStep['status'],
    branch: string | null,
    took: number,
    extra: Partial<WorkflowRunStep> = {},
  ) => {
    if (!withSteps) return;
    const skipped = s === 'skipped' && n.type === 'action.send_whatsapp_template' && lead?.phone;
    steps.push({
      id: worldUuid(ids),
      runId,
      nodeId: n.id,
      nodeType: n.type,
      status: s,
      attempt: 1,
      branch,
      summary: skipped
        ? `Skipped: ${maskPhone(lead!.phone!)} is not on WhatsApp`
        : stepSummary(n, lead, branch, input.ownerName),
      error: null,
      scheduledFor: n.type === 'logic.wait' ? isoT(t + took) : null,
      startedAt: isoT(t),
      finishedAt: s === 'waiting' || (s === 'skipped' && !skipped) ? null : isoT(t + took),
      ...extra,
    });
  };
  while (node && guard++ < 40) {
    const isWait = node.type === 'logic.wait';
    const c = (node.data.config ?? {}) as { amount?: number; unit?: keyof typeof unitMs };
    const took = isWait ? (c.amount ?? 1) * unitMs[c.unit ?? 'hours'] : int(rng, 300, 4000);
    const branching =
      node.type === 'logic.dedupe' ||
      node.type === 'logic.condition' ||
      node.type === 'logic.switch';
    const branch = branching ? input.branch(node, rng) : null;
    const notOnWhatsapp = node.type === 'action.send_whatsapp_template' && !input.whatsapp;
    if (t + took > input.until) {
      if (input.pausedReason) {
        push(node, 'skipped', branch, took, { finishedAt: null });
        status = 'cancelled';
        error = input.pausedReason;
        finishedAt = input.until;
      } else {
        push(node, 'waiting', branch, took);
        status = 'waiting';
        current = [node.id];
      }
      break;
    }
    if (input.failAt?.nodeId === node.id) {
      const attempt = int(rng, 1, 3);
      push(node, 'failed', branch, took, {
        error: input.failAt.error,
        attempt,
        summary: `Failed: ${input.failAt.error}`,
      });
      status = 'failed';
      error = input.failAt.error;
      finishedAt = t + took;
      break;
    }
    push(node, notOnWhatsapp ? 'skipped' : 'succeeded', branch, took);
    t += took;
    const handle = branch ?? 'out';
    const from: string = node.id;
    const edge =
      tpl.graph.edges.find((e) => e.source === from && e.sourceHandle === handle) ??
      tpl.graph.edges.find((e) => e.source === from && e.sourceHandle === 'default');
    node = edge ? tpl.graph.nodes.find((n) => n.id === edge.target) : undefined;
    if (!node) finishedAt = t;
  }
  return {
    id: runId,
    workflowId: WORKFLOW_FIXTURE_IDS[tpl.key]!,
    version: Math.max(1, WORKFLOW_FIXTURE_STATE[tpl.key]?.version ?? 1),
    leadId: lead?.id ?? null,
    leadName: lead?.name ?? null,
    status,
    isTest: input.isTest ?? false,
    currentNodeIds: current,
    error,
    startedAt: isoT(input.start),
    finishedAt: finishedAt === null ? null : isoT(finishedAt),
    ...(withSteps ? { steps } : {}),
  };
}

const tplOf = (key: string) => WORKFLOW_TEMPLATES.find((t) => t.key === key)!;

interface RunRecipe {
  key: string;
  input: WalkInput;
}

function runRecipes(ctx: WorldContext): RunRecipe[] {
  return memo(ctx, 'runRecipes', () => {
    const { now } = ctx;
    const recipes: RunRecipe[] = [];
    const nurturing = tplOf('indiamart_nurturing');
    const intentHandle = {
      price: 'price',
      catalog: 'catalog',
      not_interested: 'not_interested',
      other: 'default',
    } as const;
    for (const lead of ctx.leads) {
      if (lead.source !== 'indiamart') continue;
      const story = leadStory(ctx, lead);
      recipes.push({
        key: `run:nurturing:${lead.id}`,
        input: {
          tpl: nurturing,
          lead,
          start: story.createdAt + 2000,
          until: now,
          whatsapp: story.whatsapp,
          ownerName: lead.owner?.name ?? null,
          branch: (n) =>
            n.type === 'logic.dedupe'
              ? story.duplicate
                ? 'duplicate'
                : 'unique'
              : n.type === 'logic.condition'
                ? story.replied
                  ? 'yes'
                  : 'no'
                : story.intent
                  ? intentHandle[story.intent]
                  : 'default',
          failAt: story.welcomeFailed
            ? {
                nodeId: 'welcome',
                error: 'Template indiamart_welcome was rejected: the number has not opted in',
              }
            : undefined,
        },
      });
    }
    const missed = tplOf('missed_call_follow_up');
    for (const call of worldCalls(ctx)) {
      if (call.direction !== 'inbound' || call.status !== 'missed' || !call.leadId) continue;
      const lead = ctx.leadById.get(call.leadId);
      if (!lead) continue;
      const story = leadStory(ctx, lead);
      const key = `run:missed:${call.id}`;
      recipes.push({
        key,
        input: {
          tpl: missed,
          lead,
          start: Date.parse(call.endedAt ?? call.startedAt) + 3000,
          until: now,
          whatsapp: story.whatsapp,
          ownerName: lead.owner?.name ?? null,
          branch: (_n, r) => (r() < 0.4 ? 'yes' : 'no'),
          failAt:
            story.whatsapp && rngFor(`${key}:fail`)() < 0.03
              ? { nodeId: 'sorry', error: 'WhatsApp rate limit reached, retries used up' }
              : undefined,
        },
      });
    }
    const quote = tplOf('quote_reminder');
    const pausedAt = now - (WORKFLOW_FIXTURE_STATE.quote_reminder?.editedHoursAgo ?? 72) * HOUR_MS;
    for (const lead of ctx.leads) {
      const story = leadStory(ctx, lead);
      const i = story.stagePath.findIndex(
        (s) => ctx.stageById.get(s.stageId)?.key === 'quote_sent',
      );
      if (i < 0) continue;
      const enteredAt = story.stagePath[i]!.at;
      if (enteredAt > pausedAt) continue;
      const leftAt = story.stagePath[i + 1]?.at ?? Number.POSITIVE_INFINITY;
      const key = `run:quote:${lead.id}`;
      const metaPaused = enteredAt > pausedAt - 6 * DAY_MS && rngFor(`${key}:fail`)() < 0.2;
      let checks = 0;
      recipes.push({
        key,
        input: {
          tpl: quote,
          lead,
          start: enteredAt + 1000,
          until: pausedAt,
          pausedReason: 'Workflow paused by Anil Kapoor',
          whatsapp: story.whatsapp,
          ownerName: lead.owner?.name ?? null,
          // First check after 2 days, second after 5 (the counter resets for each walk).
          branch: (n) => {
            if (n.id === 'still_quote') checks = 0;
            checks++;
            return enteredAt + (checks === 1 ? 2 : 5) * DAY_MS < leftAt ? 'yes' : 'no';
          },
          failAt: metaPaused
            ? {
                nodeId: 'reminder',
                error: 'Template quote_reminder is paused by Meta (low quality rating)',
              }
            : undefined,
        },
      });
    }
    // Test runs from the builder.
    const testRng = rngFor('run:tests');
    for (let i = 0; i < 4; i++) {
      const lead = pick(testRng, ctx.leads);
      recipes.push({
        key: `run:test:${i}`,
        input: {
          tpl: nurturing,
          lead,
          start: now - int(testRng, 2, 90) * HOUR_MS,
          until: now + 30 * DAY_MS,
          whatsapp: true,
          ownerName: lead.owner?.name ?? null,
          branch: (n) =>
            n.type === 'logic.dedupe' ? 'unique' : n.type === 'logic.condition' ? 'yes' : 'price',
          isTest: true,
        },
      });
    }
    return recipes;
  });
}

/**
 * Workflow runs of the last 30 days, newest first, WITHOUT steps (like the list API): IndiaMART
 * nurturing for every IndiaMART lead, missed-call follow-ups for missed inbound calls, quote
 * reminders until the workflow was paused (some failed because Meta paused the template), and a
 * few test runs. Statuses: completed, failed, waiting, cancelled. Steps: worldWorkflowRun().
 */
export function worldWorkflowRuns(ctx: WorldContext): WorkflowRun[] {
  return memo(ctx, 'runs', () => {
    const recipeById = memo(ctx, 'runRecipeById', () => new Map<string, RunRecipe>());
    const runs = runRecipes(ctx).map((r) => {
      const run = walk(r.key, r.input, false);
      recipeById.set(run.id, r);
      return run;
    });
    return runs.sort((a, b) =>
      a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0,
    );
  });
}

/** One run with its steps (detail view, lead timeline). */
export function worldWorkflowRun(ctx: WorldContext, runId: string): WorkflowRun | null {
  worldWorkflowRuns(ctx);
  const recipe = memo(ctx, 'runRecipeById', () => new Map<string, RunRecipe>()).get(runId);
  return recipe ? walk(recipe.key, recipe.input, true) : null;
}

export interface WorkflowRunStats {
  runs: number;
  completed: number;
  failed: number;
  active: number;
  lastRunAt: string | null;
}

/** Run counts per workflow id (test runs excluded). */
export function worldWorkflowStats(ctx: WorldContext): Map<string, WorkflowRunStats> {
  return memo(ctx, 'runStats', () => {
    const m = new Map<string, WorkflowRunStats>();
    for (const id of Object.values(WORKFLOW_FIXTURE_IDS))
      m.set(id, { runs: 0, completed: 0, failed: 0, active: 0, lastRunAt: null });
    for (const r of worldWorkflowRuns(ctx)) {
      if (r.isTest) continue;
      const s = m.get(r.workflowId)!;
      s.runs++;
      if (r.status === 'completed') s.completed++;
      else if (r.status === 'failed') s.failed++;
      else if (r.status === 'waiting' || r.status === 'running' || r.status === 'queued')
        s.active++;
      if (!s.lastRunAt || r.startedAt > s.lastRunAt) s.lastRunAt = r.startedAt;
    }
    return m;
  });
}

// ---------------------------------------------------------------- audit log

const IPS = ['49.36.112.18', '49.36.97.204', '103.87.143.9', '117.222.10.61', '157.38.220.4'];

/**
 * Company audit log (newest first, 45 days): role changes, invites, exports and imports, bulk
 * deletes, settings changes, API keys, webhooks, integrations, support access, Super Admin
 * impersonation and plan changes. Diffs are PII-masked like the API's AuditService.
 */
export function worldAuditLog(ctx: WorldContext): AuditLog[] {
  return memo(ctx, 'audit', () => {
    const { now } = ctx;
    const rng = rngFor('audit');
    const byKey = (key: string) => {
      const i = EMPLOYEE_FIXTURES.findIndex((e) => e.key === key);
      return { id: ctx.users[i]!.id, name: ctx.users[i]!.name };
    };
    const admin = byKey('admin');
    const priya = byKey('manager');
    const out: AuditLog[] = [];
    const day = (d: number, h = between(rng, 10, 18.5)) =>
      istDayStart(now) - d * DAY_MS + Math.round(h * 60) * MINUTE_MS;
    const add = (
      t: number,
      e: Omit<AuditLog, 'id' | 'createdAt' | 'ip' | 'actorType' | 'actorId' | 'actorName'> & {
        actor?: { id: string; name: string } | 'system' | 'super_admin' | 'api_key' | 'workflow';
        ip?: string | null;
      },
    ) => {
      if (t > now) return;
      const a = e.actor ?? admin;
      const actorType = typeof a === 'string' ? a : 'user';
      out.push({
        id: worldUuid(rng),
        actorType,
        actorId:
          typeof a === 'string'
            ? a === 'super_admin'
              ? '0190f5a0-0000-7000-8000-600000000001'
              : a === 'api_key'
                ? fixtureId('c1', 1)
                : null
            : a.id,
        actorName:
          typeof a === 'string'
            ? a === 'super_admin'
              ? SUPER_ADMIN_FIXTURE.name
              : a === 'api_key'
                ? 'API key: Tally sync'
                : a === 'workflow'
                  ? 'Workflow'
                  : 'System'
            : a.name,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        diff: e.diff,
        ip:
          e.ip !== undefined
            ? e.ip
            : typeof a === 'string' && a !== 'super_admin'
              ? null
              : pick(rng, IPS),
        createdAt: isoT(t),
      });
    };
    const user = (key: string) => byKey(key);
    const role = (from: string, to: string) => ({ role: { from, to } });
    add(day(0, 9.6), {
      action: 'leads.export',
      entityType: 'lead',
      entityId: null,
      diff: { rows: 1240, format: 'csv', filters: { stage: ['quote_sent', 'interested'] } },
    });
    add(day(0, 11.2), {
      actor: priya,
      action: 'leads.bulk_assign',
      entityType: 'lead',
      entityId: null,
      diff: { count: 18, ownerId: user('rep4').id },
    });
    add(day(1), {
      action: 'user.role_change',
      entityType: 'user',
      entityId: user('rep2').id,
      diff: role('Employee', 'Senior sales executive'),
    });
    add(day(1), {
      actor: 'super_admin',
      action: 'impersonation.start',
      entityType: 'workspace',
      entityId: MOCK_WORKSPACE_ID,
      diff: {
        reason: 'Customer asked for help configuring lead routing',
        readOnly: true,
        durationMin: 30,
      },
      ip: '13.232.10.4',
    });
    add(day(1) + 25 * MINUTE_MS, {
      actor: 'super_admin',
      action: 'impersonation.end',
      entityType: 'workspace',
      entityId: MOCK_WORKSPACE_ID,
      diff: { endedBy: 'admin' },
      ip: '13.232.10.4',
    });
    add(day(1, 9.8), {
      action: 'support_access.enable',
      entityType: 'workspace',
      entityId: MOCK_WORKSPACE_ID,
      diff: { until: isoT(day(2, 9.8)), includeContent: false },
    });
    add(day(3, 19), {
      action: 'workflow.pause',
      entityType: 'workflow',
      entityId: WORKFLOW_FIXTURE_IDS.quote_reminder!,
      diff: {
        status: { from: 'active', to: 'paused' },
        reason: 'Template quote_reminder paused by Meta',
      },
    });
    add(day(2), {
      action: 'apikey.create',
      entityType: 'api_key',
      entityId: fixtureId('c1', 1),
      diff: { name: 'Tally sync', scopes: ['leads:read', 'leads:write'], prefix: 'vst_live_9f2a' },
    });
    add(day(2), {
      actor: 'api_key',
      action: 'leads.import',
      entityType: 'lead',
      entityId: null,
      diff: { rows: 312, created: 296, skipped: 14, errors: 2 },
    });
    add(day(4), {
      action: 'settings.business_hours.update',
      entityType: 'workspace',
      entityId: MOCK_WORKSPACE_ID,
      diff: { holidays: { added: [{ date: '2026-11-08', name: 'Diwali' }] } },
    });
    add(day(5), {
      action: 'workspace.update',
      entityType: 'workspace',
      entityId: MOCK_WORKSPACE_ID,
      diff: {
        defaultLeadsViewMode: { from: null, to: 'board' },
        defaultTheme: { from: 'light', to: 'system' },
      },
    });
    add(day(6), {
      action: 'user.invite',
      entityType: 'user',
      entityId: null,
      diff: { email: 'n***@shakti.example', role: 'Employee' },
    });
    add(day(6), {
      actor: priya,
      action: 'leads.bulk_delete',
      entityType: 'lead',
      entityId: null,
      diff: { count: 12, reason: 'Duplicate IndiaMART enquiries' },
    });
    add(day(7), {
      action: 'integration.connect',
      entityType: 'integration',
      entityId: fixtureId('d1', 2),
      diff: { provider: 'whatsapp_cloud', phoneNumber: '+91XXXXXX0000' },
    });
    add(day(8), {
      action: 'webhook.create',
      entityType: 'webhook_endpoint',
      entityId: fixtureId('e1', 3),
      diff: { name: 'Tally ERP sync', events: ['lead.updated', 'stage.changed'] },
    });
    add(day(9), {
      actor: 'super_admin',
      action: 'plan.change',
      entityType: 'workspace',
      entityId: MOCK_WORKSPACE_ID,
      diff: {
        plan: { from: 'starter', to: 'growth' },
        reason: 'Upgrade requested by the customer',
      },
      ip: '13.232.10.4',
    });
    add(day(10), {
      action: 'pipeline.stage.update',
      entityType: 'stage',
      entityId: ctx.stages[3]!.id,
      diff: { probability: { from: 50, to: 60 } },
    });
    add(day(11), {
      action: 'field.create',
      entityType: 'field',
      entityId: null,
      diff: { target: 'lead', key: 'delivery_by', type: 'date' },
    });
    add(day(12), {
      action: 'user.role_change',
      entityType: 'user',
      entityId: user('manager2').id,
      diff: role('Employee', 'Manager'),
    });
    add(day(13), {
      action: 'apikey.revoke',
      entityType: 'api_key',
      entityId: fixtureId('c1', 2),
      diff: { name: 'Old Zapier key', prefix: 'vst_live_41bd' },
    });
    add(day(14), {
      action: 'integration.connect',
      entityType: 'integration',
      entityId: fixtureId('d1', 1),
      diff: { provider: 'indiamart', pullIntervalMin: 5 },
    });
    add(day(16), {
      action: 'user.deactivate',
      entityType: 'user',
      entityId: null,
      diff: { email: 'v***@shakti.example', reason: 'Left the company' },
    });
    add(day(18), {
      action: 'pack.install',
      entityType: 'pack',
      entityId: null,
      diff: { key: 'generic-sales', version: '1.0.0' },
    });
    add(day(21), {
      action: 'workflow.publish',
      entityType: 'workflow',
      entityId: WORKFLOW_FIXTURE_IDS.indiamart_nurturing!,
      diff: { version: 3, note: 'Shorter wait before the first follow-up' },
    });
    add(day(24), {
      action: 'roles.update',
      entityType: 'role',
      entityId: null,
      diff: { role: 'Manager', added: ['workflows.run'] },
    });
    // Routine entries spread over the period.
    const routine: Array<[string, string, (d: number) => Record<string, unknown>]> = [
      [
        'leads.export',
        'lead',
        () => ({ rows: int(rng, 80, 900), format: pick(rng, ['csv', 'xlsx']) }),
      ],
      [
        'user.role_change',
        'user',
        () => role('Employee', pick(rng, ['Telecaller', 'Senior sales executive'])),
      ],
      [
        'settings.update',
        'workspace',
        () => ({ key: pick(rng, ['leads.routing', 'performance.showRank', 'ui.labels']) }),
      ],
      ['lead.delete', 'lead', () => ({ count: 1 })],
      ['leads.import', 'lead', () => ({ rows: int(rng, 40, 400), created: int(rng, 30, 380) })],
    ];
    for (let d = 0; d < 45; d++) {
      if (rng() < 0.45) continue;
      const [action, entityType, diff] = pick(rng, routine);
      add(day(d), {
        actor: rng() < 0.7 ? admin : priya,
        action,
        entityType,
        entityId: null,
        diff: diff(d),
      });
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  });
}

// ---------------------------------------------------------------- integrations and webhooks

export function worldIntegrations(ctx: WorldContext): Integration[] {
  const { now } = ctx;
  const base = (i: Partial<Integration> & Pick<Integration, 'id' | 'provider' | 'status' | 'displayName'>): Integration => ({
    mode: 'mock',
    config: {},
    hasSecrets: false,
    secretHints: {},
    lastCheckedAt: null,
    lastError: null,
    lastSyncAt: null,
    nextSyncAt: null,
    attention: null,
    connectedAt: null,
    connectedBy: null,
    endpoints: null,
    stats: {},
    availability: 'ready',
    availabilityNote: null,
    enabled: true,
    updatedAt: null,
    ...i,
  });
  return [
    base({
      id: fixtureId('d1', 1),
      provider: 'indiamart',
      status: 'connected',
      displayName: 'IndiaMART Lead Manager',
      config: { pullEnabled: true, pullIntervalMin: 15, pushEnabled: true, tags: ['indiamart'] },
      hasSecrets: true,
      secretHints: { crmKey: '••••x7Qa' },
      lastCheckedAt: isoT(now - 4 * MINUTE_MS),
      lastSyncAt: isoT(now - 4 * MINUTE_MS),
      nextSyncAt: isoT(now + 11 * MINUTE_MS),
      connectedAt: isoT(now - 14 * DAY_MS),
      endpoints: { pushUrl: `${HOOK_BASE}/indiamart?key=im_push_mock`, webhookUrl: null, verifyToken: null, callbackUrl: null, oauthRedirectUri: null },
      stats: { leadsImported30d: 74, lastPulledCount: 2 },
      updatedAt: isoT(now - 4 * MINUTE_MS),
    }),
    base({
      id: fixtureId('d1', 2),
      provider: 'whatsapp_cloud',
      status: 'connected',
      displayName: 'WhatsApp Business: Shakti Industries',
      config: { phoneNumberId: '109876543210987', wabaId: '1029384756', displayPhoneNumber: '+91 98100 00000' },
      hasSecrets: true,
      secretHints: { accessToken: '••••Zx9k', appSecret: '••••41ab' },
      lastCheckedAt: isoT(now - 9 * MINUTE_MS),
      lastSyncAt: isoT(now - 9 * MINUTE_MS),
      connectedAt: isoT(now - 7 * DAY_MS),
      endpoints: { pushUrl: null, webhookUrl: `${HOOK_BASE}/whatsapp`, verifyToken: 'wa_verify_mock', callbackUrl: null, oauthRedirectUri: null },
      stats: { qualityRating: 'GREEN', messagingLimit: 'TIER_10K', messagesReceived30d: 312 },
      updatedAt: isoT(now - 9 * MINUTE_MS),
    }),
    base({
      id: fixtureId('d1', 3),
      provider: 'telephony',
      status: 'connected',
      displayName: 'Telephony (mock adapter)',
      config: { provider: 'mock', recordCalls: true },
      lastCheckedAt: isoT(now - 2 * MINUTE_MS),
      connectedAt: isoT(now - 30 * DAY_MS),
      endpoints: { pushUrl: null, webhookUrl: null, verifyToken: null, callbackUrl: `${HOOK_BASE}/telephony/mock?token=tel_mock`, oauthRedirectUri: null },
      updatedAt: isoT(now - 2 * MINUTE_MS),
    }),
    base({
      id: fixtureId('d1', 4),
      provider: 'smtp',
      status: 'error',
      mode: 'live',
      displayName: 'Email (SMTP)',
      config: { host: 'smtp.zoho.in', port: 587, secure: false, username: 'sales@shakti.example', fromEmail: 'sales@shakti.example' },
      hasSecrets: true,
      secretHints: { password: '••••w0rd' },
      lastCheckedAt: isoT(now - 3 * HOUR_MS),
      lastError: 'Authentication failed. Check the SMTP password, then test again.',
      connectedAt: isoT(now - 20 * DAY_MS),
      updatedAt: isoT(now - 3 * HOUR_MS),
    }),
    base({
      id: null,
      provider: 'google_calendar',
      status: 'not_connected',
      mode: 'live',
      displayName: 'Google Calendar',
      availability: 'not_configured',
      availabilityNote: 'Google sign-in is not set up on this Vistar server (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).',
    }),
  ];
}

const HOOK_BASE = `https://api.vistar.example/api/hooks/${MOCK_WORKSPACE_ID}`;
type OutboundEvent = OutboundWebhookEvent;

export function worldWebhookEndpoints(ctx: WorldContext): WebhookEndpoint[] {
  const { now } = ctx;
  const common = (n: number, days: number) => ({
    id: fixtureId('e1', n),
    secretRotatedAt: null,
    previousSecretExpiresAt: null,
    disabledAt: null,
    disabledReason: null,
    consecutiveFailures: 0,
    deadStreak: 0,
    lastDeliveryAt: isoT(now - (n * 7 + 3) * MINUTE_MS),
    lastSuccessAt: isoT(now - (n * 7 + 3) * MINUTE_MS),
    lastFailureAt: null,
    stats: { deliveries24h: 10 + n * 3, failures24h: n === 3 ? 2 : 0 },
    createdAt: isoT(now - days * DAY_MS),
    updatedAt: isoT(now - days * DAY_MS),
  });
  const inbound = (
    n: number,
    name: string,
    sourceKey: string,
    action: WebhookEndpoint['action'],
    days: number,
  ): WebhookEndpoint => ({
    ...common(n, days),
    direction: 'inbound',
    name,
    isActive: true,
    sourceKey,
    inboundUrl: `${HOOK_BASE}/${sourceKey}`,
    action,
    workflowId: action === 'start_workflow' ? WORKFLOW_FIXTURE_IDS.indiamart_nurturing! : null,
    mapping: {
      fields: [
        { from: 'name', to: 'name', transform: 'trim' },
        { from: 'mobile', to: 'phone', transform: 'phone_in' },
        { from: 'email', to: 'email', transform: 'lower' },
        { from: 'city', to: 'city', transform: 'none' },
        { from: 'message', to: 'requirement', transform: 'none' },
      ],
      defaults: { source: 'webhook' },
    },
    verification: 'hmac',
    matchBy: ['phone', 'email'],
    createIfMissing: true,
    samplePayload: { name: 'Ramesh Patil', mobile: '98220 12345', email: 'ramesh@patil.example', city: 'Pune', message: 'Need 200 kg of MS angles' },
    sampleCapturedAt: isoT(now - (days - 1) * DAY_MS),
    captureUntil: null,
    url: null,
    events: [],
    secretPreview: `…${sourceKey.slice(0, 2)}9f`,
  });
  const outbound = (
    n: number,
    name: string,
    url: string,
    events: OutboundEvent[],
    days: number,
    active = true,
  ): WebhookEndpoint => ({
    ...common(n, days),
    direction: 'outbound',
    name,
    isActive: active,
    sourceKey: null,
    inboundUrl: null,
    action: null,
    workflowId: null,
    mapping: null,
    verification: null,
    matchBy: [],
    createIfMissing: false,
    samplePayload: null,
    sampleCapturedAt: null,
    captureUntil: null,
    url,
    events,
    secretPreview: `…a${n}c4`,
    ...(active ? {} : { disabledAt: isoT(now - 5 * DAY_MS), disabledReason: '3 deliveries in a row were dead-lettered', deadStreak: 3, consecutiveFailures: 21, lastFailureAt: isoT(now - 5 * DAY_MS) }),
  });
  return [
    inbound(1, 'Website contact form', 'website-form', 'create_lead', 25),
    inbound(2, 'JustDial enquiries', 'justdial', 'start_workflow', 12),
    outbound(
      3,
      'Tally ERP sync',
      'https://erp.shakti.example/vistar/events',
      ['lead.updated', 'stage.changed'],
      8,
    ),
    outbound(
      4,
      'Google Sheets via Zapier',
      'https://hooks.zapier.example/hooks/catch/1840/abc',
      ['lead.created', 'lead.assigned'],
      19,
    ),
    outbound(5, 'Old CRM bridge', 'https://bridge.shakti.example/hook', ['call.ended'], 40, false),
  ];
}

/** Webhook deliveries of the last 7 days (newest first): mostly 200s, some retries, two dead letters. */
export function worldWebhookDeliveries(ctx: WorldContext): WebhookDelivery[] {
  return memo(ctx, 'deliveries', () => {
    const { now } = ctx;
    const rng = rngFor('webhook-deliveries');
    const endpoints = worldWebhookEndpoints(ctx).filter((e) => e.isActive);
    const out: WebhookDelivery[] = [];
    for (let i = 0; i < 180; i++) {
      const ep = pick(rng, endpoints);
      const at = now - Math.round(between(rng, 1, 7 * 1440)) * MINUTE_MS;
      const lead = pick(rng, ctx.leads);
      const fail = rng() < 0.07;
      const dead = fail && rng() < 0.15;
      const event = ep.direction === 'outbound' ? pick(rng, ep.events) : null;
      const status = dead ? 'dead' : fail ? 'failed' : 'success';
      const attempt = fail ? int(rng, 2, 6) : 1;
      const responseStatus = fail ? pick(rng, [500, 502, 503, 504]) : ep.direction === 'inbound' ? 202 : 200;
      const error = fail ? pick(rng, ['Upstream returned 502', 'Timed out after 10 s', 'Connection reset']) : null;
      const latencyMs = fail ? int(rng, 5000, 10000) : int(rng, 80, 900);
      const attempts = Array.from({ length: attempt }, (_, k) => {
        const last = k === attempt - 1;
        const ok = last && !fail;
        return {
          attempt: k + 1,
          at: isoT(at + [0, 60, 360, 2160, 9360, 30960][k]! * 1000),
          ok,
          responseStatus: ok ? responseStatus : pick(rng, [500, 502, 503, 504]),
          latencyMs: ok ? latencyMs : int(rng, 3000, 10000),
          error: ok ? null : (error ?? 'Upstream returned 502'),
        };
      });
      out.push({
        id: worldUuid(rng),
        endpointId: ep.id,
        endpointName: ep.name,
        direction: ep.direction,
        event,
        status,
        attempt,
        maxAttempts: ep.direction === 'outbound' ? 7 : 1,
        attempts,
        requestHeaders: {
          'content-type': 'application/json',
          'x-vistar-signature': 't=…,v1=[redacted]',
          'x-vistar-event': event ?? 'inbound',
        },
        requestBody:
          ep.direction === 'outbound'
            ? { type: event, leadId: lead.id, stage: lead.stageId }
            : {
                name: lead.name,
                mobile: lead.phone ? maskPhone(lead.phone) : null,
                city: lead.city,
              },
        responseStatus,
        responseBody: fail ? 'Bad gateway' : ep.direction === 'inbound' ? JSON.stringify({ ok: true, duplicate: false, leadId: lead.id, runId: null }) : '{"ok":true}',
        latencyMs,
        error,
        idempotencyKey: worldUuid(rng),
        replayOfId: null,
        nextAttemptAt: status === 'failed' ? isoT(at + int(rng, 5, 120) * MINUTE_MS) : null,
        signatureValid: ep.direction === 'inbound' ? true : null,
        result: ep.direction === 'inbound' ? { action: ep.action, leadId: fail ? null : lead.id, runId: null, duplicate: false, captured: false } : null,
        canReplay: true,
        createdAt: isoT(at),
        updatedAt: isoT(at + (attempt > 1 ? 60_000 : 500)),
      });
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  });
}

// ---------------------------------------------------------------- billing

export interface MockInvoice {
  id: string;
  number: string;
  period: string;
  plan: string;
  amountInr: number;
  gstInr: number;
  totalInr: number;
  status: 'paid' | 'due' | 'overdue';
  method: 'razorpay' | 'manual';
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
}

export interface WorldBilling {
  plan: PlanDefinition;
  usage: UsageSnapshot;
  invoices: MockInvoice[];
}

/** Plan, this month's metered usage and the last six invoices of the main workspace. */
export function worldBilling(ctx: WorldContext): WorldBilling {
  return memo(ctx, 'billing', () => {
    const { now } = ctx;
    const plan = MOCK_PLAN_DEFINITIONS.find((p) => p.key === 'growth')!;
    const monthStart = istMonthStart(now);
    let whatsapp = 0;
    for (const msgs of worldInbox(ctx).messagesByConversation.values())
      for (const m of msgs)
        if (Date.parse(m.createdAt) >= monthStart && !m.isInternalNote) whatsapp++;
    const usage: UsageSnapshot = {
      period: istPeriod(now),
      seats: EMPLOYEE_FIXTURES.length,
      leads: MOCK_LEAD_COUNT,
      whatsappMessages: whatsapp,
      workflowRuns: worldRunsThisMonth(ctx),
      storageMb: 1840,
    };
    const rng = rngFor('invoices');
    const invoices: MockInvoice[] = Array.from({ length: 6 }, (_, i) => {
      const issued = istMonthStart(now, -i) + 9 * HOUR_MS;
      const amount = i >= 4 ? 2999 : plan.priceInrMonthly;
      const gst = Math.round(amount * 0.18);
      const status: MockInvoice['status'] =
        i === 0 ? (now - issued > 7 * DAY_MS ? 'overdue' : 'due') : 'paid';
      return {
        id: worldUuid(rng),
        number: `VST-${istPeriod(issued).replace('-', '')}-${String(1042 + 6 - i).padStart(4, '0')}`,
        period: istPeriod(issued + DAY_MS),
        plan: i >= 4 ? 'Starter' : plan.name,
        amountInr: amount,
        gstInr: gst,
        totalInr: amount + gst,
        status,
        method: i === 3 ? 'manual' : 'razorpay',
        issuedAt: isoT(issued),
        dueAt: isoT(issued + 7 * DAY_MS),
        paidAt: status === 'paid' ? isoT(issued + int(rng, 0, 5) * DAY_MS + 3 * HOUR_MS) : null,
      };
    });
    return { plan, usage, invoices };
  });
}

/** Workflow runs started this month (billing usage). */
export function worldRunsThisMonth(ctx: WorldContext): number {
  const from = istMonthStart(ctx.now);
  return worldWorkflowRuns(ctx).filter((r) => !r.isTest && Date.parse(r.startedAt) >= from).length;
}
