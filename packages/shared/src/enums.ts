import { z } from 'zod';

/**
 * Enumerations shared by API, web, workers and Prisma.
 * Convention: `FOO_VALUES` (readonly tuple), `FooSchema` (zod), `type Foo`.
 * Prisma enums in apps/api/prisma/schema.prisma MUST use the same literal values.
 */

/**
 * Workspace role kinds. Every workspace role (system or custom) has exactly one kind, which decides
 * the panel (/app or /me) and the default data scope. SUPER_ADMIN is a platform role, not a kind.
 */
export const ROLE_KINDS = ['company_admin', 'manager', 'employee', 'viewer'] as const;
export const RoleKindSchema = z.enum(ROLE_KINDS);
export type RoleKind = z.infer<typeof RoleKindSchema>;

/** Platform role (Super Admin panel). Not tied to a workspace. */
export const PLATFORM_ROLES = ['super_admin'] as const;
export const PlatformRoleSchema = z.enum(PLATFORM_ROLES);
export type PlatformRole = z.infer<typeof PlatformRoleSchema>;

/** Record visibility for a role: own records, the manager's team(s), or the whole workspace. */
export const DATA_SCOPES = ['own', 'team', 'all'] as const;
export const DataScopeSchema = z.enum(DATA_SCOPES);
export type DataScope = z.infer<typeof DataScopeSchema>;

export const WORKSPACE_STATUSES = ['active', 'trial', 'suspended', 'deleted'] as const;
export const WorkspaceStatusSchema = z.enum(WORKSPACE_STATUSES);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

/** Employee presence. Chip tones: on_call=blue, idle=green, busy=amber, away/offline=grey. */
export const EMPLOYEE_STATUSES = ['on_call', 'busy', 'idle', 'away', 'offline'] as const;
export const EmployeeStatusSchema = z.enum(EMPLOYEE_STATUSES);
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;

export const LEAD_SOURCES = ['indiamart', 'website', 'whatsapp', 'manual', 'webhook', 'import', 'api'] as const;
export const LeadSourceSchema = z.enum(LEAD_SOURCES);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const STAGE_TYPES = ['open', 'won', 'lost'] as const;
export const StageTypeSchema = z.enum(STAGE_TYPES);
export type StageType = z.infer<typeof StageTypeSchema>;

export const LEAD_TEMPERATURES = ['hot', 'warm', 'cold'] as const;
export const LeadTemperatureSchema = z.enum(LEAD_TEMPERATURES);
export type LeadTemperature = z.infer<typeof LeadTemperatureSchema>;

export const TASK_TYPES = ['todo', 'call', 'follow_up', 'meeting', 'email'] as const;
export const TaskTypeSchema = z.enum(TASK_TYPES);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const CALL_DIRECTIONS = ['inbound', 'outbound'] as const;
export const CallDirectionSchema = z.enum(CALL_DIRECTIONS);
export type CallDirection = z.infer<typeof CallDirectionSchema>;

export const CALL_STATUSES = ['ringing', 'in_progress', 'completed', 'missed', 'failed'] as const;
export const CallStatusSchema = z.enum(CALL_STATUSES);
export type CallStatus = z.infer<typeof CallStatusSchema>;

export const CALL_OUTCOMES = [
  'answered',
  'missed',
  'interested',
  'not_interested',
  'callback',
  'wrong_number',
  'voicemail',
] as const;
export const CallOutcomeSchema = z.enum(CALL_OUTCOMES);
export type CallOutcome = z.infer<typeof CallOutcomeSchema>;

export const CHANNELS = ['whatsapp', 'email', 'sms', 'call'] as const;
export const ChannelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof ChannelSchema>;

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export const MessageDirectionSchema = z.enum(MESSAGE_DIRECTIONS);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const MESSAGE_TYPES = ['text', 'template', 'image', 'document', 'audio', 'video', 'interactive', 'note'] as const;
export const MessageTypeSchema = z.enum(MESSAGE_TYPES);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const MESSAGE_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed'] as const;
export const MessageStatusSchema = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const CONVERSATION_STATUSES = ['open', 'pending', 'closed'] as const;
export const ConversationStatusSchema = z.enum(CONVERSATION_STATUSES);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const CONSENT_STATUSES = ['opted_in', 'opted_out'] as const;
export const ConsentStatusSchema = z.enum(CONSENT_STATUSES);
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

