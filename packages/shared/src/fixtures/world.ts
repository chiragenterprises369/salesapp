import type { Activity } from '../schemas/activity.js';
import type { Call } from '../schemas/call.js';
import type { LeadListItem } from '../schemas/lead.js';
import type { Notification } from '../schemas/notification.js';
import type { Task } from '../schemas/task.js';
import type { WorkflowRun } from '../schemas/workflow.js';
import { WORKFLOW_TEMPLATES } from '../workflow/templates.js';
import { createWorldContext, memo, type WorldContext } from './world-core.js';
import {
  worldCalls,
  worldInbox,
  worldLeadTimeline,
  worldNotifications,
  worldSavedViews,
  worldTargets,
  worldTasks,
} from './world-crm.js';
import {
  WORKFLOW_FIXTURE_IDS,
  worldAuditLog,
  worldBilling,
  worldIntegrations,
  worldWebhookDeliveries,
  worldWebhookEndpoints,
  worldWorkflowRun,
  worldWorkflowRuns,
  worldWorkflowStats,
} from './world-ops.js';
import { worldPlatform } from './world-platform.js';

/**
 * "World" fixtures: one deterministic, linked dataset for the whole mock platform (SPEC 20.4):
 * 2,500 leads, tasks, calls, WhatsApp chats, timelines, notifications, targets, workflow runs,
 * audit log, integrations, webhooks, billing and the Super Admin platform view.
 *
 * Usage: `const ctx = createWorldContext({ now })`, then call the section generators with it. Each
 * section is computed once per context (memoised), so screens only pay for what they read.
 */
export * from './world-core.js';
export * from './world-crm.js';
export * from './world-ops.js';
export * from './world-platform.js';

const group = <T>(rows: readonly T[], key: (r: T) => string | null | undefined) => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
};

export interface WorldIndexes {
  tasksByLead: Map<string, Task[]>;
  tasksByAssignee: Map<string, Task[]>;
  callsByLead: Map<string, Call[]>;
  callsByUser: Map<string, Call[]>;
  runsByLead: Map<string, WorkflowRun[]>;
}

export function worldIndexes(ctx: WorldContext): WorldIndexes {
  return memo(ctx, 'indexes', () => {
    const tasks = worldTasks(ctx);
    const calls = worldCalls(ctx);
    const runs = worldWorkflowRuns(ctx);
    return {
      tasksByLead: group(tasks, (t) => t.leadId),
      tasksByAssignee: group(tasks, (t) => t.assignee?.id),
      callsByLead: group(calls, (c) => c.leadId),
      callsByUser: group(calls, (c) => c.user?.id),
      runsByLead: group(runs, (r) => r.leadId),
    };
  });
}

/** Workflow id -> name / template key. */
export const WORKFLOW_FIXTURE_NAMES: ReadonlyMap<string, string> = new Map(
  WORKFLOW_TEMPLATES.map((t) => [WORKFLOW_FIXTURE_IDS[t.key]!, t.name]),
);
export const WORKFLOW_FIXTURE_KEYS: ReadonlyMap<string, string> = new Map(
  WORKFLOW_TEMPLATES.map((t) => [WORKFLOW_FIXTURE_IDS[t.key]!, t.key]),
);

/** Timeline of one lead from the world (calls, chats, tasks and runs of that lead). */
export function worldTimelineFor(ctx: WorldContext, lead: LeadListItem): Activity[] {
  const ix = worldIndexes(ctx);
  const conversation = worldInbox(ctx).conversationByLead.get(lead.id);
  return worldLeadTimeline(ctx, lead, {
    calls: ix.callsByLead.get(lead.id) ?? [],
    tasks: ix.tasksByLead.get(lead.id) ?? [],
    messages: conversation
      ? (worldInbox(ctx).messagesByConversation.get(conversation.id) ?? [])
      : [],
    runs: (ix.runsByLead.get(lead.id) ?? [])
      .filter((r) => !r.isTest)
      .map((r) => worldWorkflowRun(ctx, r.id) ?? r),
    workflowNames: WORKFLOW_FIXTURE_NAMES,
  });
}

/** Notifications of one user from the world. */
export function worldNotificationsFor(ctx: WorldContext, userId: string): Notification[] {
  return memo(ctx, `notifications:${userId}`, () =>
    worldNotifications(ctx, userId, {
      tasks: worldTasks(ctx),
      inbox: worldInbox(ctx),
      runs: worldWorkflowRuns(ctx),
      workflowKeys: WORKFLOW_FIXTURE_KEYS,
    }),
  );
}

/** Everything at once (seed scripts, tests). Screens should read sections lazily instead. */
export function buildWorld(opts: { now?: Date | number; leads?: LeadListItem[] } = {}) {
  const ctx = createWorldContext(opts);
  return {
    ctx,
    leads: ctx.leads,
    tasks: worldTasks(ctx),
    calls: worldCalls(ctx),
    inbox: worldInbox(ctx),
    runs: worldWorkflowRuns(ctx),
    runStats: worldWorkflowStats(ctx),
    targets: worldTargets(ctx),
    audit: worldAuditLog(ctx),
    savedViews: worldSavedViews(ctx),
    integrations: worldIntegrations(ctx),
    webhooks: worldWebhookEndpoints(ctx),
    deliveries: worldWebhookDeliveries(ctx),
    billing: worldBilling(ctx),
    notifications: new Map(ctx.users.map((u) => [u.id, worldNotificationsFor(ctx, u.id)])),
    platform: worldPlatform(ctx.now),
  };
}
