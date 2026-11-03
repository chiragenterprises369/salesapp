/**
 * @vistar/shared: the contract package. Agents may READ but never MODIFY these files.
 * Request contract changes through the orchestrator (see CONTRACTS.md).
 */
export * from './enums.js';
export * from './errors.js';
export * from './rbac.js';
export * from './navigation.js';
export * from './theme.js';
export * from './appearance.js';
export * from './format.js';
export * from './webhooks.js';
export * from './events.js';
export * from './design/tokens.js';

export * from './schemas/common.js';
export * from './schemas/workspace.js';
export * from './schemas/auth.js';
export * from './schemas/lead.js';
export * from './schemas/pipeline.js';
export * from './schemas/activity.js';
export * from './schemas/task.js';
export * from './schemas/call.js';
export * from './schemas/conversation.js';
export * from './schemas/notification.js';
export * from './schemas/dashboard.js';
export * from './schemas/integration.js';
export * from './schemas/workflow.js';
export * from './schemas/platform.js';
export * from './schemas/storage.js';
export * from './schemas/branding.js';
export * from './schemas/app-platform.js';
export * from './schemas/presence.js';
export * from './schemas/attendance.js';
export * from './schemas/floor.js';
export * from './schemas/catalog.js';
export * from './schemas/crm.js';
export * from './schemas/documents.js';
export * from './schemas/calendar.js';
export * from './schemas/crm-related.js';
export * from './schemas/routing.js';
export * from './schemas/capture.js';
// ---- change #19 wave C: hub
export * from './integrations.js';
export * from './mapping.js';
// ---- end change #19 wave C: hub
export * from './branding.js';
export * from './gst.js';

export * from './workflow/nodes.js';
export * from './workflow/graph.js';
export * from './workflow/templates.js';

export * from './customization/fields.js';
export * from './customization/labels.js';
export * from './customization/values.js';
export * from './customization/objects.js';

export * from './packs/active.js';
export * from './packs/manifest.js';
export * from './packs/planner.js';
export * from './packs/runtime.js';
export * from './packs/generic-sales.js';

export * from './api/routes.js';
