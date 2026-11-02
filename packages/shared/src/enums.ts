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

/** App-wide interface style (SPEC 28.2, D-052). Default classic; resolve with resolveInterfaceStyle(). */
export const INTERFACE_STYLES = ['classic', 'depth', 'neon'] as const;
export const InterfaceStyleSchema = z.enum(INTERFACE_STYLES);
export type InterfaceStyle = z.infer<typeof InterfaceStyleSchema>;

/** Motion intensity (SPEC 28.2, D-052). Default full; resolve with resolveMotion(). */
export const MOTION_INTENSITIES = ['full', 'reduced', 'off'] as const;
export const MotionIntensitySchema = z.enum(MOTION_INTENSITIES);
export type MotionIntensity = z.infer<typeof MotionIntensitySchema>;

/** Leads Board skin (SPEC 28.1, D-052). Default depth; resolve with resolveBoardSkin(). */
export const BOARD_SKINS = ['flat', 'depth', 'neon'] as const;
export const BoardSkinSchema = z.enum(BOARD_SKINS);
export type BoardSkin = z.infer<typeof BoardSkinSchema>;

/** Board event celebrations (SPEC 28.1, D-052). Resolve with resolveCelebrations(). */
export const CELEBRATION_INTENSITIES = ['full', 'subtle', 'off'] as const;
export const CelebrationIntensitySchema = z.enum(CELEBRATION_INTENSITIES);
export type CelebrationIntensity = z.infer<typeof CelebrationIntensitySchema>;

// ---------------------------------------------------------------- change #19 (SPEC 29)

/**
 * Detailed live status (D-062), decided by the server from observed facts. `EmployeeStatus` stays the
 * coarse status on User/UserSummary (chips, dashboard); map with presenceToEmployeeStatus().
 */
export const PRESENCE_STATUSES = ['available', 'on_call', 'in_meeting', 'on_break', 'lunch', 'field_visit', 'away', 'offline'] as const;
export const PresenceStatusSchema = z.enum(PRESENCE_STATUSES);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

/** Statuses an employee may choose (PUT /me/status). on_call comes from phone state or the telephony adapter only. */
export const MANUAL_PRESENCE_STATUSES = ['available', 'in_meeting', 'on_break', 'lunch', 'field_visit', 'away', 'offline'] as const;
export const ManualPresenceStatusSchema = z.enum(MANUAL_PRESENCE_STATUSES);
export type ManualPresenceStatus = z.infer<typeof ManualPresenceStatusSchema>;

/** Which observed fact set the current presence. */
export const PRESENCE_SOURCES = ['session', 'heartbeat', 'manual', 'phone_state', 'call_log', 'telephony', 'attendance', 'working_hours', 'timeout', 'system'] as const;
export const PresenceSourceSchema = z.enum(PRESENCE_SOURCES);
export type PresenceSource = z.infer<typeof PresenceSourceSchema>;

const PRESENCE_TO_EMPLOYEE: Record<PresenceStatus, EmployeeStatus> = {
  available: 'idle',
  on_call: 'on_call',
  in_meeting: 'busy',
  on_break: 'away',
  lunch: 'away',
  field_visit: 'busy',
  away: 'away',
  offline: 'offline',
};
/** Coarse status written to User.status (and UserSummary.status) for a detailed presence. */
export function presenceToEmployeeStatus(status: PresenceStatus): EmployeeStatus {
  return PRESENCE_TO_EMPLOYEE[status];
}

/** App that reported a heartbeat or registered a device. */
export const CLIENT_KINDS = ['web', 'android'] as const;
export const ClientKindSchema = z.enum(CLIENT_KINDS);
export type ClientKind = z.infer<typeof ClientKindSchema>;

/** Where a call came from: the employee's SIM (Android app), a VoIP/telephony adapter, or the mock adapter/simulator. */
export const CALL_SOURCES = ['sim', 'voip', 'mock'] as const;
export const CallSourceSchema = z.enum(CALL_SOURCES);
export type CallSource = z.infer<typeof CallSourceSchema>;

/** Technical result of a call (device call log or telephony). `CallOutcome` stays the rep's disposition. */
export const CALL_RESULTS = ['connected', 'missed', 'no_answer', 'busy', 'rejected', 'failed'] as const;
export const CallResultSchema = z.enum(CALL_RESULTS);
export type CallResult = z.infer<typeof CallResultSchema>;

/** Web component design (D-059), workspace setting `ui.componentStyle`. */
export const COMPONENT_STYLES = ['standard', 'premium'] as const;
export const ComponentStyleSchema = z.enum(COMPONENT_STYLES);
export type ComponentStyle = z.infer<typeof ComponentStyleSchema>;

