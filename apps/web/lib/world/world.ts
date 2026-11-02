import {
  createWorldContext,
  worldAuditLog,
  worldBilling,
  worldCalls,
  worldIndexes,
  worldInbox,
  worldIntegrations,
  worldNotificationsFor,
  worldPlatform,
  worldSavedViews,
  worldTargets,
  worldTasks,
  worldTimelineFor,
  worldWebhookDeliveries,
  worldWebhookEndpoints,
  worldWorkflowRun,
  worldWorkflowRuns,
  worldWorkflowStats,
  type PlatformWorld,
  type WorldContext,
} from '@vistar/shared/fixtures';
import type { LeadListItem } from '@vistar/shared';
import { noteMockUse } from '../api/data-source';

/**
 * The mock "world" of the main workspace for this page load (Wave 1, browser only). One linked
 * dataset from `@vistar/shared/fixtures` world generators: 2,500 leads (MOCK_LEAD_COUNT) plus their
 * tasks, calls, WhatsApp chats, timelines, notifications, targets, workflow runs, audit log,
 * integrations, webhooks, billing and the Super Admin platform data.
 *
 * Anchored at the first read (`Date.now()`), so "due today", "calls today" and "new this week" are
 * always current. Every section is generated on first use and memoised; ids are stable across page
 * loads. Wave 3 replaces the readers in `./read.ts` with API calls; screens keep the same hooks.
 */
let ctx: WorldContext | null = null;
let platform: PlatformWorld | null = null;

export function worldContext(): WorldContext {
  noteMockUse('world');
  if (!ctx) ctx = createWorldContext({ now: Date.now() });
  return ctx;
}

/** Anchor time of the world (ms). */
export const worldNow = () => worldContext().now;

/** The generated leads (the Leads mock source starts from these and then applies edits). */
export const worldLeadsSeed = (): LeadListItem[] => worldContext().leads;

export const world = {
  tasks: () => worldTasks(worldContext()),
  calls: () => worldCalls(worldContext()),
  inbox: () => worldInbox(worldContext()),
  indexes: () => worldIndexes(worldContext()),
  runs: () => worldWorkflowRuns(worldContext()),
  run: (id: string) => worldWorkflowRun(worldContext(), id),
  runStats: () => worldWorkflowStats(worldContext()),
  targets: () => worldTargets(worldContext()),
  audit: () => worldAuditLog(worldContext()),
  savedViews: () => worldSavedViews(worldContext()),
  integrations: () => worldIntegrations(worldContext()),
  webhooks: () => worldWebhookEndpoints(worldContext()),
  deliveries: () => worldWebhookDeliveries(worldContext()),
  billing: () => worldBilling(worldContext()),
  notifications: (userId: string) => worldNotificationsFor(worldContext(), userId),
  timeline: (lead: LeadListItem) => worldTimelineFor(worldContext(), lead),
  // The platform view only needs a time, not the 2,500 leads of the main workspace.
  platform: () => (platform ??= worldPlatform(ctx?.now ?? Date.now())),
};
