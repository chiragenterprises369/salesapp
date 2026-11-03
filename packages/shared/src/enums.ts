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

/**
 * Change #19 wave C (D-069): not_connected (never connected or disconnected), connected (last check ok), error
 * (last test or sync failed), needs_attention (connected, but the admin must act: e.g. WhatsApp webhook not
 * verified yet, Google access revoked, IndiaMART rate limit). The reason is in Integration.attention / lastError.
 */
export const INTEGRATION_STATUSES = ['not_connected', 'connected', 'error', 'needs_attention'] as const;
export const IntegrationStatusSchema = z.enum(INTEGRATION_STATUSES);
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const WEBHOOK_DIRECTIONS = ['inbound', 'outbound'] as const;
export const WebhookDirectionSchema = z.enum(WEBHOOK_DIRECTIONS);
export type WebhookDirection = z.infer<typeof WebhookDirectionSchema>;

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'success', 'failed', 'dead'] as const;
export const WebhookDeliveryStatusSchema = z.enum(WEBHOOK_DELIVERY_STATUSES);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatusSchema>;

/** update_lead (wave C): update the lead matched by phone or email (WebhookEndpoint.matchBy); create one when none matches and createIfMissing. */
export const INBOUND_WEBHOOK_ACTIONS = ['create_lead', 'update_lead', 'start_workflow'] as const;
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
  /** Change #19 wave B: calendar reminder (Meeting.reminders minutes before the start). */
  'meeting_reminder',
  // ---- change #19 wave C: billing (company admins; Vistar subscription)
  /** The trial ends in BILLING_TRIAL_REMINDER_DAYS days. */
  'billing_trial_ending',
  /** A checkout payment failed, or a Vistar invoice is overdue (dunning reminders). */
  'billing_payment_failed',
  /** Vistar issued an invoice to the company. */
  'billing_invoice_issued',
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

// ---------------------------------------------------------------- change #19 wave B (SPEC 29.9): CRM features

/** Labels of extra phone numbers and email addresses on contacts and accounts. */
export const CONTACT_POINT_LABELS = ['mobile', 'work', 'home', 'whatsapp', 'billing', 'other'] as const;
export const ContactPointLabelSchema = z.enum(CONTACT_POINT_LABELS);
export type ContactPointLabel = z.infer<typeof ContactPointLabelSchema>;

/** Pipelines hold leads (the Leads board) or deals (the Deals board). Pipeline.entity column. */
export const PIPELINE_ENTITIES = ['lead', 'deal'] as const;
export const PipelineEntitySchema = z.enum(PIPELINE_ENTITIES);
export type PipelineEntity = z.infer<typeof PipelineEntitySchema>;

/** GST rates in percent (SPEC 29.9). Product.gstRate and document lines use these values only. */
export const GST_RATES = [0, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_RATES)[number];
export const GstRateSchema = z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]);

/** Goods carry an HSN code, services a SAC code (99xxxx). */
export const PRODUCT_KINDS = ['goods', 'service'] as const;
export const ProductKindSchema = z.enum(PRODUCT_KINDS);
export type ProductKind = z.infer<typeof ProductKindSchema>;

/** Units of measure: GST UQC codes (labels in PRODUCT_UNIT_LABELS, schemas/catalog.ts). */
export const PRODUCT_UNITS = ['NOS', 'PCS', 'SET', 'PRS', 'DOZ', 'BOX', 'PAC', 'CTN', 'BAG', 'BTL', 'CAN', 'ROL', 'BDL', 'KGS', 'GMS', 'QTL', 'TON', 'LTR', 'MLT', 'KLR', 'MTR', 'CMS', 'SQM', 'SQF', 'CBM', 'UNT', 'OTH'] as const;
export const ProductUnitSchema = z.enum(PRODUCT_UNITS);
export type ProductUnit = z.infer<typeof ProductUnitSchema>;

/** Line discount: percent of the line amount, or a fixed amount in paise. */
export const DISCOUNT_KINDS = ['percent', 'amount'] as const;
export const DiscountKindSchema = z.enum(DISCOUNT_KINDS);
export type DiscountKind = z.infer<typeof DiscountKindSchema>;