export const CONSENT_SOURCES = ['web_form', 'inbound_message', 'manual', 'import', 'keyword_stop', 'api'] as const;
export const ConsentSourceSchema = z.enum(CONSENT_SOURCES);
export type ConsentSource = z.infer<typeof ConsentSourceSchema>;

export const TEMPLATE_CATEGORIES = ['marketing', 'utility', 'authentication'] as const;
export const TemplateCategorySchema = z.enum(TEMPLATE_CATEGORIES);
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;

export const TEMPLATE_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'paused'] as const;
export const TemplateStatusSchema = z.enum(TEMPLATE_STATUSES);
export type TemplateStatus = z.infer<typeof TemplateStatusSchema>;

export const WORKFLOW_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export const WorkflowStatusSchema = z.enum(WORKFLOW_STATUSES);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WORKFLOW_RUN_STATUSES = ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'] as const;
export const WorkflowRunStatusSchema = z.enum(WORKFLOW_RUN_STATUSES);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export const WORKFLOW_STEP_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'skipped', 'waiting'] as const;
export const WorkflowStepStatusSchema = z.enum(WORKFLOW_STEP_STATUSES);
export type WorkflowStepStatus = z.infer<typeof WorkflowStepStatusSchema>;

export const INTEGRATION_PROVIDERS = ['indiamart', 'whatsapp_cloud', 'telephony', 'smtp', 'google_calendar'] as const;
export const IntegrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;

export const INTEGRATION_STATUSES = ['disconnected', 'connected', 'error'] as const;
export const IntegrationStatusSchema = z.enum(INTEGRATION_STATUSES);
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const WEBHOOK_DIRECTIONS = ['inbound', 'outbound'] as const;
export const WebhookDirectionSchema = z.enum(WEBHOOK_DIRECTIONS);
export type WebhookDirection = z.infer<typeof WebhookDirectionSchema>;

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'success', 'failed', 'dead'] as const;
export const WebhookDeliveryStatusSchema = z.enum(WEBHOOK_DELIVERY_STATUSES);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatusSchema>;

export const INBOUND_WEBHOOK_ACTIONS = ['create_lead', 'start_workflow'] as const;
export const InboundWebhookActionSchema = z.enum(INBOUND_WEBHOOK_ACTIONS);
export type InboundWebhookAction = z.infer<typeof InboundWebhookActionSchema>;

export const ACTIVITY_TYPES = [
  'lead_created',
  'note',
  'call',
  'message',
  'email',
  'stage_changed',
  'assigned',
  'task_created',
  'task_completed',
  'workflow_step',
  'file_uploaded',
  'field_updated',
  'merged',
] as const;
export const ActivityTypeSchema = z.enum(ACTIVITY_TYPES);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export const AUDIT_ACTOR_TYPES = ['user', 'api_key', 'system', 'workflow', 'super_admin'] as const;
export const AuditActorTypeSchema = z.enum(AUDIT_ACTOR_TYPES);
export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;

export const NOTIFICATION_TYPES = [
  'lead_assigned',
  'message_received',
  'task_due',
  'task_overdue',
  'workflow_failed',
  'mention',
  'import_completed',
  'system',
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const PLANS = ['free', 'starter', 'growth', 'enterprise'] as const;
export const PlanSchema = z.enum(PLANS);
export type Plan = z.infer<typeof PlanSchema>;

export const TEAM_FLOOR_MODES = ['auto', '3d', 'flat'] as const;
export const TeamFloorModeSchema = z.enum(TEAM_FLOOR_MODES);
export type TeamFloorMode = z.infer<typeof TeamFloorModeSchema>;

/** Leads page view. Default "board"; see resolveLeadsViewMode() in schemas/lead.ts. */
export const LEADS_VIEW_MODES = ['board', 'table'] as const;
export const LeadsViewModeSchema = z.enum(LEADS_VIEW_MODES);
export type LeadsViewMode = z.infer<typeof LeadsViewModeSchema>;

/** Targets (monthly). Prisma enum TargetMetric must match. */
export const TARGET_METRICS = ['revenue_inr', 'deals_won', 'calls', 'leads_converted'] as const;
export const TargetMetricSchema = z.enum(TARGET_METRICS);
export type TargetMetric = z.infer<typeof TargetMetricSchema>;