/** Upload purpose (D-065); decides size and type limits and who may read the file (UPLOAD_LIMITS). */
export const FILE_PURPOSES = ['logo', 'favicon', 'login_image', 'reference_image', 'floor_model', 'apk', 'call_recording', 'attachment'] as const;
export const FilePurposeSchema = z.enum(FILE_PURPOSES);
export type FilePurpose = z.infer<typeof FilePurposeSchema>;

/** public = served without auth at /api/files/p/{id} (branding only); private = signed URLs only. */
export const FILE_VISIBILITIES = ['private', 'public'] as const;
export const FileVisibilitySchema = z.enum(FILE_VISIBILITIES);
export type FileVisibility = z.infer<typeof FileVisibilitySchema>;

export const CUSTOM_DOMAIN_STATUSES = ['pending', 'verified', 'failed'] as const;
export const CustomDomainStatusSchema = z.enum(CUSTOM_DOMAIN_STATUSES);
export type CustomDomainStatus = z.infer<typeof CustomDomainStatusSchema>;

export const FLOOR_REQUEST_STATUSES = ['submitted', 'in_progress', 'published', 'rejected'] as const;
export const FloorRequestStatusSchema = z.enum(FLOOR_REQUEST_STATUSES);
export type FloorRequestStatus = z.infer<typeof FloorRequestStatusSchema>;

/** Category of a floor reference image (SPEC 29.5). */
export const FLOOR_IMAGE_CATEGORIES = ['work_area', 'cabin', 'meeting_room', 'reception', 'pantry_lounge', 'floor_plan', 'other'] as const;
export const FloorImageCategorySchema = z.enum(FLOOR_IMAGE_CATEGORIES);
export type FloorImageCategory = z.infer<typeof FloorImageCategorySchema>;

/** draft = uploaded, not visible to the company; published = the company's live floor; superseded = an older published version. */
export const FLOOR_ASSET_STATUSES = ['draft', 'published', 'superseded'] as const;
export const FloorAssetStatusSchema = z.enum(FLOOR_ASSET_STATUSES);
export type FloorAssetStatus = z.infer<typeof FloorAssetStatusSchema>;

/**
 * glb = binary glTF; gltf_zip = zip with one .gltf and its buffers/textures; layout_json = a Vistar floor plan
 * (FloorPlanSchema): plain JSON an AI chat (e.g. Claude) can write from the reference photos and a prompt
 * (FLOOR_PLAN_PROMPT); the web builds the 3D office from it with the module kit.
 */
export const FLOOR_MODEL_FORMATS = ['glb', 'gltf_zip', 'layout_json'] as const;
export const FloorModelFormatSchema = z.enum(FLOOR_MODEL_FORMATS);
export type FloorModelFormat = z.infer<typeof FloorModelFormatSchema>;

/** Seat kinds on a custom floor seat map. */
export const FLOOR_SEAT_KINDS = ['desk', 'cabin', 'meeting', 'lounge', 'reception'] as const;
export const FloorSeatKindSchema = z.enum(FLOOR_SEAT_KINDS);
export type FloorSeatKind = z.infer<typeof FloorSeatKindSchema>;

export const DEVICE_PLATFORMS = ['android', 'web'] as const;
export const DevicePlatformSchema = z.enum(DEVICE_PLATFORMS);
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;

/**
 * Where in the office someone is (room / zone level, D-062 extension): BLE beacons and Wi-Fi access points
 * observed by the Android app, a QR or NFC marker scanned at a room door, or the employee's own pick.
 * GPS is not used indoors (too coarse).
 */
export const ZONE_SIGNAL_SOURCES = ['ble', 'wifi', 'qr', 'nfc', 'manual'] as const;
export const ZoneSignalSourceSchema = z.enum(ZONE_SIGNAL_SOURCES);
export type ZoneSignalSource = z.infer<typeof ZoneSignalSourceSchema>;

export const OFFICE_MARKER_KINDS = ['ble_beacon', 'wifi_ap', 'qr', 'nfc'] as const;
export const OfficeMarkerKindSchema = z.enum(OFFICE_MARKER_KINDS);
export type OfficeMarkerKind = z.infer<typeof OfficeMarkerKindSchema>;

/** Screen the web or app user has open (client-reported with heartbeats; "what are they doing"). */
export const APP_SCREENS = ['home', 'leads', 'lead_detail', 'board', 'calls', 'call', 'inbox', 'conversation', 'tasks', 'team_floor', 'attendance', 'reports', 'settings', 'other'] as const;
export const AppScreenSchema = z.enum(APP_SCREENS);
export type AppScreen = z.infer<typeof AppScreenSchema>;

/** Targets (monthly). Prisma enum TargetMetric must match. */
export const TARGET_METRICS = ['revenue_inr', 'deals_won', 'calls', 'leads_converted'] as const;
export const TargetMetricSchema = z.enum(TARGET_METRICS);
export type TargetMetric = z.infer<typeof TargetMetricSchema>;