/** intra = CGST + SGST (seller and place of supply in the same state), inter = IGST. */
export const TAX_MODES = ['intra', 'inter'] as const;
export const TaxModeSchema = z.enum(TAX_MODES);
export type TaxMode = z.infer<typeof TaxModeSchema>;

/** Quotation status flow (QUOTATION_TRANSITIONS in schemas/documents.ts). Prisma enum QuotationStatus must match. */
export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const;
export const QuotationStatusSchema = z.enum(QUOTATION_STATUSES);
export type QuotationStatus = z.infer<typeof QuotationStatusSchema>;

/** Invoice status flow; partially_paid and paid follow the recorded payments. Prisma enum InvoiceStatus must match. */
export const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'] as const;
export const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

/** Manually recorded payments. Prisma enum PaymentMode must match. */
export const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'] as const;
export const PaymentModeSchema = z.enum(PAYMENT_MODES);
export type PaymentMode = z.infer<typeof PaymentModeSchema>;

/** Sales document kinds (numbering series, share links, PDFs). */
export const DOCUMENT_KINDS = ['quotation', 'invoice'] as const;
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

/** Prisma enum MeetingStatus must match. */
export const MEETING_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export const MeetingStatusSchema = z.enum(MEETING_STATUSES);
export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;

export const MEETING_MODES = ['in_person', 'video', 'phone'] as const;
export const MeetingModeSchema = z.enum(MEETING_MODES);
export type MeetingMode = z.infer<typeof MeetingModeSchema>;

/** Prisma enum AttendeeResponse must match. */
export const ATTENDEE_RESPONSES = ['pending', 'accepted', 'declined', 'tentative'] as const;
export const AttendeeResponseSchema = z.enum(ATTENDEE_RESPONSES);
export type AttendeeResponse = z.infer<typeof AttendeeResponseSchema>;

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export const RecurrenceFrequencySchema = z.enum(RECURRENCE_FREQUENCIES);
export type RecurrenceFrequency = z.infer<typeof RecurrenceFrequencySchema>;

export const TIME_OFF_KINDS = ['leave', 'holiday', 'training', 'other'] as const;
export const TimeOffKindSchema = z.enum(TIME_OFF_KINDS);
export type TimeOffKind = z.infer<typeof TimeOffKindSchema>;

/** Lead routing: round robin over the eligible pool, or the eligible user with the fewest open leads. */
export const ROUTING_STRATEGIES = ['round_robin', 'least_busy'] as const;
export const RoutingStrategySchema = z.enum(ROUTING_STRATEGIES);
export type RoutingStrategy = z.infer<typeof RoutingStrategySchema>;

/** Field types of the lead capture form builder. */
export const CAPTURE_FIELD_TYPES = ['text', 'email', 'phone', 'textarea', 'number', 'select', 'multi_select', 'checkbox', 'date', 'hidden'] as const;
export const CaptureFieldTypeSchema = z.enum(CAPTURE_FIELD_TYPES);
export type CaptureFieldType = z.infer<typeof CaptureFieldTypeSchema>;

export const CAPTURE_FORM_STATUSES = ['active', 'paused'] as const;
export const CaptureFormStatusSchema = z.enum(CAPTURE_FORM_STATUSES);
export type CaptureFormStatus = z.infer<typeof CaptureFormStatusSchema>;

/** Entities with CRM notes and a merged timeline (contacts, accounts, deals). */
export const CRM_NOTE_ENTITIES = ['contact', 'account', 'deal'] as const;
export const CrmNoteEntitySchema = z.enum(CRM_NOTE_ENTITIES);
export type CrmNoteEntity = z.infer<typeof CrmNoteEntitySchema>;

// ---- change #19 wave C: hub (integrations, webhooks, API keys; D-069, D-070)

/** live = real provider API; mock = in-process dev provider (development and test only, refused in production). */
export const INTEGRATION_MODES = ['live', 'mock'] as const;
export const IntegrationModeSchema = z.enum(INTEGRATION_MODES);
export type IntegrationMode = z.infer<typeof IntegrationModeSchema>;

/** Server-side availability of a provider: not_configured = a platform env setting is missing (e.g. Google OAuth client). */
export const INTEGRATION_AVAILABILITIES = ['ready', 'not_configured'] as const;
export const IntegrationAvailabilitySchema = z.enum(INTEGRATION_AVAILABILITIES);
export type IntegrationAvailability = z.infer<typeof IntegrationAvailabilitySchema>;

/** Telephony adapters: mock (dev) and exotel (stub behind config). */
export const TELEPHONY_PROVIDERS = ['mock', 'exotel'] as const;
export const TelephonyProviderSchema = z.enum(TELEPHONY_PROVIDERS);
export type TelephonyProvider = z.infer<typeof TelephonyProviderSchema>;

/** How an inbound source proves the sender: hmac = X-Vistar-Signature (default); token = X-Vistar-Token header or ?token= (for tools that cannot sign). */
export const WEBHOOK_VERIFICATIONS = ['hmac', 'token'] as const;
export const WebhookVerificationSchema = z.enum(WEBHOOK_VERIFICATIONS);
export type WebhookVerification = z.infer<typeof WebhookVerificationSchema>;

/** Inbound match keys for update_lead / start_workflow. */
export const WEBHOOK_MATCH_KEYS = ['phone', 'email'] as const;
export const WebhookMatchKeySchema = z.enum(WEBHOOK_MATCH_KEYS);
export type WebhookMatchKey = z.infer<typeof WebhookMatchKeySchema>;

/** API key state derived from revokedAt / expiresAt. */
export const API_KEY_STATUSES = ['active', 'expired', 'revoked'] as const;
export const ApiKeyStatusSchema = z.enum(API_KEY_STATUSES);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;
// ---- change #19 wave C: billing (Vistar subscription of a company; Prisma enums use the same literals)

/** trialing -> active (paid or free plan) -> past_due (an invoice is overdue) -> cancelled (dropped to free after the grace period). */
export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;
export const SubscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const BILLING_CYCLES = ['monthly', 'yearly'] as const;
export const BillingCycleSchema = z.enum(BILLING_CYCLES);
export type BillingCycle = z.infer<typeof BillingCycleSchema>;

/** Invoices from Vistar to a company (not the company's own CRM invoices). */
export const PLATFORM_INVOICE_STATUSES = ['draft', 'issued', 'paid', 'cancelled'] as const;
export const PlatformInvoiceStatusSchema = z.enum(PLATFORM_INVOICE_STATUSES);
export type PlatformInvoiceStatus = z.infer<typeof PlatformInvoiceStatusSchema>;

/** subscription = renewal or first period after the trial; plan_change = upgrade (prorated); manual = created by a Super Admin. */
export const PLATFORM_INVOICE_KINDS = ['subscription', 'plan_change', 'manual'] as const;
export const PlatformInvoiceKindSchema = z.enum(PLATFORM_INVOICE_KINDS);
export type PlatformInvoiceKind = z.infer<typeof PlatformInvoiceKindSchema>;

export const PLATFORM_PAYMENT_STATUSES = ['created', 'captured', 'failed', 'refunded'] as const;
export const PlatformPaymentStatusSchema = z.enum(PLATFORM_PAYMENT_STATUSES);
export type PlatformPaymentStatus = z.infer<typeof PlatformPaymentStatusSchema>;

/** razorpay = Razorpay checkout; mock = local dev provider (no network); manual = marked paid by a Super Admin. */
export const PAYMENT_PROVIDERS = ['razorpay', 'mock', 'manual'] as const;
export const PaymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

/** Upgrade requests made while no checkout is configured; the Super Admin approves or rejects. */
export const PLAN_CHANGE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const PlanChangeStatusSchema = z.enum(PLAN_CHANGE_STATUSES);
export type PlanChangeStatus = z.infer<typeof PlanChangeStatusSchema>;

/**
 * Metered usage against plan limits. seats, leads, storage_mb and api_keys are current totals; whatsapp_messages,
 * api_calls and workflow_runs count the current calendar month (IST, UsageCounter.period YYYY-MM).
 */
export const USAGE_METRICS = ['seats', 'leads', 'storage_mb', 'whatsapp_messages', 'api_calls', 'workflow_runs', 'api_keys'] as const;
export const UsageMetricSchema = z.enum(USAGE_METRICS);
export type UsageMetric = z.infer<typeof UsageMetricSchema>;
