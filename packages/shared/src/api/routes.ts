import { z } from 'zod';
import type { Permission, PlatformPermission } from '../rbac.js';
// ---- change #19 wave C: billing
import { BILLING_ROUTES } from './routes-billing.js';
// ---- change #20: config
import { CONFIG_ROUTES } from './routes-config.js';
import {
  CompanyCreatedSchema,
  CompanyCreateSchema,
  CompanyFlagsUpdateSchema,
  CompanyListQuerySchema,
  CompanySchema,
  CompanyStatusChangeSchema,
  CompanyUpdateSchema,
  ImpersonationSessionSchema,
  ImpersonationStartSchema,
  PlanDefinitionSchema,
  PlatformAuditLogSchema,
  PlatformOverviewSchema,
} from '../schemas/platform.js';
import {
  AndroidReleaseSchema,
  AndroidReleaseUpdateSchema,
  AndroidReleaseUploadFieldsSchema,
  AppConfigSchema,
  DeviceRegisterSchema,
  DeviceSchema,
  FirebaseConfigPartSchema,
  FirebaseConfigStatusSchema,
  PushTestResultSchema,
  PushTestSchema,
} from '../schemas/app-platform.js';
import {
  AttendanceCheckSchema,
  AttendanceRegisterQuerySchema,
  AttendanceRegisterSchema,
  AttendanceSessionSchema,
  FieldLiveQuerySchema,
  FieldLiveSchema,
  FieldRouteQuerySchema,
  FieldRouteSchema,
  LocationBatchResultSchema,
  LocationBatchSchema,
  MyAttendanceTodaySchema,
  TrackingConsentSchema,
  TrackingConsentUpdateSchema,
} from '../schemas/attendance.js';
import {
  BrandingUpdateSchema,
  CustomDomainSetSchema,
  CustomDomainStateSchema,
  HostResolutionSchema,
  HostResolveQuerySchema,
  PublicWorkspaceSchema,
  SlugParamSchema,
  WorkspaceBrandingSchema,
} from '../schemas/branding.js';
import {
  FloorAssetSchema,
  FloorRequestCreateSchema,
  FloorRequestSchema,
  FloorRequestStatusChangeSchema,
  FloorUploadFieldsSchema,
  SeatMapSchema,
  SuperFloorRequestListQuerySchema,
  TeamFloorLayoutSchema,
} from '../schemas/floor.js';
import {
  MyPresenceSchema,
  OfficeMarkerCreateSchema,
  OfficeMarkerSchema,
  PresenceEventSchema,
  PresenceHeartbeatSchema,
  PresenceHistoryQuerySchema,
  ZoneSignalSchema,
} from '../schemas/presence.js';
import { FileUploadFieldsSchema, FileUrlSchema, SignedFileTokenParamSchema, StoredFileSchema } from '../schemas/storage.js';
import { ActivitySchema } from '../schemas/activity.js';
import {
  AuthTokensSchema,
  GoogleAuthRequestSchema,
  InviteAcceptSchema,
  InviteCreateSchema,
  InviteSchema,
  LoginRequestSchema,
  PlatformAdminSchema,
  SignupRequestSchema,
  SuperLoginChallengeSchema,
  SuperLoginRequestSchema,
  SuperSessionSchema,
  SuperVerifyRequestSchema,
} from '../schemas/auth.js';
import {
  ActiveCallEventSchema,
  CallListQuerySchema,
  CallSchema,
  CallUpdateSchema,
  ClickToCallSchema,
  DeviceCallLogBatchSchema,
  DeviceCallLogResultSchema,
  RecordingUrlSchema,
} from '../schemas/call.js';
import { CursorPaginationQuerySchema, IdParamSchema, IdSchema, OkResponseSchema, pageOf } from '../schemas/common.js';
import {
  ConversationAssignSchema,
  ConversationListQuerySchema,
  ConversationSchema,
  MessageSchema,
  MessageSendSchema,
  QuickReplySchema,
  TemplateSchema,
} from '../schemas/conversation.js';
import { DashboardQuerySchema, DashboardSummarySchema, MyTodaySchema, TeamFloorSnapshotSchema } from '../schemas/dashboard.js';
import {
  ApiKeyCreatedSchema,
  ApiKeyCreateSchema,
  ApiKeyRotateSchema,
  ApiKeySchema,
  ApiKeyScopeOptionSchema,
  ApiKeyUpdateSchema,
  InboundEndpointCreateSchema,
  IndiamartPushResultSchema,
  IntegrationConnectSchema,
  IntegrationOAuthStartSchema,
  IntegrationProviderInfoSchema,
  IntegrationProviderParamSchema,
  IntegrationSchema,
  IntegrationSyncResultSchema,
  IntegrationTestRequestSchema,
  IntegrationTestResultSchema,
  MappingPreviewRequestSchema,
  MappingPreviewResponseSchema,
  OAuthCallbackQuerySchema,
  OutboundEndpointCreateSchema,
  PublicOpenApiDocumentSchema,
  TelephonyProviderParamSchema,
  WebhookCaptureSchema,
  WebhookDeliveryQuerySchema,
  WebhookDeliverySchema,
  WebhookEndpointListQuerySchema,
  WebhookEndpointSchema,
  WebhookEndpointUpdateSchema,
  WebhookRotateSecretSchema,
  WebhookSecretRotatedSchema,
  WebhookSecretSchema,
  WebhookTestSendSchema,
  WhatsappVerifyQuerySchema,
} from '../schemas/integration.js';
import {
  BulkResultSchema,
  ImportCommitRequestSchema,
  ImportJobSchema,
  ImportPreviewResponseSchema,
  LeadBulkActionSchema,
  LeadCreateSchema,
  LeadFiltersSchema,
  LeadListItemSchema,
  LeadListQuerySchema,
  LeadMergeSchema,
  LeadSchema,
  LeadUpdateSchema,
  NoteCreateSchema,
  SavedViewCreateSchema,
  SavedViewSchema,
  TagSchema,
} from '../schemas/lead.js';
import {
  AuditLogQuerySchema,
  AuditLogSchema,
  NotificationListQuerySchema,
  NotificationMarkReadSchema,
  NotificationSchema,
  PushSubscriptionSchema,
} from '../schemas/notification.js';
import {
  BoardSchema,
  LeadMoveSchema,
  PipelineListQuerySchema,
  PipelineSchema,
  StageCreateSchema,
  StageReorderSchema,
  StageSchema,
  StageUpdateSchema,
} from '../schemas/pipeline.js';
import {
  PriceListCreateSchema,
  PriceListSchema,
  PriceListUpdateSchema,
  ProductCreateSchema,
  ProductListQuerySchema,
  ProductSchema,
  ProductUpdateSchema,
} from '../schemas/catalog.js';
import {
  AccountCreateSchema,
  AccountListItemSchema,
  AccountListQuerySchema,
  AccountSchema,
  AccountUpdateSchema,
  ContactCreateSchema,
  ContactListItemSchema,
  ContactListQuerySchema,
  ContactSchema,
  ContactUpdateSchema,
  CrmBulkActionSchema,
  CrmMergeSchema,
  CrmNoteCreateSchema,
  CrmTimelineItemSchema,
  DealBoardQuerySchema,
  DealBulkActionSchema,
  DealCreateSchema,
  DealListItemSchema,
  DealListQuerySchema,
  DealMoveSchema,
  DealSchema,
  DealUpdateSchema,
  LeadConvertSchema,
} from '../schemas/crm.js';
import { CrmRelatedSchema, DealBoardSchema, LeadConvertResultSchema } from '../schemas/crm-related.js';
import {
  DocumentPdfQuerySchema,
  DocumentShareCreateSchema,
  DocumentShareSchema,
  DocumentTokenParamSchema,
  InvoiceCancelSchema,
  InvoiceCreateSchema,
  InvoiceIssueSchema,
  InvoiceListItemSchema,
  InvoiceListQuerySchema,
  InvoiceSchema,
  InvoiceSendResultSchema,
  InvoiceUpdateSchema,
  PaymentCreateSchema,
  PaymentParamSchema,
  PublicDocumentSchema,
  QuotationCreateSchema,
  QuotationListItemSchema,
  QuotationListQuerySchema,
  QuotationSchema,
  QuotationSendResultSchema,
  QuotationStatusChangeSchema,
  QuotationUpdateSchema,
  SellerProfileResponseSchema,
  SellerProfileSchema,
} from '../schemas/documents.js';
import {
  AvailabilityQuerySchema,
  MeetingCancelSchema,
  MeetingCreateSchema,
  MeetingListQuerySchema,
  MeetingRespondSchema,
  MeetingSchema,
  MeetingUpdateSchema,
  TimeOffCreateSchema,
  TimeOffListQuerySchema,
  TimeOffSchema,
  UserAvailabilitySchema,
} from '../schemas/calendar.js';
import {
  RoutingDecisionSchema,
  RoutingRuleCreateSchema,
  RoutingRuleOrderSchema,
  RoutingRuleSchema,
  RoutingRuleUpdateSchema,
  RoutingTestSchema,
} from '../schemas/routing.js';
import {
  CaptureFormCreateSchema,
  CaptureFormKeyParamSchema,
  CaptureFormSchema,
  CaptureFormUpdateSchema,
  CaptureSubmissionListQuerySchema,
  CaptureSubmissionSchema,
  PublicCaptureFormSchema,
  PublicCaptureSubmitResultSchema,
  PublicCaptureSubmitSchema,
} from '../schemas/capture.js';
import { TaskCreateSchema, TaskListQuerySchema, TaskSchema, TaskSnoozeSchema, TaskUpdateSchema } from '../schemas/task.js';
import {
  WorkflowCreateSchema,
  WorkflowListItemSchema,
  WorkflowPublishSchema,
  WorkflowRollbackSchema,
  WorkflowRunListQuerySchema,
  WorkflowRunSchema,
  WorkflowSchema,
  WorkflowStatusChangeSchema,
  WorkflowTemplateSummarySchema,
  WorkflowTestRunSchema,
  WorkflowUpdateSchema,
  WorkflowVersionSchema,
} from '../schemas/workflow.js';
import {
  MeResponseSchema,
  ProfileUpdateSchema,
  RoleCreateSchema,
  RoleSchema,
  RoleUpdateSchema,
  StatusUpdateSchema,
  SupportAccessUpdateSchema,
  TeamSchema,
  UserSchema,
  UserSettingsSchema,
  UserSettingsUpdateSchema,
  UserSummarySchema,
  UserUpdateSchema,
  WorkspaceSchema,
  WorkspaceUpdateSchema,
} from '../schemas/workspace.js';
import { ThemeModeSchema } from '../theme.js';
import {
  FieldDefinitionCreateSchema,
  FieldDefinitionSchema,
  FieldDefinitionUpdateSchema,
  FieldListQuerySchema,
  FieldReorderSchema,
} from '../customization/fields.js';
import { LabelsResponseSchema, LabelsUpdateSchema } from '../customization/labels.js';
import {
  CustomObjectCreateSchema,
  CustomObjectSchema,
  CustomObjectUpdateSchema,
  CustomRecordCreateSchema,
  CustomRecordListQuerySchema,
  CustomRecordSchema,
  CustomRecordUpdateSchema,
  ObjectKeyParamSchema,
  RecordParamSchema,
} from '../customization/objects.js';
import {
  PackCompanyParamSchema,
  PackCompanyUsageSchema,
  PackInstallLogSchema,
  PackInstallRequestSchema,
  PackInstallResultSchema,
  PackKeyParamSchema,
  PackListItemSchema,
  PackPlanQuerySchema,
  PackPlanResponseSchema,
  PackRuntimeSchema,
  PackUsageSchema,
  PackVersionParamSchema,
  SuperPackCompanyUpdateSchema,
  SuperPackPlansUpdateSchema,
  SuperPackSchema,
  SuperPackVersionSchema,
} from '../packs/runtime.js';

/**
 * REST API CONTRACT
 * Base path: /api/v1 (API_BASE_PATH). Routes with `absolute: true` are mounted at the given path
 * (inbound webhooks, health). Paths use OpenAPI `{param}` syntax; use toNestPath() in controllers.
 * Auth:
 *  - jwt:            Authorization: Bearer <access token>
 *  - api_key:        Authorization: Bearer vst_live_... (public API, scoped)
 *  - jwt_or_api_key: either
 *  - public:         no auth (rate limited)
 *  - webhook:        HMAC signature (see webhooks.ts)
 * `permission` is enforced by the RBAC guard; null = any authenticated user.
 * Responses are JSON; errors use ApiErrorSchema.
 */
export const API_BASE_PATH = '/api/v1';

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';
/** `super` = platform audience token (Super Admin), mounted under /api/super. */
export type RouteAuth = 'jwt' | 'api_key' | 'jwt_or_api_key' | 'public' | 'webhook' | 'super' | 'super_public';
/** Owning agent (see OWNERSHIP.md). */
export type RouteOwner = 'backend-core' | 'realtime-integrations' | 'workflow-engine' | 'superadmin-panel';

export interface RouteDef {
  method: HttpMethod;
  path: string;
  absolute?: boolean;
  summary: string;
  tag: string;
  owner: RouteOwner;
  phase: number;
  auth: RouteAuth;
  permission: Permission | PlatformPermission | null;
  params?: z.ZodObject;
  query?: z.ZodType;
  body?: z.ZodType;
  /** Non-JSON request body, e.g. multipart file upload. */
  bodyContentType?: 'multipart/form-data';
  /** Text fields that come with a multipart upload (besides the `file` part). */
  bodyFields?: z.ZodObject;
  response: z.ZodType | null;
  /** Non-JSON response, e.g. file download. */
  responseContentType?: 'text/csv' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' | 'application/octet-stream' | 'application/vnd.android.package-archive' | 'application/pdf' | 'text/plain' | 'text/html';
  status?: number;
}

const route = <R extends RouteDef>(r: R) => r;
const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

export const AuthSessionSchema = AuthTokensSchema.extend({ me: MeResponseSchema });
export const InboundWebhookResponseSchema = z.object({
  ok: z.literal(true),
  duplicate: z.boolean(),
  leadId: IdSchema.nullable(),
  runId: IdSchema.nullable(),
  /** change #19 wave C: the delivery id (also in the delivery log) and whether it was stored as the sample (capture mode). */
  deliveryId: IdSchema,
  captured: z.boolean(),
});

const CORE_ROUTES = {
  // ---------------- health ----------------
  health: route({ method: 'get', path: '/api/health', absolute: true, summary: 'Health check', tag: 'system', owner: 'backend-core', phase: 1, auth: 'public', permission: null, response: z.object({ ok: z.boolean(), db: z.boolean(), redis: z.boolean(), version: z.string() }) }),

  // ---------------- auth & onboarding (phase 1) ----------------
  authSignup: route({ method: 'post', path: '/auth/signup', summary: 'Sign up and create a workspace', tag: 'auth', owner: 'backend-core', phase: 1, auth: 'public', permission: null, body: SignupRequestSchema, response: AuthSessionSchema, status: 201 }),
  authLogin: route({ method: 'post', path: '/auth/login', summary: 'Log in with email and password', tag: 'auth', owner: 'backend-core', phase: 1, auth: 'public', permission: null, body: LoginRequestSchema, response: AuthSessionSchema }),
  authGoogle: route({ method: 'post', path: '/auth/google', summary: 'Log in or sign up with Google', tag: 'auth', owner: 'backend-core', phase: 1, auth: 'public', permission: null, body: GoogleAuthRequestSchema, response: AuthSessionSchema }),
  authRefresh: route({ method: 'post', path: '/auth/refresh', summary: 'Rotate refresh cookie and issue an access token', tag: 'auth', owner: 'backend-core', phase: 1, auth: 'public', permission: null, response: AuthTokensSchema }),
  authLogout: route({ method: 'post', path: '/auth/logout', summary: 'Revoke the current session', tag: 'auth', owner: 'backend-core', phase: 1, auth: 'jwt', permission: null, response: OkResponseSchema }),
  authMe: route({ method: 'get', path: '/auth/me', summary: 'Current user, workspace, permissions and settings', tag: 'auth', owner: 'backend-core', phase: 1, auth: 'jwt', permission: null, response: MeResponseSchema }),
  inviteCreate: route({ method: 'post', path: '/invites', summary: 'Invite by email or create a link', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'team.manage', body: InviteCreateSchema, response: InviteSchema, status: 201 }),
  inviteList: route({ method: 'get', path: '/invites', summary: 'Pending invites', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'team.manage', response: listOf(InviteSchema) }),
  inviteRevoke: route({ method: 'delete', path: '/invites/{id}', summary: 'Revoke an invite', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'team.manage', params: IdParamSchema, response: OkResponseSchema }),
  inviteLookup: route({ method: 'get', path: '/invites/lookup', summary: 'Inspect an invite token before accepting', tag: 'team', owner: 'backend-core', phase: 1, auth: 'public', permission: null, query: z.object({ token: z.string() }), response: z.object({ workspaceName: z.string(), email: z.string().nullable(), roleName: z.string() }) }),
  inviteAccept: route({ method: 'post', path: '/auth/invite/accept', summary: 'Accept an invite and create the account', tag: 'auth', owner: 'backend-core', phase: 1, auth: 'public', permission: null, body: InviteAcceptSchema, response: AuthSessionSchema }),

  // ---------------- workspace, users, settings (phase 1) ----------------
  workspaceGet: route({ method: 'get', path: '/workspace', summary: 'Workspace profile', tag: 'workspace', owner: 'backend-core', phase: 1, auth: 'jwt', permission: null, response: WorkspaceSchema }),
  workspaceUpdate: route({ method: 'patch', path: '/workspace', summary: 'Update workspace profile, hours, branding', tag: 'workspace', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'settings.manage', body: WorkspaceUpdateSchema, response: WorkspaceSchema }),
  workspaceTheme: route({ method: 'put', path: '/workspace/theme', summary: 'Set the workspace default theme (automation hook)', tag: 'workspace', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'settings.manage', body: z.object({ mode: ThemeModeSchema }), response: WorkspaceSchema }),
  userList: route({ method: 'get', path: '/users', summary: 'Team members', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'team.read', query: z.object({ q: z.string().optional(), teamId: IdSchema.optional(), includeInactive: z.stringbool().optional() }), response: listOf(UserSchema) }),
  userUpdate: route({ method: 'patch', path: '/users/{id}', summary: 'Update a member (role, team, active)', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'team.manage', params: IdParamSchema, body: UserUpdateSchema, response: UserSchema }),
  userOptions: route({ method: 'get', path: '/users/options', summary: 'Assignable users for pickers (owner dropdown, reassign); respects data scope', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'leads.read', query: z.object({ q: z.string().optional() }), response: listOf(UserSummarySchema) }),
  myToday: route({ method: 'get', path: '/me/today', summary: 'Employee Home: tasks due, follow-ups, calls to make, new leads, targets, today stats (own scope)', tag: 'settings', owner: 'backend-core', phase: 2, auth: 'jwt', permission: null, response: MyTodaySchema }),
  teamList: route({ method: 'get', path: '/teams', summary: 'Teams', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'team.read', response: listOf(TeamSchema) }),
  teamCreate: route({ method: 'post', path: '/teams', summary: 'Create a team', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'team.manage', body: z.object({ name: z.string().min(1).max(60), managerId: IdSchema.nullable().optional(), memberIds: z.array(IdSchema).default([]) }), response: TeamSchema, status: 201 }),
  roleList: route({ method: 'get', path: '/roles', summary: 'Roles and permission matrix', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'team.read', response: listOf(RoleSchema) }),
  roleCreate: route({ method: 'post', path: '/roles', summary: 'Create a custom role from the permission matrix', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'roles.manage', body: RoleCreateSchema, response: RoleSchema, status: 201 }),
  roleUpdate: route({ method: 'patch', path: '/roles/{id}', summary: 'Update role permissions or data scope (audit logged)', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'roles.manage', params: IdParamSchema, body: RoleUpdateSchema, response: RoleSchema }),
  roleDelete: route({ method: 'delete', path: '/roles/{id}', summary: 'Delete a custom role (must have no members)', tag: 'team', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'roles.manage', params: IdParamSchema, response: OkResponseSchema }),
  supportAccessUpdate: route({ method: 'put', path: '/workspace/support-access', summary: 'Enable or disable Super Admin support access with expiry', tag: 'workspace', owner: 'backend-core', phase: 1, auth: 'jwt', permission: 'support_access.manage', body: SupportAccessUpdateSchema, response: WorkspaceSchema }),
  myProfileUpdate: route({ method: 'patch', path: '/me/profile', summary: 'Update my profile and avatar', tag: 'settings', owner: 'backend-core', phase: 1, auth: 'jwt', permission: null, body: ProfileUpdateSchema, response: UserSchema }),
  myStatusUpdate: route({ method: 'put', path: '/me/status', summary: 'Set my own status (available, in a meeting, on break, lunch, field visit, away, offline); on_call comes from phone state', tag: 'presence', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: null, body: StatusUpdateSchema, response: MyPresenceSchema }),
  mySettingsGet: route({ method: 'get', path: '/me/settings', summary: 'My settings (theme, floor mode, notifications)', tag: 'settings', owner: 'backend-core', phase: 1, auth: 'jwt', permission: null, response: UserSettingsSchema }),
  mySettingsUpdate: route({ method: 'patch', path: '/me/settings', summary: 'Update my settings', tag: 'settings', owner: 'backend-core', phase: 1, auth: 'jwt', permission: null, body: UserSettingsUpdateSchema, response: UserSettingsSchema }),

  // ---------------- leads (phase 2) ----------------
  leadList: route({ method: 'get', path: '/leads', summary: 'List leads with filters, search and sort', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt_or_api_key', permission: 'leads.read', query: LeadListQuerySchema, response: pageOf(LeadListItemSchema) }),
  leadCreate: route({ method: 'post', path: '/leads', summary: 'Create a lead', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt_or_api_key', permission: 'leads.create', body: LeadCreateSchema, response: LeadSchema, status: 201 }),
  leadGet: route({ method: 'get', path: '/leads/{id}', summary: 'Lead detail', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt_or_api_key', permission: 'leads.read', params: IdParamSchema, response: LeadSchema }),
  leadUpdate: route({ method: 'patch', path: '/leads/{id}', summary: 'Update a lead (changing ownerId also requires leads.assign)', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt_or_api_key', permission: 'leads.update', params: IdParamSchema, body: LeadUpdateSchema, response: LeadSchema }),
  leadDelete: route({ method: 'delete', path: '/leads/{id}', summary: 'Delete a lead (soft delete)', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.delete', params: IdParamSchema, response: OkResponseSchema }),
  leadBulk: route({ method: 'post', path: '/leads/bulk', summary: 'Bulk assign, stage, tag, delete or WhatsApp template', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.bulk', body: LeadBulkActionSchema, response: BulkResultSchema }),
  leadImportPreview: route({ method: 'post', path: '/leads/import', summary: 'Upload CSV/XLSX (field "file") and get a mapping preview', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.import', bodyContentType: 'multipart/form-data', response: ImportPreviewResponseSchema, status: 201 }),
  leadImportCommit: route({ method: 'post', path: '/leads/import/{id}/commit', summary: 'Run the import with a column mapping', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.import', params: IdParamSchema, body: ImportCommitRequestSchema, response: ImportJobSchema }),
  leadImportGet: route({ method: 'get', path: '/leads/import/{id}', summary: 'Import job status', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.import', params: IdParamSchema, response: ImportJobSchema }),
  leadExport: route({ method: 'get', path: '/leads/export', summary: 'Export leads matching filters', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.export', query: LeadListQuerySchema.omit({ cursor: true, limit: true }).extend({ format: z.enum(['csv', 'xlsx']).default('csv') }), response: null, responseContentType: 'text/csv' }),
  leadDuplicates: route({ method: 'get', path: '/leads/{id}/duplicates', summary: 'Possible duplicates (phone, email, name+company)', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.read', params: IdParamSchema, response: listOf(LeadListItemSchema) }),
  leadMerge: route({ method: 'post', path: '/leads/merge', summary: 'Merge duplicates into a primary lead (duplicates are soft-deleted)', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.merge', body: LeadMergeSchema, response: LeadSchema }),
  leadTimeline: route({ method: 'get', path: '/leads/{id}/timeline', summary: 'Unified timeline', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.read', params: IdParamSchema, query: CursorPaginationQuerySchema, response: pageOf(ActivitySchema) }),
  leadNoteCreate: route({ method: 'post', path: '/leads/{id}/notes', summary: 'Add a note', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.update', params: IdParamSchema, body: NoteCreateSchema, response: ActivitySchema, status: 201 }),
  viewList: route({ method: 'get', path: '/views', summary: 'Saved views', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.read', response: listOf(SavedViewSchema) }),
  viewCreate: route({ method: 'post', path: '/views', summary: 'Create a saved view', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.read', body: SavedViewCreateSchema, response: SavedViewSchema, status: 201 }),
  viewDelete: route({ method: 'delete', path: '/views/{id}', summary: 'Delete a saved view', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.read', params: IdParamSchema, response: OkResponseSchema }),
  tagList: route({ method: 'get', path: '/tags', summary: 'Tags with usage counts', tag: 'leads', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'leads.read', response: listOf(TagSchema) }),

  // ---------------- flexible data layer: fields, objects, records, labels (phase 2) ----------------
  fieldList: route({ method: 'get', path: '/fields', summary: 'Field definitions (custom fields on core entities and object fields); fields hidden for the caller role are omitted', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: null, query: FieldListQuerySchema, response: listOf(FieldDefinitionSchema) }),
  fieldCreate: route({ method: 'post', path: '/fields', summary: 'Add a field to a core entity or custom object', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', body: FieldDefinitionCreateSchema, response: FieldDefinitionSchema, status: 201 }),
  fieldUpdate: route({ method: 'patch', path: '/fields/{id}', summary: 'Edit label, help, required, unique, access or config (key, type and target are fixed)', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', params: IdParamSchema, body: FieldDefinitionUpdateSchema, response: FieldDefinitionSchema }),
  fieldArchive: route({ method: 'post', path: '/fields/{id}/archive', summary: 'Archive a field (values are kept; the key is never reused)', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', params: IdParamSchema, response: FieldDefinitionSchema }),
  fieldRestore: route({ method: 'post', path: '/fields/{id}/restore', summary: 'Restore an archived field', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', params: IdParamSchema, response: FieldDefinitionSchema }),
  fieldReorder: route({ method: 'put', path: '/fields/order', summary: 'Reorder the fields of one target', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', body: FieldReorderSchema, response: listOf(FieldDefinitionSchema) }),
  objectList: route({ method: 'get', path: '/objects', summary: 'Custom objects with their fields', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'records.read', query: z.object({ includeArchived: z.stringbool().optional() }), response: listOf(CustomObjectSchema) }),
  objectGet: route({ method: 'get', path: '/objects/{key}', summary: 'One custom object', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'records.read', params: ObjectKeyParamSchema, response: CustomObjectSchema }),
  objectCreate: route({ method: 'post', path: '/objects', summary: 'Create a custom object with its fields', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', body: CustomObjectCreateSchema, response: CustomObjectSchema, status: 201 }),
  objectUpdate: route({ method: 'patch', path: '/objects/{key}', summary: 'Rename, change icon, title field or navigation', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', params: ObjectKeyParamSchema, body: CustomObjectUpdateSchema, response: CustomObjectSchema }),
  objectArchive: route({ method: 'post', path: '/objects/{key}/archive', summary: 'Archive an object (records are kept)', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', params: ObjectKeyParamSchema, response: CustomObjectSchema }),
  objectRestore: route({ method: 'post', path: '/objects/{key}/restore', summary: 'Restore an archived object', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', params: ObjectKeyParamSchema, response: CustomObjectSchema }),
  recordList: route({ method: 'get', path: '/objects/{key}/records', summary: 'Records of a custom object (data scope applies via ownerId)', tag: 'records', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'records.read', params: ObjectKeyParamSchema, query: CustomRecordListQuerySchema, response: pageOf(CustomRecordSchema) }),
  recordCreate: route({ method: 'post', path: '/objects/{key}/records', summary: 'Create a record (values validated against the object fields)', tag: 'records', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'records.create', params: ObjectKeyParamSchema, body: CustomRecordCreateSchema, response: CustomRecordSchema, status: 201 }),
  recordGet: route({ method: 'get', path: '/objects/{key}/records/{id}', summary: 'One record', tag: 'records', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'records.read', params: RecordParamSchema, response: CustomRecordSchema }),
  recordUpdate: route({ method: 'patch', path: '/objects/{key}/records/{id}', summary: 'Patch record values or owner (optimistic version check)', tag: 'records', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'records.update', params: RecordParamSchema, body: CustomRecordUpdateSchema, response: CustomRecordSchema }),
  recordDelete: route({ method: 'delete', path: '/objects/{key}/records/{id}', summary: 'Delete a record (soft delete)', tag: 'records', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'records.delete', params: RecordParamSchema, response: OkResponseSchema }),
  labelsGet: route({ method: 'get', path: '/labels', summary: 'Display labels (defaults + workspace overrides)', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: null, response: LabelsResponseSchema }),
  labelsUpdate: route({ method: 'put', path: '/labels', summary: 'Replace label overrides (display text only)', tag: 'customization', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', body: LabelsUpdateSchema, response: LabelsResponseSchema }),

  // ---------------- Industry Packs: company admin (phase 2) ----------------
  packList: route({ method: 'get', path: '/packs', summary: 'Packs available to the workspace (Settings > Industry)', tag: 'packs', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', response: listOf(PackListItemSchema) }),
  packRuntime: route({ method: 'get', path: '/packs/runtime', summary: 'Active pack extensions: labels, navigation, widgets, reports, import mappings, objects', tag: 'packs', owner: 'backend-core', phase: 2, auth: 'jwt', permission: null, response: PackRuntimeSchema }),
  packPlan: route({ method: 'get', path: '/packs/{key}/plan', summary: 'Dry run of install, upgrade or uninstall (nothing is written)', tag: 'packs', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', params: PackKeyParamSchema, query: PackPlanQuerySchema, response: PackPlanResponseSchema }),
  packInstall: route({ method: 'post', path: '/packs/{key}/install', summary: 'Install, reinstall or change modes (idempotent; entitlement required)', tag: 'packs', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', params: PackKeyParamSchema, body: PackInstallRequestSchema, response: PackInstallResultSchema }),
  packUpgrade: route({ method: 'post', path: '/packs/{key}/upgrade', summary: 'Upgrade to the latest version (admin edits are kept)', tag: 'packs', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', params: PackKeyParamSchema, response: PackInstallResultSchema }),
  packUninstall: route({ method: 'post', path: '/packs/{key}/uninstall', summary: 'Uninstall: archives what the pack added, keeps all user data (core packs cannot be uninstalled)', tag: 'packs', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', params: PackKeyParamSchema, response: PackInstallResultSchema }),
  packLog: route({ method: 'get', path: '/packs/{key}/log', summary: 'Install history of a pack in this workspace', tag: 'packs', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'settings.manage', params: PackKeyParamSchema, response: listOf(PackInstallLogSchema) }),

  // ---------------- tasks (phase 2) ----------------
  taskList: route({ method: 'get', path: '/tasks', summary: 'My or team tasks', tag: 'tasks', owner: 'backend-core', phase: 2, auth: 'jwt_or_api_key', permission: 'tasks.read', query: TaskListQuerySchema, response: pageOf(TaskSchema) }),
  taskCreate: route({ method: 'post', path: '/tasks', summary: 'Create a task', tag: 'tasks', owner: 'backend-core', phase: 2, auth: 'jwt_or_api_key', permission: 'tasks.create', body: TaskCreateSchema, response: TaskSchema, status: 201 }),
  taskUpdate: route({ method: 'patch', path: '/tasks/{id}', summary: 'Update or complete a task', tag: 'tasks', owner: 'backend-core', phase: 2, auth: 'jwt_or_api_key', permission: 'tasks.update', params: IdParamSchema, body: TaskUpdateSchema, response: TaskSchema }),
  taskSnooze: route({ method: 'post', path: '/tasks/{id}/snooze', summary: 'Snooze a task', tag: 'tasks', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'tasks.update', params: IdParamSchema, body: TaskSnoozeSchema, response: TaskSchema }),
  taskDelete: route({ method: 'delete', path: '/tasks/{id}', summary: 'Delete a task', tag: 'tasks', owner: 'backend-core', phase: 2, auth: 'jwt', permission: 'tasks.delete', params: IdParamSchema, response: OkResponseSchema }),

  // ---------------- notifications (phase 2) ----------------
  notificationList: route({ method: 'get', path: '/notifications', summary: 'Notification centre', tag: 'notifications', owner: 'backend-core', phase: 2, auth: 'jwt', permission: null, query: NotificationListQuerySchema, response: pageOf(NotificationSchema).extend({ unreadCount: z.number().int() }) }),
  notificationRead: route({ method: 'post', path: '/notifications/read', summary: 'Mark notifications read', tag: 'notifications', owner: 'backend-core', phase: 2, auth: 'jwt', permission: null, body: NotificationMarkReadSchema, response: OkResponseSchema }),
  pushSubscribe: route({ method: 'post', path: '/notifications/push-subscriptions', summary: 'Register a web push subscription', tag: 'notifications', owner: 'backend-core', phase: 2, auth: 'jwt', permission: null, body: PushSubscriptionSchema, response: OkResponseSchema }),

  // ---------------- pipeline (phase 3) ----------------
  pipelineList: route({ method: 'get', path: '/pipelines', summary: 'Pipelines with stages; ?entity=deal lists deal pipelines (the default deal pipeline is created on first use)', tag: 'pipeline', owner: 'backend-core', phase: 3, auth: 'jwt', permission: 'leads.read', query: PipelineListQuerySchema, response: listOf(PipelineSchema) }),
  pipelineBoard: route({ method: 'get', path: '/pipelines/{id}/board', summary: 'Kanban board (first page per column); accepts the same filters as the lead list', tag: 'pipeline', owner: 'backend-core', phase: 3, auth: 'jwt', permission: 'leads.read', params: IdParamSchema, query: LeadFiltersSchema.extend({ perColumn: z.coerce.number().int().min(1).max(200).default(50) }), response: BoardSchema }),
  boardColumnPage: route({ method: 'get', path: '/pipelines/{id}/board/columns/{stageId}', summary: 'Next page of one board column', tag: 'pipeline', owner: 'backend-core', phase: 3, auth: 'jwt', permission: 'leads.read', params: z.object({ id: IdSchema, stageId: IdSchema }), query: LeadFiltersSchema.extend({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), response: pageOf(LeadListItemSchema) }),
  stageCreate: route({ method: 'post', path: '/pipelines/{id}/stages', summary: 'Add a stage', tag: 'pipeline', owner: 'backend-core', phase: 3, auth: 'jwt', permission: 'pipeline.manage', params: IdParamSchema, body: StageCreateSchema, response: StageSchema, status: 201 }),
  stageReorder: route({ method: 'put', path: '/pipelines/{id}/stages/order', summary: 'Reorder stages', tag: 'pipeline', owner: 'backend-core', phase: 3, auth: 'jwt', permission: 'pipeline.manage', params: IdParamSchema, body: StageReorderSchema, response: PipelineSchema }),
  stageUpdate: route({ method: 'patch', path: '/stages/{id}', summary: 'Rename or recolour a stage', tag: 'pipeline', owner: 'backend-core', phase: 3, auth: 'jwt', permission: 'pipeline.manage', params: IdParamSchema, body: StageUpdateSchema, response: StageSchema }),
  stageDelete: route({ method: 'delete', path: '/stages/{id}', summary: 'Delete an empty stage', tag: 'pipeline', owner: 'backend-core', phase: 3, auth: 'jwt', permission: 'pipeline.manage', params: IdParamSchema, response: OkResponseSchema }),
  leadMove: route({ method: 'post', path: '/leads/{id}/move', summary: 'Move a lead to a stage/position (kanban drop)', tag: 'pipeline', owner: 'backend-core', phase: 3, auth: 'jwt', permission: 'leads.update', params: IdParamSchema, body: LeadMoveSchema, response: LeadListItemSchema }),

  // ---------------- dashboard & team floor (phase 4) ----------------
  dashboardSummary: route({ method: 'get', path: '/dashboard/summary', summary: 'KPIs, funnel, sources, leaderboard, feed, attention', tag: 'dashboard', owner: 'backend-core', phase: 4, auth: 'jwt', permission: 'dashboard.read', query: DashboardQuerySchema, response: DashboardSummarySchema }),
  attentionResolve: route({ method: 'post', path: '/attention/{id}/resolve', summary: 'Resolve or dismiss a "Needs attention" item (emits attention.resolved); scope applies', tag: 'dashboard', owner: 'backend-core', phase: 4, auth: 'jwt', permission: 'team.read', params: z.object({ id: z.string().min(1).max(120).describe('AttentionItem.id, e.g. task_overdue:<taskId>') }), response: OkResponseSchema }),
  userMessage: route({ method: 'post', path: '/users/{id}/messages', summary: 'Send a short in-app message to a team member (notification.created); managers only to their team', tag: 'team', owner: 'backend-core', phase: 4, auth: 'jwt', permission: 'team.read', params: IdParamSchema, body: z.object({ body: z.string().trim().min(1).max(1000), leadId: IdSchema.optional() }), response: OkResponseSchema, status: 201 }),
  teamFloorSnapshot: route({ method: 'get', path: '/team-floor/snapshot', summary: 'Live Team Floor initial state (server-authoritative presence, seats, floor ref)', tag: 'team-floor', owner: 'realtime-integrations', phase: 4, auth: 'jwt', permission: 'teamfloor.read', query: z.object({ teamId: IdSchema.optional() }), response: TeamFloorSnapshotSchema }),

  // ---------------- integrations & webhooks (phase 5) ----------------
  integrationList: route({ method: 'get', path: '/integrations', summary: 'Integration hub: all five providers with status, mode, last check, last sync, attention and masked secret hints (never-connected providers have id null, status not_connected); endpoints only for integrations.manage (and never in the integration.updated event)', tag: 'integrations', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'integrations.read', response: listOf(IntegrationSchema) }),
  integrationConnect: route({ method: 'post', path: '/integrations/{provider}/connect', summary: 'Connect or update an integration (config validated per provider; secrets write-only, omitted secrets are kept; mock mode only outside production; runs the test unless test=false); audited', tag: 'integrations', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'integrations.manage', params: IntegrationProviderParamSchema, body: IntegrationConnectSchema, response: IntegrationSchema }),
  integrationTest: route({ method: 'post', path: '/integrations/{provider}/test', summary: 'Test the connection (SMTP sends a test e-mail to `to` or the caller); status follows the result', tag: 'integrations', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'integrations.manage', params: IntegrationProviderParamSchema, body: IntegrationTestRequestSchema, response: IntegrationTestResultSchema }),
  integrationDisconnect: route({ method: 'delete', path: '/integrations/{provider}', summary: 'Disconnect and wipe secrets and generated tokens (status not_connected); audited', tag: 'integrations', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'integrations.manage', params: IntegrationProviderParamSchema, response: IntegrationSchema }),
  webhookEndpointList: route({ method: 'get', path: '/webhooks/endpoints', summary: 'Inbound and outbound endpoints (filter by direction)', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.read', query: WebhookEndpointListQuerySchema, response: listOf(WebhookEndpointSchema) }),
  webhookInboundCreate: route({ method: 'post', path: '/webhooks/endpoints/inbound', summary: 'Create an inbound source URL (secret returned once); audited', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', body: InboundEndpointCreateSchema, response: WebhookEndpointSchema.extend(WebhookSecretSchema.shape), status: 201 }),
  webhookOutboundCreate: route({ method: 'post', path: '/webhooks/endpoints/outbound', summary: 'Subscribe a URL to events (secret returned once; private, loopback and link-local targets answer 422 WEBHOOK_URL_BLOCKED); audited', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', body: OutboundEndpointCreateSchema, response: WebhookEndpointSchema.extend(WebhookSecretSchema.shape), status: 201 }),
  webhookEndpointUpdate: route({ method: 'patch', path: '/webhooks/endpoints/{id}', summary: 'Update an endpoint (isActive true also clears an auto-disable and resets the failure counters)', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', params: IdParamSchema, body: WebhookEndpointUpdateSchema, response: WebhookEndpointSchema }),
  webhookEndpointDelete: route({ method: 'delete', path: '/webhooks/endpoints/{id}', summary: 'Delete an endpoint (soft; the inbound URL answers 404, pending outbound deliveries stop); audited', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', params: IdParamSchema, response: OkResponseSchema }),
  webhookRotateSecret: route({ method: 'post', path: '/webhooks/endpoints/{id}/rotate-secret', summary: 'Rotate the signing secret (returned once); the previous one stays valid for graceHours; audited', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', params: IdParamSchema, body: WebhookRotateSecretSchema, response: WebhookSecretRotatedSchema }),
  webhookMappingPreview: route({ method: 'post', path: '/webhooks/mapping/preview', summary: 'Preview a mapping on a sample payload (same engine as ingestion: applyPayloadMapping) and list its paths', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', body: MappingPreviewRequestSchema, response: MappingPreviewResponseSchema }),
  webhookDeliveryList: route({ method: 'get', path: '/webhooks/deliveries', summary: 'Delivery log, newest first (filters: endpoint, status, direction, event, from, to)', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.read', query: WebhookDeliveryQuerySchema, response: pageOf(WebhookDeliverySchema) }),
  webhookDeliveryGet: route({ method: 'get', path: '/webhooks/deliveries/{id}', summary: 'Delivery detail with request, response, latency and the attempt timeline', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.read', params: IdParamSchema, response: WebhookDeliverySchema }),
  webhookDeliveryReplay: route({ method: 'post', path: '/webhooks/deliveries/{id}/replay', summary: 'Replay a delivery as a new delivery (replayOfId set): outbound re-sends the same body with a fresh signature, inbound re-processes the stored body (not for unverified requests: 422 WEBHOOK_REPLAY_NOT_ALLOWED)', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', params: IdParamSchema, response: WebhookDeliverySchema, status: 201 }),
  inboundWebhook: route({ method: 'post', path: '/api/hooks/{workspaceId}/{sourceKey}', absolute: true, summary: 'Inbound webhook: X-Vistar-Signature (t=<unix>,v1=<hex HMAC-SHA256 of "t.rawBody">, 300 s tolerance) or X-Vistar-Token for token sources; Idempotency-Key (24 h: same key and body = 200 duplicate, same key and other body = 409); 401 WEBHOOK_SIGNATURE_INVALID / WEBHOOK_TIMESTAMP_EXPIRED, 404 unknown source, 410 paused source', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'webhook', permission: null, params: z.object({ workspaceId: IdSchema, sourceKey: z.string() }), query: z.object({ token: z.string().max(200).optional() }), body: z.unknown(), response: InboundWebhookResponseSchema, status: 202 }),
  whatsappWebhookVerify: route({ method: 'get', path: '/api/hooks/whatsapp', absolute: true, summary: 'WhatsApp Cloud API verification challenge for the platform Meta app (WHATSAPP_VERIFY_TOKEN); answers hub.challenge as text/plain', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'public', permission: null, query: WhatsappVerifyQuerySchema, response: null, responseContentType: 'text/plain' }),
  whatsappWebhook: route({ method: 'post', path: '/api/hooks/whatsapp', absolute: true, summary: 'WhatsApp Cloud API events for the platform Meta app (X-Hub-Signature-256 with WHATSAPP_APP_SECRET); routed to the workspace by metadata.phone_number_id', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'webhook', permission: null, body: z.unknown(), response: null }),
  apiKeyList: route({ method: 'get', path: '/api-keys', summary: 'API keys (needs the api_access plan feature for create)', tag: 'api-keys', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'apikeys.manage', response: listOf(ApiKeySchema) }),
  apiKeyCreate: route({ method: 'post', path: '/api-keys', summary: 'Create an API key (shown once; scopes must be permissions the creator holds: 403 API_KEY_SCOPE_NOT_ALLOWED; FEATURE_DISABLED without api_access); audited', tag: 'api-keys', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'apikeys.manage', body: ApiKeyCreateSchema, response: ApiKeyCreatedSchema, status: 201 }),
  apiKeyRotate: route({ method: 'post', path: '/api-keys/{id}/rotate', summary: 'Rotate an API key (new key shown once; the old key keeps working for graceMinutes); audited', tag: 'api-keys', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'apikeys.manage', params: IdParamSchema, body: ApiKeyRotateSchema, response: ApiKeyCreatedSchema }),
  apiKeyRevoke: route({ method: 'delete', path: '/api-keys/{id}', summary: 'Revoke an API key (also ends a rotation grace); audited', tag: 'api-keys', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'apikeys.manage', params: IdParamSchema, response: OkResponseSchema }),

  // ---- change #19 wave C: hub (HUB-API stream, backend-core; D-069, D-070)
  integrationCatalog: route({ method: 'get', path: '/integrations/catalog', summary: 'Provider catalog: connect fields (secret fields marked), setup steps, capabilities, availability (not_configured when a platform setting is missing) and plan feature', tag: 'integrations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'integrations.read', response: listOf(IntegrationProviderInfoSchema) }),
  integrationGet: route({ method: 'get', path: '/integrations/{provider}', summary: 'One provider of the hub', tag: 'integrations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'integrations.read', params: IntegrationProviderParamSchema, response: IntegrationSchema }),
  integrationSync: route({ method: 'post', path: '/integrations/{provider}/sync', summary: 'Sync now: IndiaMART pull (window from the last pull minus 5 min, max 7 days; dedupe by UNIQUE_QUERY_ID; 429 RATE_LIMITED within 5 min of the last pull), WhatsApp phone number profile, Google calendar check', tag: 'integrations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'integrations.manage', params: IntegrationProviderParamSchema, response: IntegrationSyncResultSchema }),
  integrationRotateToken: route({ method: 'post', path: '/integrations/{provider}/rotate-token', summary: 'New IndiaMART push key, WhatsApp verify token or telephony callback token (the old one stops working); audited', tag: 'integrations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'integrations.manage', params: IntegrationProviderParamSchema, response: IntegrationSchema }),
  integrationOAuthStart: route({ method: 'post', path: '/integrations/{provider}/oauth/start', summary: 'Start Google sign-in for google_calendar (422 INTEGRATION_NOT_CONFIGURED without GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET); open authUrl in the browser', tag: 'integrations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'integrations.manage', params: IntegrationProviderParamSchema, response: IntegrationOAuthStartSchema }),
  integrationOAuthCallback: route({ method: 'get', path: '/api/oauth/google/callback', absolute: true, summary: 'Google OAuth redirect: stores the tokens encrypted and redirects to WEB_ORIGIN/app/integrations?provider=google_calendar&result=connected|error', tag: 'integrations', owner: 'backend-core', phase: 19, auth: 'public', permission: null, query: OAuthCallbackQuerySchema, response: null, responseContentType: 'text/html', status: 302 }),
  indiamartPush: route({ method: 'post', path: '/api/hooks/{workspaceId}/indiamart', absolute: true, summary: 'IndiaMART Push API receiver (push key in ?key=; body { CODE, STATUS, RESPONSE: {...} }); creates a routed lead with source indiamart, duplicate UNIQUE_QUERY_ID = 200 duplicate', tag: 'webhooks', owner: 'backend-core', phase: 19, auth: 'webhook', permission: null, params: z.object({ workspaceId: IdSchema }), query: z.object({ key: z.string().max(200).optional() }), body: z.unknown(), response: IndiamartPushResultSchema }),
  whatsappWorkspaceVerify: route({ method: 'get', path: '/api/hooks/{workspaceId}/whatsapp', absolute: true, summary: 'WhatsApp Cloud API verification challenge for a workspace\'s own Meta app (verify token from the integration); 403 on a wrong token', tag: 'webhooks', owner: 'backend-core', phase: 19, auth: 'public', permission: null, params: z.object({ workspaceId: IdSchema }), query: WhatsappVerifyQuerySchema, response: null, responseContentType: 'text/plain' }),
  whatsappWorkspaceWebhook: route({ method: 'post', path: '/api/hooks/{workspaceId}/whatsapp', absolute: true, summary: 'WhatsApp Cloud API events of a workspace\'s own Meta app (X-Hub-Signature-256 with its app secret): messages into the Inbox (24 h window, message.received), statuses onto sent messages', tag: 'webhooks', owner: 'backend-core', phase: 19, auth: 'webhook', permission: null, params: z.object({ workspaceId: IdSchema }), body: z.unknown(), response: OkResponseSchema }),
  webhookEndpointGet: route({ method: 'get', path: '/webhooks/endpoints/{id}', summary: 'One endpoint with its sample payload and failure counters', tag: 'webhooks', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'webhooks.read', params: IdParamSchema, response: WebhookEndpointSchema }),
  webhookCapture: route({ method: 'post', path: '/webhooks/endpoints/{id}/capture', summary: 'Arm (or stop) sample capture on an inbound source: the next verified request before captureUntil is stored as the sample and not processed (202, captured: true); capture then stops', tag: 'webhooks', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'webhooks.manage', params: IdParamSchema, body: WebhookCaptureSchema, response: WebhookEndpointSchema }),
  webhookTestSend: route({ method: 'post', path: '/webhooks/endpoints/{id}/test', summary: 'Send one signed test delivery to an outbound endpoint now (event webhook.test or a sample of `event`; no retries)', tag: 'webhooks', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'webhooks.manage', params: IdParamSchema, body: WebhookTestSendSchema, response: WebhookDeliverySchema, status: 201 }),
  apiKeyScopes: route({ method: 'get', path: '/api-keys/scopes', summary: 'Scope picker: every API key scope with allowed = the caller holds the permission', tag: 'api-keys', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'apikeys.manage', response: listOf(ApiKeyScopeOptionSchema) }),
  apiKeyUpdate: route({ method: 'patch', path: '/api-keys/{id}', summary: 'Rename a key or change its rate limit (null = default); audited', tag: 'api-keys', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'apikeys.manage', params: IdParamSchema, body: ApiKeyUpdateSchema, response: ApiKeySchema }),
  publicOpenApi: route({ method: 'get', path: '/openapi.json', summary: 'Public API reference (OpenAPI 3.1): only the routes that accept API keys plus the inbound webhook, server = API_PUBLIC_URL', tag: 'public', owner: 'backend-core', phase: 19, auth: 'public', permission: null, response: PublicOpenApiDocumentSchema }),
  // ---- end change #19 wave C: hub

  // ---------------- WhatsApp inbox (phase 5) ----------------
  conversationList: route({ method: 'get', path: '/conversations', summary: 'Inbox conversations', tag: 'inbox', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'messages.read', query: ConversationListQuerySchema, response: pageOf(ConversationSchema) }),
  conversationGet: route({ method: 'get', path: '/conversations/{id}', summary: 'Conversation', tag: 'inbox', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'messages.read', params: IdParamSchema, response: ConversationSchema }),
  messageList: route({ method: 'get', path: '/conversations/{id}/messages', summary: 'Messages (newest first)', tag: 'inbox', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'messages.read', params: IdParamSchema, query: CursorPaginationQuerySchema, response: pageOf(MessageSchema) }),
  messageSend: route({ method: 'post', path: '/conversations/{id}/messages', summary: 'Send text/template/media or add an internal note', tag: 'inbox', owner: 'realtime-integrations', phase: 5, auth: 'jwt_or_api_key', permission: 'messages.send', params: IdParamSchema, body: MessageSendSchema, response: MessageSchema, status: 201 }),
  conversationAssign: route({ method: 'post', path: '/conversations/{id}/assign', summary: 'Assign or transfer', tag: 'inbox', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'messages.send', params: IdParamSchema, body: ConversationAssignSchema, response: ConversationSchema }),
  conversationRead: route({ method: 'post', path: '/conversations/{id}/read', summary: 'Mark as read', tag: 'inbox', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'messages.read', params: IdParamSchema, response: OkResponseSchema }),
  templateList: route({ method: 'get', path: '/templates', summary: 'Message templates', tag: 'inbox', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'templates.read', query: z.object({ channel: z.string().optional(), status: z.string().optional() }), response: listOf(TemplateSchema) }),
  templateSync: route({ method: 'post', path: '/templates/sync', summary: 'Sync templates from WhatsApp', tag: 'inbox', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'templates.manage', response: listOf(TemplateSchema) }),
  quickReplyList: route({ method: 'get', path: '/quick-replies', summary: 'Quick replies', tag: 'inbox', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'messages.read', response: listOf(QuickReplySchema) }),

  // ---------------- workflows (phase 6) ----------------
  workflowList: route({ method: 'get', path: '/workflows', summary: 'Workflows', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.read', response: listOf(WorkflowListItemSchema) }),
  workflowCreate: route({ method: 'post', path: '/workflows', summary: 'Create a workflow (blank or from template)', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.edit', body: WorkflowCreateSchema, response: WorkflowSchema, status: 201 }),
  workflowGet: route({ method: 'get', path: '/workflows/{id}', summary: 'Workflow with draft graph', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.read', params: IdParamSchema, response: WorkflowSchema }),
  workflowUpdate: route({ method: 'patch', path: '/workflows/{id}', summary: 'Save draft / rename', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.edit', params: IdParamSchema, body: WorkflowUpdateSchema, response: WorkflowSchema }),
  workflowDelete: route({ method: 'delete', path: '/workflows/{id}', summary: 'Archive a workflow', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.edit', params: IdParamSchema, response: OkResponseSchema }),
  workflowDuplicate: route({ method: 'post', path: '/workflows/{id}/duplicate', summary: 'Duplicate', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.edit', params: IdParamSchema, response: WorkflowSchema, status: 201 }),
  workflowPublish: route({ method: 'post', path: '/workflows/{id}/publish', summary: 'Validate draft and publish a new version', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.publish', params: IdParamSchema, body: WorkflowPublishSchema, response: WorkflowVersionSchema, status: 201 }),
  workflowStatus: route({ method: 'post', path: '/workflows/{id}/status', summary: 'Activate, pause or set to draft', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.publish', params: IdParamSchema, body: WorkflowStatusChangeSchema, response: WorkflowSchema }),
  workflowVersions: route({ method: 'get', path: '/workflows/{id}/versions', summary: 'Version history', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.read', params: IdParamSchema, response: listOf(WorkflowVersionSchema) }),
  workflowRollback: route({ method: 'post', path: '/workflows/{id}/rollback', summary: 'Restore a version as the draft and activate it', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.publish', params: IdParamSchema, body: WorkflowRollbackSchema, response: WorkflowSchema }),
  workflowTestRun: route({ method: 'post', path: '/workflows/{id}/test-run', summary: 'Test run with a dummy or real lead', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.edit', params: IdParamSchema, body: WorkflowTestRunSchema, response: WorkflowRunSchema, status: 201 }),
  workflowTemplates: route({ method: 'get', path: '/workflow-templates', summary: 'Shipped templates', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.read', response: listOf(WorkflowTemplateSummarySchema) }),
  workflowRunList: route({ method: 'get', path: '/workflow-runs', summary: 'Runs (per workflow or lead)', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.read', query: WorkflowRunListQuerySchema, response: pageOf(WorkflowRunSchema) }),
  workflowRunGet: route({ method: 'get', path: '/workflow-runs/{id}', summary: 'Run with step log', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.read', params: IdParamSchema, response: WorkflowRunSchema }),
  workflowRunCancel: route({ method: 'post', path: '/workflow-runs/{id}/cancel', summary: 'Cancel a run', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.edit', params: IdParamSchema, response: WorkflowRunSchema }),
  leadRunWorkflow: route({ method: 'post', path: '/leads/{id}/run-workflow', summary: 'Enrol a lead in an active workflow', tag: 'workflows', owner: 'workflow-engine', phase: 6, auth: 'jwt', permission: 'workflows.run', params: IdParamSchema, body: z.object({ workflowId: IdSchema }), response: WorkflowRunSchema, status: 201 }),

  // ---------------- calls (phase 7) ----------------
  callCreate: route({ method: 'post', path: '/calls', summary: 'Click-to-call via the telephony adapter', tag: 'calls', owner: 'realtime-integrations', phase: 7, auth: 'jwt', permission: 'calls.make', body: ClickToCallSchema, response: CallSchema, status: 201 }),
  callList: route({ method: 'get', path: '/calls', summary: 'Call log', tag: 'calls', owner: 'realtime-integrations', phase: 7, auth: 'jwt_or_api_key', permission: 'calls.read', query: CallListQuerySchema, response: pageOf(CallSchema) }),
  callGet: route({ method: 'get', path: '/calls/{id}', summary: 'Call detail', tag: 'calls', owner: 'realtime-integrations', phase: 7, auth: 'jwt', permission: 'calls.read', params: IdParamSchema, response: CallSchema }),
  callUpdate: route({ method: 'patch', path: '/calls/{id}', summary: 'Set outcome, notes, disposition', tag: 'calls', owner: 'realtime-integrations', phase: 7, auth: 'jwt', permission: 'calls.make', params: IdParamSchema, body: CallUpdateSchema, response: CallSchema }),
  callRecording: route({ method: 'get', path: '/calls/{id}/recording', summary: 'Signed recording URL and waveform', tag: 'calls', owner: 'realtime-integrations', phase: 7, auth: 'jwt', permission: 'calls.recordings', params: IdParamSchema, response: RecordingUrlSchema }),
  telephonyWebhook: route({ method: 'post', path: '/api/hooks/{workspaceId}/telephony/{provider}', absolute: true, summary: 'Telephony provider callbacks (callback token in ?token=; mock and Exotel status callbacks update or create the call by providerCallId)', tag: 'calls', owner: 'realtime-integrations', phase: 7, auth: 'webhook', permission: null, params: TelephonyProviderParamSchema, query: z.object({ token: z.string().max(200).optional() }), body: z.unknown(), response: null }),

  // ---------------- audit (phase 9) ----------------
  auditList: route({ method: 'get', path: '/audit-logs', summary: 'Audit log', tag: 'admin', owner: 'backend-core', phase: 9, auth: 'jwt', permission: 'audit.read', query: AuditLogQuerySchema, response: pageOf(AuditLogSchema) }),

  // ---------------- Super Admin auth (phase 1, backend-core) ----------------
  superLogin: route({ method: 'post', path: '/api/super/auth/login', absolute: true, summary: 'Super Admin password step (returns a 2FA challenge)', tag: 'super-auth', owner: 'backend-core', phase: 1, auth: 'super_public', permission: null, body: SuperLoginRequestSchema, response: SuperLoginChallengeSchema }),
  superVerify: route({ method: 'post', path: '/api/super/auth/verify', absolute: true, summary: 'Verify TOTP (or confirm enrolment) and start a platform session', tag: 'super-auth', owner: 'backend-core', phase: 1, auth: 'super_public', permission: null, body: SuperVerifyRequestSchema, response: SuperSessionSchema }),
  superRefresh: route({ method: 'post', path: '/api/super/auth/refresh', absolute: true, summary: 'Rotate platform refresh cookie (idle/absolute timeouts apply)', tag: 'super-auth', owner: 'backend-core', phase: 1, auth: 'super_public', permission: null, response: SuperSessionSchema }),
  superLogout: route({ method: 'post', path: '/api/super/auth/logout', absolute: true, summary: 'End the platform session', tag: 'super-auth', owner: 'backend-core', phase: 1, auth: 'super', permission: null, response: OkResponseSchema }),
  superMe: route({ method: 'get', path: '/api/super/me', absolute: true, summary: 'Current Super Admin', tag: 'super-auth', owner: 'backend-core', phase: 1, auth: 'super', permission: null, response: PlatformAdminSchema }),

  // ---------------- Super Admin panel (phase 9, superadmin-panel) ----------------
  superOverview: route({ method: 'get', path: '/api/super/overview', absolute: true, summary: 'Platform KPIs and health summary', tag: 'super', owner: 'superadmin-panel', phase: 9, auth: 'super', permission: 'platform.overview.read', response: PlatformOverviewSchema }),
  superCompanyList: route({ method: 'get', path: '/api/super/companies', absolute: true, summary: 'Companies', tag: 'super', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.read', query: CompanyListQuerySchema, response: pageOf(CompanySchema) }),
  superCompanyGet: route({ method: 'get', path: '/api/super/companies/{id}', absolute: true, summary: 'Company detail (effective flags, custom domain, floor progress)', tag: 'super', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.read', params: IdParamSchema, response: CompanySchema }),
  superCompanyCreate: route({ method: 'post', path: '/api/super/companies', absolute: true, summary: 'Create a company and invite its admin (the invite link is returned once)', tag: 'super', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.manage', body: CompanyCreateSchema, response: CompanyCreatedSchema, status: 201 }),
  superCompanyUpdate: route({ method: 'patch', path: '/api/super/companies/{id}', absolute: true, summary: 'Edit company or change plan (audit logged)', tag: 'super', owner: 'superadmin-panel', phase: 9, auth: 'super', permission: 'platform.companies.manage', params: IdParamSchema, body: CompanyUpdateSchema, response: CompanySchema }),
  superCompanyStatus: route({ method: 'post', path: '/api/super/companies/{id}/status', absolute: true, summary: 'Suspend or reactivate (reason required)', tag: 'super', owner: 'superadmin-panel', phase: 9, auth: 'super', permission: 'platform.companies.manage', params: IdParamSchema, body: CompanyStatusChangeSchema, response: CompanySchema }),
  superCompanyDelete: route({ method: 'delete', path: '/api/super/companies/{id}', absolute: true, summary: 'Schedule company deletion (data export first)', tag: 'super', owner: 'superadmin-panel', phase: 9, auth: 'super', permission: 'platform.companies.manage', params: IdParamSchema, response: OkResponseSchema }),
  superCompanyFlags: route({ method: 'put', path: '/api/super/companies/{id}/flags', absolute: true, summary: 'Per-company feature flag overrides and switches (custom_domain, field_tracking); audit logged', tag: 'super', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.flags.manage', params: IdParamSchema, body: CompanyFlagsUpdateSchema, response: CompanySchema }),
  superPlanList: route({ method: 'get', path: '/api/super/plans', absolute: true, summary: 'Plan catalogue and limits', tag: 'super', owner: 'superadmin-panel', phase: 9, auth: 'super', permission: 'platform.plans.manage', response: listOf(PlanDefinitionSchema) }),
  superPlanUpdate: route({ method: 'put', path: '/api/super/plans/{key}', absolute: true, summary: 'Update plan limits, features, price', tag: 'super', owner: 'superadmin-panel', phase: 9, auth: 'super', permission: 'platform.plans.manage', params: z.object({ key: z.string() }), body: PlanDefinitionSchema.omit({ key: true }), response: PlanDefinitionSchema }),
  superImpersonateStart: route({ method: 'post', path: '/api/super/impersonations', absolute: true, summary: 'Start time-limited "View as company" (reason required, audit logged in both logs)', tag: 'super', owner: 'superadmin-panel', phase: 9, auth: 'super', permission: 'platform.support.impersonate', body: ImpersonationStartSchema, response: ImpersonationSessionSchema, status: 201 }),
  superImpersonateEnd: route({ method: 'post', path: '/api/super/impersonations/{id}/end', absolute: true, summary: 'End impersonation', tag: 'super', owner: 'superadmin-panel', phase: 9, auth: 'super', permission: 'platform.support.impersonate', params: IdParamSchema, response: ImpersonationSessionSchema }),
  superAuditList: route({ method: 'get', path: '/api/super/audit-logs', absolute: true, summary: 'Platform audit log', tag: 'super', owner: 'superadmin-panel', phase: 9, auth: 'super', permission: 'platform.audit.read', query: CursorPaginationQuerySchema.extend({ workspaceId: IdSchema.optional(), action: z.string().optional() }), response: pageOf(PlatformAuditLogSchema) }),

  // ---------------- Super Admin: Industry Pack registry (phase 2, backend-core; panel UI by frontend-app) ----------------
  superPackList: route({ method: 'get', path: '/api/super/packs', absolute: true, summary: 'Pack registry: packs, versions, plans, installs', tag: 'super-packs', owner: 'backend-core', phase: 2, auth: 'super', permission: 'platform.packs.manage', response: listOf(SuperPackSchema) }),
  superPackVersion: route({ method: 'get', path: '/api/super/packs/{key}/versions/{version}', absolute: true, summary: 'Preview one manifest version', tag: 'super-packs', owner: 'backend-core', phase: 2, auth: 'super', permission: 'platform.packs.manage', params: PackVersionParamSchema, response: SuperPackVersionSchema }),
  superPackPlans: route({ method: 'put', path: '/api/super/packs/{key}/plans', absolute: true, summary: 'Plans that include the pack, and its add-on price (audit logged)', tag: 'super-packs', owner: 'backend-core', phase: 2, auth: 'super', permission: 'platform.packs.manage', params: PackKeyParamSchema, body: SuperPackPlansUpdateSchema, response: SuperPackSchema }),
  superPackCompany: route({ method: 'put', path: '/api/super/packs/{key}/companies/{workspaceId}', absolute: true, summary: 'Grant or revoke the pack for one company (reason required, audit logged)', tag: 'super-packs', owner: 'backend-core', phase: 2, auth: 'super', permission: 'platform.packs.manage', params: PackCompanyParamSchema, body: SuperPackCompanyUpdateSchema, response: PackCompanyUsageSchema }),
  superPackUsage: route({ method: 'get', path: '/api/super/packs/{key}/usage', absolute: true, summary: 'Usage per company (entitlement, status, version, records)', tag: 'super-packs', owner: 'backend-core', phase: 2, auth: 'super', permission: 'platform.packs.manage', params: PackKeyParamSchema, response: PackUsageSchema }),

  // ================= change #19 (SPEC 29). phase 19 = this change; owner backend-core = PLATFORM stream, realtime-integrations = REALTIME stream =================

  // ---------------- storage (D-065) ----------------
  fileUpload: route({ method: 'post', path: '/files', summary: 'Upload a branding file or floor reference image (multipart: file + purpose); limits per purpose in UPLOAD_LIMITS', tag: 'files', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'settings.manage', bodyContentType: 'multipart/form-data', bodyFields: FileUploadFieldsSchema, response: StoredFileSchema, status: 201 }),
  fileGet: route({ method: 'get', path: '/files/{id}', summary: 'File metadata (tenant-scoped; branding files for everyone, reference images and floor models for settings.manage)', tag: 'files', owner: 'backend-core', phase: 19, auth: 'jwt', permission: null, params: IdParamSchema, response: StoredFileSchema }),
  fileUrl: route({ method: 'get', path: '/files/{id}/url', summary: 'Short-lived signed download URL (15 min); same read rules as fileGet; recordings use callRecording', tag: 'files', owner: 'backend-core', phase: 19, auth: 'jwt', permission: null, params: IdParamSchema, response: FileUrlSchema }),
  fileSignedDownload: route({ method: 'get', path: '/api/files/d/{token}', absolute: true, summary: 'Download through a signed URL (token from fileUrl / superFileUrl / layout responses)', tag: 'files', owner: 'backend-core', phase: 19, auth: 'public', permission: null, params: SignedFileTokenParamSchema, response: null, responseContentType: 'application/octet-stream' }),
  filePublicDownload: route({ method: 'get', path: '/api/files/p/{id}', absolute: true, summary: 'Public branding file (logo, favicon, login image); 404 for private files', tag: 'files', owner: 'backend-core', phase: 19, auth: 'public', permission: null, params: IdParamSchema, response: null, responseContentType: 'application/octet-stream' }),
  superFileUrl: route({ method: 'get', path: '/api/super/files/{id}/url', absolute: true, summary: 'Signed URL for any company or platform file (reference images, floor models, APKs)', tag: 'super-files', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.read', params: IdParamSchema, response: FileUrlSchema }),

  // ---------------- branding, component style, public workspace (D-059, D-060) ----------------
  brandingGet: route({ method: 'get', path: '/workspace/branding', summary: 'Company branding (also on Workspace.branding)', tag: 'workspace', owner: 'backend-core', phase: 19, auth: 'jwt', permission: null, response: WorkspaceBrandingSchema }),
  brandingUpdate: route({ method: 'patch', path: '/workspace/branding', summary: 'Update branding (file ids from POST /files; colours are contrast-guarded); audited, emits workspace.branding_changed. Component style: PATCH /workspace componentStyle', tag: 'workspace', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'settings.manage', body: BrandingUpdateSchema, response: WorkspaceSchema }),
  publicWorkspaceBranding: route({ method: 'get', path: '/public/workspaces/{slug}/branding', summary: 'Login page branding by workspace slug (no auth)', tag: 'public', owner: 'backend-core', phase: 19, auth: 'public', permission: null, params: SlugParamSchema, response: PublicWorkspaceSchema }),
  publicResolveHost: route({ method: 'get', path: '/public/resolve-host', summary: 'Resolve a Host to a workspace (verified custom domain, or <slug>.localhost in development) for the login page and Next middleware; 404 when unknown', tag: 'public', owner: 'backend-core', phase: 19, auth: 'public', permission: null, query: HostResolveQuerySchema, response: HostResolutionSchema }),

  // ---------------- custom domain (D-060; needs the custom_domain switch) ----------------
  domainGet: route({ method: 'get', path: '/workspace/domain', summary: 'Custom domain state and DNS instructions (CNAME + TXT)', tag: 'workspace', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'settings.manage', response: CustomDomainStateSchema }),
  domainSet: route({ method: 'put', path: '/workspace/domain', summary: 'Set or replace the custom domain (status pending, new TXT token); FEATURE_DISABLED without the switch; audited', tag: 'workspace', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'settings.manage', body: CustomDomainSetSchema, response: CustomDomainStateSchema }),
  domainDelete: route({ method: 'delete', path: '/workspace/domain', summary: 'Remove the custom domain; audited', tag: 'workspace', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'settings.manage', response: CustomDomainStateSchema }),
  domainVerify: route({ method: 'post', path: '/workspace/domain/verify', summary: 'Check the TXT record now (dev: *.localhost verifies without DNS)', tag: 'workspace', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'settings.manage', response: CustomDomainStateSchema }),

  // ---------------- platform config: Firebase and Android releases (D-058) ----------------
  superFirebaseGet: route({ method: 'get', path: '/api/super/config/firebase', absolute: true, summary: 'Firebase config status (client options; service account status only)', tag: 'super-config', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.system.manage', response: FirebaseConfigStatusSchema }),
  superFirebaseClientUpload: route({ method: 'put', path: '/api/super/config/firebase/client', absolute: true, summary: 'Upload google-services.json (must contain the app.vistar.employee Android app); stored encrypted; audited', tag: 'super-config', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.system.manage', bodyContentType: 'multipart/form-data', response: FirebaseConfigStatusSchema }),
  superFirebaseServiceAccountUpload: route({ method: 'put', path: '/api/super/config/firebase/service-account', absolute: true, summary: 'Upload the Firebase service account JSON (FCM sender); stored encrypted, never returned; audited', tag: 'super-config', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.system.manage', bodyContentType: 'multipart/form-data', response: FirebaseConfigStatusSchema }),
  superFirebaseDelete: route({ method: 'delete', path: '/api/super/config/firebase/{part}', absolute: true, summary: 'Remove the client config or the service account; audited', tag: 'super-config', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.system.manage', params: FirebaseConfigPartSchema, response: FirebaseConfigStatusSchema }),
  superPushTest: route({ method: 'post', path: '/api/super/config/firebase/test', absolute: true, summary: 'Send a test push to one FCM token', tag: 'super-config', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.system.manage', body: PushTestSchema, response: PushTestResultSchema }),
  superAndroidReleaseList: route({ method: 'get', path: '/api/super/android-releases', absolute: true, summary: 'Android APK releases, newest first', tag: 'super-config', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.system.manage', response: listOf(AndroidReleaseSchema) }),
  superAndroidReleaseUpload: route({ method: 'post', path: '/api/super/android-releases', absolute: true, summary: 'Upload an APK (max 150 MB) with version and notes; sha256 computed; versionCode must be new; audited', tag: 'super-config', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.system.manage', bodyContentType: 'multipart/form-data', bodyFields: AndroidReleaseUploadFieldsSchema, response: AndroidReleaseSchema, status: 201 }),
  superAndroidReleaseUpdate: route({ method: 'patch', path: '/api/super/android-releases/{id}', absolute: true, summary: 'Edit notes or the minimum-supported flag; audited', tag: 'super-config', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.system.manage', params: IdParamSchema, body: AndroidReleaseUpdateSchema, response: AndroidReleaseSchema }),
  appConfig: route({ method: 'get', path: '/app/config', summary: 'Android app bootstrap: public Firebase options, latest release, minimum version (no auth)', tag: 'app', owner: 'backend-core', phase: 19, auth: 'public', permission: null, response: AppConfigSchema }),
  appAndroidLatest: route({ method: 'get', path: '/app/android/latest', summary: 'Download the latest APK (no auth; the employee panel links here); 404 when none', tag: 'app', owner: 'backend-core', phase: 19, auth: 'public', permission: null, response: null, responseContentType: 'application/vnd.android.package-archive' }),

  // ---------------- devices and push ----------------
  myDeviceList: route({ method: 'get', path: '/me/devices', summary: 'My registered devices', tag: 'devices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: null, response: listOf(DeviceSchema) }),
  myDeviceRegister: route({ method: 'post', path: '/me/devices', summary: 'Register or refresh this device and its FCM token (idempotent upsert by installationId)', tag: 'devices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: null, body: DeviceRegisterSchema, response: DeviceSchema }),
  myDeviceDelete: route({ method: 'delete', path: '/me/devices/{id}', summary: 'Unregister a device (sign-out on the phone)', tag: 'devices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: null, params: IdParamSchema, response: OkResponseSchema }),

  // ---------------- presence (D-062; REALTIME) ----------------
  myPresenceGet: route({ method: 'get', path: '/me/presence', summary: 'My current server-decided status', tag: 'presence', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: null, response: MyPresenceSchema }),
  myPresenceHeartbeat: route({ method: 'post', path: '/me/presence/heartbeat', summary: 'Heartbeat from the web or the app (every HEARTBEAT_INTERVAL_MS; also accepted on the socket)', tag: 'presence', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: null, body: PresenceHeartbeatSchema, response: MyPresenceSchema }),
  myZoneSignal: route({ method: 'post', path: '/me/presence/zone', summary: 'Where I am in the office: BLE beacons / Wi-Fi seen, a scanned QR or NFC marker, or a manual zone (Android app); emits employee.zone_changed', tag: 'presence', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: null, body: ZoneSignalSchema, response: MyPresenceSchema }),
  officeMarkerList: route({ method: 'get', path: '/team-floor/markers', summary: 'Beacons, access points, QR codes and NFC tags that mark office zones', tag: 'team-floor', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: 'settings.manage', response: listOf(OfficeMarkerSchema) }),
  officeMarkerCreate: route({ method: 'post', path: '/team-floor/markers', summary: 'Register a zone marker (QR/NFC token returned once); audited', tag: 'team-floor', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: 'settings.manage', body: OfficeMarkerCreateSchema, response: OfficeMarkerSchema, status: 201 }),
  officeMarkerDelete: route({ method: 'delete', path: '/team-floor/markers/{id}', summary: 'Remove a zone marker; audited', tag: 'team-floor', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: 'settings.manage', params: IdParamSchema, response: OkResponseSchema }),
  presenceHistory: route({ method: 'get', path: '/users/{id}/presence-history', summary: 'Status changes of one person for a day (scope applies)', tag: 'presence', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: 'team.read', params: IdParamSchema, query: PresenceHistoryQuerySchema, response: listOf(PresenceEventSchema) }),

  // ---------------- SIM calls from the app (D-057; REALTIME) ----------------
  myCallDeviceLog: route({ method: 'post', path: '/me/calls/device-log', summary: 'Upload Android call-log rows (batch of up to 200, idempotent by deviceCallId); emits call.ended / call.updated', tag: 'calls', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: 'calls.make', body: DeviceCallLogBatchSchema, response: DeviceCallLogResultSchema }),
  myCallActive: route({ method: 'post', path: '/me/calls/active', summary: 'Live phone state: started / ended (sets presence on_call; emits call.started / call.ended); idempotent by clientCallId', tag: 'calls', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: 'calls.make', body: ActiveCallEventSchema, response: CallSchema }),
  callRecordingUpload: route({ method: 'post', path: '/calls/{id}/recording', summary: 'Upload the phone recorder file of my call (multipart file, purpose call_recording, max 50 MB)', tag: 'calls', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: 'calls.make', params: IdParamSchema, bodyContentType: 'multipart/form-data', response: CallSchema }),

  // ---------------- attendance and field tracking (D-063; REALTIME; flag field_tracking) ----------------
  myAttendanceToday: route({ method: 'get', path: '/me/attendance/today', summary: 'Today: sessions, working hours, consent, whether to track now', tag: 'attendance', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: null, response: MyAttendanceTodaySchema }),
  myAttendanceCheckIn: route({ method: 'post', path: '/me/attendance/check-in', summary: 'Check in with location (field staff, consent, working hours); emits attendance.checked_in', tag: 'attendance', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: null, body: AttendanceCheckSchema, response: AttendanceSessionSchema, status: 201 }),
  myAttendanceCheckOut: route({ method: 'post', path: '/me/attendance/check-out', summary: 'Check out with location; emits attendance.checked_out', tag: 'attendance', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: null, body: AttendanceCheckSchema, response: AttendanceSessionSchema }),
  myLocationBatch: route({ method: 'post', path: '/me/location', summary: 'Location points (batch, idempotent by time); only while checked in and inside working hours; emits location.updated', tag: 'attendance', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: null, body: LocationBatchSchema, response: LocationBatchResultSchema }),
  myTrackingConsentGet: route({ method: 'get', path: '/me/tracking-consent', summary: 'My tracking consent', tag: 'attendance', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: null, response: TrackingConsentSchema }),
  myTrackingConsentSet: route({ method: 'put', path: '/me/tracking-consent', summary: 'Accept or withdraw tracking consent (history kept)', tag: 'attendance', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: null, body: TrackingConsentUpdateSchema, response: TrackingConsentSchema }),
  attendanceRegister: route({ method: 'get', path: '/attendance', summary: 'Attendance register for a day (scope applies)', tag: 'attendance', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: 'team.read', query: AttendanceRegisterQuerySchema, response: AttendanceRegisterSchema }),
  fieldLive: route({ method: 'get', path: '/field/live', summary: 'Last known position of checked-in field staff (scope applies)', tag: 'attendance', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: 'team.read', query: FieldLiveQuerySchema, response: FieldLiveSchema }),
  fieldUserRoute: route({ method: 'get', path: '/field/users/{id}/route', summary: 'Route of one field staff member for a day (scope applies; 404 out of scope)', tag: 'attendance', owner: 'realtime-integrations', phase: 19, auth: 'jwt', permission: 'team.read', params: IdParamSchema, query: FieldRouteQuerySchema, response: FieldRouteSchema }),

  // ---------------- custom Team Floors (D-061) ----------------
  floorRequestCreate: route({ method: 'post', path: '/floor-requests', summary: 'Submit a custom floor request with reference images (>= 3, work_area + cabin or meeting_room); audited', tag: 'team-floor', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'settings.manage', body: FloorRequestCreateSchema, response: FloorRequestSchema, status: 201 }),
  floorRequestList: route({ method: 'get', path: '/floor-requests', summary: 'This company\'s floor requests, newest first', tag: 'team-floor', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'settings.manage', response: listOf(FloorRequestSchema) }),
  floorRequestGet: route({ method: 'get', path: '/floor-requests/{id}', summary: 'Floor request with signed image URLs', tag: 'team-floor', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'settings.manage', params: IdParamSchema, response: FloorRequestSchema }),
  teamFloorLayout: route({ method: 'get', path: '/team-floor/layout', summary: 'The published custom floor (signed model URL + seat map) or the default template id and request status', tag: 'team-floor', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'teamfloor.read', response: TeamFloorLayoutSchema }),
  superFloorRequestList: route({ method: 'get', path: '/api/super/floor-requests', absolute: true, summary: 'Floor requests across companies', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.read', query: SuperFloorRequestListQuerySchema, response: pageOf(FloorRequestSchema) }),
  superFloorRequestGet: route({ method: 'get', path: '/api/super/floor-requests/{id}', absolute: true, summary: 'Floor request with signed reference image URLs', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.read', params: IdParamSchema, response: FloorRequestSchema }),
  superFloorRequestStatus: route({ method: 'post', path: '/api/super/floor-requests/{id}/status', absolute: true, summary: 'Mark in progress or reject (note required); audited in both logs; emits floor_request.updated', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.manage', params: IdParamSchema, body: FloorRequestStatusChangeSchema, response: FloorRequestSchema }),
  superFloorList: route({ method: 'get', path: '/api/super/companies/{id}/floors', absolute: true, summary: 'Floor versions of a company', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.read', params: IdParamSchema, response: listOf(FloorAssetSchema) }),
  superFloorUpload: route({ method: 'post', path: '/api/super/companies/{id}/floors', absolute: true, summary: 'Upload the AI-made floor for a company: .glb, .zip with a .gltf, or a Vistar floor plan .json (FloorPlanSchema; its seats become the seat map); max 40 MB, validated; creates a draft version; audited', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.manage', params: IdParamSchema, bodyContentType: 'multipart/form-data', bodyFields: FloorUploadFieldsSchema, response: FloorAssetSchema, status: 201 }),
  superFloorGet: route({ method: 'get', path: '/api/super/floors/{id}', absolute: true, summary: 'One floor version with a signed model URL (preview)', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.read', params: IdParamSchema, response: FloorAssetSchema }),
  superFloorSeatMap: route({ method: 'put', path: '/api/super/floors/{id}/seat-map', absolute: true, summary: 'Save seats and zones (seat tool); not allowed on superseded versions', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.manage', params: IdParamSchema, body: SeatMapSchema, response: FloorAssetSchema }),
  superFloorPublish: route({ method: 'post', path: '/api/super/floors/{id}/publish', absolute: true, summary: 'Publish (needs a seat map): older published version becomes superseded, request -> published; audited; emits floor.published', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.manage', params: IdParamSchema, response: FloorAssetSchema }),

  // ================= change #19 wave B (SPEC 29.9): CRM features. owner backend-core = CRM-API stream ===

  // ---------------- contacts ----------------
  contactList: route({ method: 'get', path: '/contacts', summary: 'Contacts (people) with search and filters; scope: owner or a visible lead', tag: 'contacts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'contacts.read', query: ContactListQuerySchema, response: pageOf(ContactListItemSchema) }),
  contactCreate: route({ method: 'post', path: '/contacts', summary: 'Create a contact (a primary phone already used by another contact answers 409 CONFLICT)', tag: 'contacts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'contacts.create', body: ContactCreateSchema, response: ContactSchema, status: 201 }),
  contactMerge: route({ method: 'post', path: '/contacts/merge', summary: 'Merge duplicates into a primary contact (leads, deals, documents and meetings move; duplicates soft-deleted); audited', tag: 'contacts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'contacts.merge', body: CrmMergeSchema, response: ContactSchema }),
  contactBulk: route({ method: 'post', path: '/contacts/bulk', summary: 'Bulk assign owner, add or remove tags, delete', tag: 'contacts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'contacts.update', body: CrmBulkActionSchema, response: BulkResultSchema }),
  contactGet: route({ method: 'get', path: '/contacts/{id}', summary: 'Contact detail', tag: 'contacts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'contacts.read', params: IdParamSchema, response: ContactSchema }),
  contactUpdate: route({ method: 'patch', path: '/contacts/{id}', summary: 'Update a contact (changing ownerId also requires leads.assign; optimistic version)', tag: 'contacts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'contacts.update', params: IdParamSchema, body: ContactUpdateSchema, response: ContactSchema }),
  contactDelete: route({ method: 'delete', path: '/contacts/{id}', summary: 'Delete a contact (soft; leads keep their data, contactId cleared); audited', tag: 'contacts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'contacts.delete', params: IdParamSchema, response: OkResponseSchema }),
  contactDuplicates: route({ method: 'get', path: '/contacts/{id}/duplicates', summary: 'Possible duplicates (phones, emails, GSTIN, name + account)', tag: 'contacts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'contacts.read', params: IdParamSchema, response: listOf(ContactListItemSchema) }),
  contactRelated: route({ method: 'get', path: '/contacts/{id}/related', summary: 'Leads, deals, quotations, invoices and meetings of a contact', tag: 'contacts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'contacts.read', params: IdParamSchema, response: CrmRelatedSchema }),
  contactTimeline: route({ method: 'get', path: '/contacts/{id}/timeline', summary: 'Notes, lead activities, meetings and documents, newest first', tag: 'contacts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'contacts.read', params: IdParamSchema, query: CursorPaginationQuerySchema, response: pageOf(CrmTimelineItemSchema) }),
  contactNoteCreate: route({ method: 'post', path: '/contacts/{id}/notes', summary: 'Add a note to a contact', tag: 'contacts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'contacts.update', params: IdParamSchema, body: CrmNoteCreateSchema, response: CrmTimelineItemSchema, status: 201 }),

  // ---------------- accounts (companies; Prisma model Company) ----------------
  accountList: route({ method: 'get', path: '/accounts', summary: 'Accounts (companies) with search and filters; scope: owner or a visible lead', tag: 'accounts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'accounts.read', query: AccountListQuerySchema, response: pageOf(AccountListItemSchema) }),
  accountCreate: route({ method: 'post', path: '/accounts', summary: 'Create an account (GSTIN validated with its check digit; PAN and state code follow the GSTIN)', tag: 'accounts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'accounts.create', body: AccountCreateSchema, response: AccountSchema, status: 201 }),
  accountMerge: route({ method: 'post', path: '/accounts/merge', summary: 'Merge duplicate accounts (contacts, leads, deals, documents and meetings move); audited', tag: 'accounts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'accounts.merge', body: CrmMergeSchema, response: AccountSchema }),
  accountBulk: route({ method: 'post', path: '/accounts/bulk', summary: 'Bulk assign owner, add or remove tags, delete', tag: 'accounts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'accounts.update', body: CrmBulkActionSchema, response: BulkResultSchema }),
  accountGet: route({ method: 'get', path: '/accounts/{id}', summary: 'Account detail', tag: 'accounts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'accounts.read', params: IdParamSchema, response: AccountSchema }),
  accountUpdate: route({ method: 'patch', path: '/accounts/{id}', summary: 'Update an account (changing ownerId also requires leads.assign; optimistic version)', tag: 'accounts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'accounts.update', params: IdParamSchema, body: AccountUpdateSchema, response: AccountSchema }),
  accountDelete: route({ method: 'delete', path: '/accounts/{id}', summary: 'Delete an account (soft; contacts and leads keep their data, links cleared); audited', tag: 'accounts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'accounts.delete', params: IdParamSchema, response: OkResponseSchema }),
  accountDuplicates: route({ method: 'get', path: '/accounts/{id}/duplicates', summary: 'Possible duplicates (GSTIN, PAN, phone, email, website, name)', tag: 'accounts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'accounts.read', params: IdParamSchema, response: listOf(AccountListItemSchema) }),
  accountRelated: route({ method: 'get', path: '/accounts/{id}/related', summary: 'Contacts, leads, deals, quotations, invoices and meetings of an account', tag: 'accounts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'accounts.read', params: IdParamSchema, response: CrmRelatedSchema }),
  accountTimeline: route({ method: 'get', path: '/accounts/{id}/timeline', summary: 'Notes, lead activities, meetings and documents, newest first', tag: 'accounts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'accounts.read', params: IdParamSchema, query: CursorPaginationQuerySchema, response: pageOf(CrmTimelineItemSchema) }),
  accountNoteCreate: route({ method: 'post', path: '/accounts/{id}/notes', summary: 'Add a note to an account', tag: 'accounts', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'accounts.update', params: IdParamSchema, body: CrmNoteCreateSchema, response: CrmTimelineItemSchema, status: 201 }),

  // ---------------- deals (Deal model on a deal pipeline) ----------------
  dealBoard: route({ method: 'get', path: '/deals/board', summary: 'Deals board: stage columns with counts, value and weighted value (same filters as the table)', tag: 'deals', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'deals.read', query: DealBoardQuerySchema, response: DealBoardSchema }),
  dealBulk: route({ method: 'post', path: '/deals/bulk', summary: 'Bulk assign owner, change stage, delete', tag: 'deals', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'deals.update', body: DealBulkActionSchema, response: BulkResultSchema }),
  dealList: route({ method: 'get', path: '/deals', summary: 'Deals table with filters and sort (sort=position for one board column)', tag: 'deals', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'deals.read', query: DealListQuerySchema, response: pageOf(DealListItemSchema) }),
  dealCreate: route({ method: 'post', path: '/deals', summary: 'Create a deal (top of its column); value from the lines when given', tag: 'deals', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'deals.create', body: DealCreateSchema, response: DealSchema, status: 201 }),
  dealGet: route({ method: 'get', path: '/deals/{id}', summary: 'Deal detail with products', tag: 'deals', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'deals.read', params: IdParamSchema, response: DealSchema }),
  dealUpdate: route({ method: 'patch', path: '/deals/{id}', summary: 'Update a deal (lines replace all lines; ownerId needs leads.assign; optimistic version)', tag: 'deals', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'deals.update', params: IdParamSchema, body: DealUpdateSchema, response: DealSchema }),
  dealDelete: route({ method: 'delete', path: '/deals/{id}', summary: 'Delete a deal (soft); audited', tag: 'deals', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'deals.delete', params: IdParamSchema, response: OkResponseSchema }),
  dealMove: route({ method: 'post', path: '/deals/{id}/move', summary: 'Move on the board (stage and position between neighbours); won/lost set closedAt', tag: 'deals', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'deals.update', params: IdParamSchema, body: DealMoveSchema, response: DealSchema }),
  dealRelated: route({ method: 'get', path: '/deals/{id}/related', summary: 'Quotations, invoices and meetings of a deal (contacts and leads lists are empty)', tag: 'deals', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'deals.read', params: IdParamSchema, response: CrmRelatedSchema }),
  dealTimeline: route({ method: 'get', path: '/deals/{id}/timeline', summary: 'Notes, lead activities, meetings and documents of a deal', tag: 'deals', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'deals.read', params: IdParamSchema, query: CursorPaginationQuerySchema, response: pageOf(CrmTimelineItemSchema) }),
  dealNoteCreate: route({ method: 'post', path: '/deals/{id}/notes', summary: 'Add a note to a deal', tag: 'deals', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'deals.update', params: IdParamSchema, body: CrmNoteCreateSchema, response: CrmTimelineItemSchema, status: 201 }),
  leadConvert: route({ method: 'post', path: '/leads/{id}/convert', summary: 'Convert a lead: link or create the contact and account, optionally create a deal (also needs contacts.create / accounts.create / deals.create for what it creates)', tag: 'leads', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'leads.update', params: IdParamSchema, body: LeadConvertSchema, response: LeadConvertResultSchema }),

  // ---------------- products and price lists ----------------
  productList: route({ method: 'get', path: '/products', summary: 'Products and services with search and filters', tag: 'products', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'products.read', query: ProductListQuerySchema, response: pageOf(ProductSchema) }),
  productCreate: route({ method: 'post', path: '/products', summary: 'Create a product (SKU unique: PRODUCT_SKU_TAKEN; HSN for goods, SAC for services)', tag: 'products', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'products.manage', body: ProductCreateSchema, response: ProductSchema, status: 201 }),
  productGet: route({ method: 'get', path: '/products/{id}', summary: 'One product', tag: 'products', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'products.read', params: IdParamSchema, response: ProductSchema }),
  productUpdate: route({ method: 'patch', path: '/products/{id}', summary: 'Update a product (existing documents keep their line snapshots)', tag: 'products', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'products.manage', params: IdParamSchema, body: ProductUpdateSchema, response: ProductSchema }),
  productDelete: route({ method: 'delete', path: '/products/{id}', summary: 'Delete a product (document lines keep their snapshot; price list items go); audited', tag: 'products', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'products.manage', params: IdParamSchema, response: OkResponseSchema }),
  priceListList: route({ method: 'get', path: '/price-lists', summary: 'Price lists (without items)', tag: 'products', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'products.read', response: listOf(PriceListSchema) }),
  priceListCreate: route({ method: 'post', path: '/price-lists', summary: 'Create a price list with items', tag: 'products', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'products.manage', body: PriceListCreateSchema, response: PriceListSchema, status: 201 }),
  priceListGet: route({ method: 'get', path: '/price-lists/{id}', summary: 'Price list with items', tag: 'products', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'products.read', params: IdParamSchema, response: PriceListSchema }),
  priceListUpdate: route({ method: 'patch', path: '/price-lists/{id}', summary: 'Update a price list (items replace all items when given)', tag: 'products', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'products.manage', params: IdParamSchema, body: PriceListUpdateSchema, response: PriceListSchema }),
  priceListDelete: route({ method: 'delete', path: '/price-lists/{id}', summary: 'Delete a price list (documents keep their prices)', tag: 'products', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'products.manage', params: IdParamSchema, response: OkResponseSchema }),

  // ---------------- seller profile (GST identity of the company) ----------------
  sellerProfileGet: route({ method: 'get', path: '/billing/profile', summary: 'Seller profile for quotations and invoices (GSTIN, address with state code, bank, prefixes, terms)', tag: 'documents', owner: 'backend-core', phase: 19, auth: 'jwt', permission: null, response: SellerProfileResponseSchema }),
  sellerProfileUpdate: route({ method: 'put', path: '/billing/profile', summary: 'Save the seller profile (GSTIN state must match the address state); audited', tag: 'documents', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'settings.manage', body: SellerProfileSchema, response: SellerProfileResponseSchema }),

  // ---------------- quotations ----------------
  quotationList: route({ method: 'get', path: '/quotations', summary: 'Quotations with filters (expired is applied after validUntil)', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'quotations.read', query: QuotationListQuerySchema, response: pageOf(QuotationListItemSchema) }),
  quotationCreate: route({ method: 'post', path: '/quotations', summary: 'Create a draft quotation (number QT/<FY>/<seq> assigned now; GST computed)', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'quotations.create', body: QuotationCreateSchema, response: QuotationSchema, status: 201 }),
  quotationGet: route({ method: 'get', path: '/quotations/{id}', summary: 'Quotation detail with lines and totals', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'quotations.read', params: IdParamSchema, response: QuotationSchema }),
  quotationUpdate: route({ method: 'patch', path: '/quotations/{id}', summary: 'Edit a draft quotation (DOCUMENT_STATE_INVALID otherwise; optimistic version)', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'quotations.update', params: IdParamSchema, body: QuotationUpdateSchema, response: QuotationSchema }),
  quotationDelete: route({ method: 'delete', path: '/quotations/{id}', summary: 'Delete a draft quotation (soft); audited', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'quotations.delete', params: IdParamSchema, response: OkResponseSchema }),
  quotationStatus: route({ method: 'post', path: '/quotations/{id}/status', summary: 'Change status along QUOTATION_TRANSITIONS (accepted, rejected, expired, reopen to draft)', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'quotations.update', params: IdParamSchema, body: QuotationStatusChangeSchema, response: QuotationSchema }),
  quotationSend: route({ method: 'post', path: '/quotations/{id}/send', summary: 'Mark sent (from draft or expired; freezes seller and buyer) and create a share link (needs a complete seller profile)', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'quotations.send', params: IdParamSchema, body: DocumentShareCreateSchema, response: QuotationSendResultSchema }),
  quotationShare: route({ method: 'post', path: '/quotations/{id}/share', summary: 'Create a new share link (rotates the old one)', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'quotations.send', params: IdParamSchema, body: DocumentShareCreateSchema, response: DocumentShareSchema }),
  quotationShareRevoke: route({ method: 'delete', path: '/quotations/{id}/share', summary: 'Revoke the share link', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'quotations.send', params: IdParamSchema, response: OkResponseSchema }),
  quotationPdf: route({ method: 'get', path: '/quotations/{id}/pdf', summary: 'A4 PDF with branding logo and colour (?download=1 for an attachment)', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'quotations.read', params: IdParamSchema, query: DocumentPdfQuerySchema, response: null, responseContentType: 'application/pdf' }),
  quotationConvert: route({ method: 'post', path: '/quotations/{id}/convert', summary: 'Make a draft invoice from a sent or accepted quotation (marks it accepted); idempotent: returns the existing invoice', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.create', params: IdParamSchema, response: InvoiceSchema, status: 201 }),
  quotationDuplicate: route({ method: 'post', path: '/quotations/{id}/duplicate', summary: 'Copy into a new draft quotation (revisions)', tag: 'quotations', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'quotations.create', params: IdParamSchema, response: QuotationSchema, status: 201 }),

  // ---------------- invoices and payments ----------------
  invoiceList: route({ method: 'get', path: '/invoices', summary: 'Invoices with filters (overdue = issued or partially paid past the due date)', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.read', query: InvoiceListQuerySchema, response: pageOf(InvoiceListItemSchema) }),
  invoiceCreate: route({ method: 'post', path: '/invoices', summary: 'Create a draft invoice (no number until issued)', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.create', body: InvoiceCreateSchema, response: InvoiceSchema, status: 201 }),
  invoiceGet: route({ method: 'get', path: '/invoices/{id}', summary: 'Invoice detail with lines, totals and payments', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.read', params: IdParamSchema, response: InvoiceSchema }),
  invoiceUpdate: route({ method: 'patch', path: '/invoices/{id}', summary: 'Edit a draft invoice (DOCUMENT_STATE_INVALID otherwise)', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.update', params: IdParamSchema, body: InvoiceUpdateSchema, response: InvoiceSchema }),
  invoiceDelete: route({ method: 'delete', path: '/invoices/{id}', summary: 'Delete a draft invoice (issued invoices are cancelled, never deleted); audited', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.delete', params: IdParamSchema, response: OkResponseSchema }),
  invoiceIssue: route({ method: 'post', path: '/invoices/{id}/issue', summary: 'Issue: assigns INV/<FY>/<seq> (no gaps), freezes seller and buyer; needs a complete seller profile; audited', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.issue', params: IdParamSchema, body: InvoiceIssueSchema, response: InvoiceSchema }),
  invoiceCancel: route({ method: 'post', path: '/invoices/{id}/cancel', summary: 'Cancel an issued invoice with a reason (the number stays used); audited', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.cancel', params: IdParamSchema, body: InvoiceCancelSchema, response: InvoiceSchema }),
  invoiceSend: route({ method: 'post', path: '/invoices/{id}/send', summary: 'Issue a draft if needed and create a share link', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.issue', params: IdParamSchema, body: DocumentShareCreateSchema, response: InvoiceSendResultSchema }),
  invoiceShare: route({ method: 'post', path: '/invoices/{id}/share', summary: 'Create a new share link for an issued invoice (rotates the old one)', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.issue', params: IdParamSchema, body: DocumentShareCreateSchema, response: DocumentShareSchema }),
  invoiceShareRevoke: route({ method: 'delete', path: '/invoices/{id}/share', summary: 'Revoke the share link', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.issue', params: IdParamSchema, response: OkResponseSchema }),
  invoicePdf: route({ method: 'get', path: '/invoices/{id}/pdf', summary: 'A4 tax invoice PDF with HSN summary, branding logo and colour (?download=1)', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.read', params: IdParamSchema, query: DocumentPdfQuerySchema, response: null, responseContentType: 'application/pdf' }),
  paymentCreate: route({ method: 'post', path: '/invoices/{id}/payments', summary: 'Record a payment (issued or partially paid; at most the balance; idempotent with clientPaymentId); updates the status', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.payments', params: IdParamSchema, body: PaymentCreateSchema, response: InvoiceSchema, status: 201 }),
  paymentDelete: route({ method: 'delete', path: '/invoices/{id}/payments/{paymentId}', summary: 'Void a payment (kept for the audit trail); updates the status; audited', tag: 'invoices', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'invoices.payments', params: PaymentParamSchema, response: InvoiceSchema }),

  // ---------------- public share links ----------------
  publicDocumentGet: route({ method: 'get', path: '/public/documents/{token}', summary: 'Shared quotation or invoice for the hosted page /d/<token> (410 SHARE_LINK_EXPIRED)', tag: 'public', owner: 'backend-core', phase: 19, auth: 'public', permission: null, params: DocumentTokenParamSchema, response: PublicDocumentSchema }),
  publicDocumentPdf: route({ method: 'get', path: '/public/documents/{token}/pdf', summary: 'PDF of a shared document', tag: 'public', owner: 'backend-core', phase: 19, auth: 'public', permission: null, params: DocumentTokenParamSchema, query: DocumentPdfQuerySchema, response: null, responseContentType: 'application/pdf' }),

  // ---------------- calendar and meetings ----------------
  meetingList: route({ method: 'get', path: '/meetings', summary: 'Meetings in a range (max 62 days), recurring series expanded; scope: organizer or attendee', tag: 'calendar', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'calendar.read', query: MeetingListQuerySchema, response: listOf(MeetingSchema) }),
  meetingCreate: route({ method: 'post', path: '/meetings', summary: 'Schedule a meeting (attendees, links to lead/contact/account/deal, reminders, recurrence)', tag: 'calendar', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'calendar.create', body: MeetingCreateSchema, response: MeetingSchema, status: 201 }),
  meetingGet: route({ method: 'get', path: '/meetings/{id}', summary: 'One meeting (series)', tag: 'calendar', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'calendar.read', params: IdParamSchema, response: MeetingSchema }),
  meetingUpdate: route({ method: 'patch', path: '/meetings/{id}', summary: 'Edit or reschedule (scope series | occurrence); organizer, or calendar.update with scope', tag: 'calendar', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'calendar.update', params: IdParamSchema, body: MeetingUpdateSchema, response: MeetingSchema }),
  meetingDelete: route({ method: 'delete', path: '/meetings/{id}', summary: 'Delete a meeting (soft)', tag: 'calendar', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'calendar.delete', params: IdParamSchema, response: OkResponseSchema }),
  meetingCancel: route({ method: 'post', path: '/meetings/{id}/cancel', summary: 'Cancel a meeting or one occurrence of a series', tag: 'calendar', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'calendar.update', params: IdParamSchema, body: MeetingCancelSchema, response: MeetingSchema }),
  meetingRespond: route({ method: 'post', path: '/meetings/{id}/respond', summary: 'Accept, decline or tentative (the caller as attendee)', tag: 'calendar', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'calendar.read', params: IdParamSchema, body: MeetingRespondSchema, response: MeetingSchema }),
  calendarAvailability: route({ method: 'get', path: '/calendar/availability', summary: 'Working hours, busy blocks (meetings, time off) and live status per user in scope', tag: 'calendar', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'calendar.read', query: AvailabilityQuerySchema, response: listOf(UserAvailabilitySchema) }),
  timeOffList: route({ method: 'get', path: '/time-off', summary: 'Time off (leave, holiday, training) of users in scope', tag: 'calendar', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'calendar.read', query: TimeOffListQuerySchema, response: listOf(TimeOffSchema) }),
  timeOffCreate: route({ method: 'post', path: '/time-off', summary: 'Add time off (own: calendar.create; others: team.manage)', tag: 'calendar', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'calendar.create', body: TimeOffCreateSchema, response: TimeOffSchema, status: 201 }),
  timeOffDelete: route({ method: 'delete', path: '/time-off/{id}', summary: 'Remove time off (own, or team.manage)', tag: 'calendar', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'calendar.create', params: IdParamSchema, response: OkResponseSchema }),

  // ---------------- lead routing ----------------
  routingRuleList: route({ method: 'get', path: '/routing-rules', summary: 'Lead routing rules in priority order', tag: 'routing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'routing.manage', response: listOf(RoutingRuleSchema) }),
  routingRuleCreate: route({ method: 'post', path: '/routing-rules', summary: 'Add a rule (end of the order); audited', tag: 'routing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'routing.manage', body: RoutingRuleCreateSchema, response: RoutingRuleSchema, status: 201 }),
  routingRuleOrder: route({ method: 'put', path: '/routing-rules/order', summary: 'Reorder rules (all ids, first = checked first)', tag: 'routing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'routing.manage', body: RoutingRuleOrderSchema, response: listOf(RoutingRuleSchema) }),
  routingTest: route({ method: 'post', path: '/routing-rules/test', summary: 'Who would get this lead? (dry run; nothing is written)', tag: 'routing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'routing.manage', body: RoutingTestSchema, response: RoutingDecisionSchema }),
  routingRuleUpdate: route({ method: 'patch', path: '/routing-rules/{id}', summary: 'Update a rule (conditions replace all conditions); audited', tag: 'routing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'routing.manage', params: IdParamSchema, body: RoutingRuleUpdateSchema, response: RoutingRuleSchema }),
  routingRuleDelete: route({ method: 'delete', path: '/routing-rules/{id}', summary: 'Delete a rule; audited', tag: 'routing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'routing.manage', params: IdParamSchema, response: OkResponseSchema }),

  // ---------------- lead capture forms ----------------
  captureFormList: route({ method: 'get', path: '/capture-forms', summary: 'Lead capture forms with hosted URL and embed snippet', tag: 'capture', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'capture_forms.manage', response: listOf(CaptureFormSchema) }),
  captureFormCreate: route({ method: 'post', path: '/capture-forms', summary: 'Create a form (builder schema; name + phone or email mapped); audited', tag: 'capture', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'capture_forms.manage', body: CaptureFormCreateSchema, response: CaptureFormSchema, status: 201 }),
  captureFormGet: route({ method: 'get', path: '/capture-forms/{id}', summary: 'One form', tag: 'capture', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'capture_forms.manage', params: IdParamSchema, response: CaptureFormSchema }),
  captureFormUpdate: route({ method: 'patch', path: '/capture-forms/{id}', summary: 'Update fields, settings, status (pause)', tag: 'capture', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'capture_forms.manage', params: IdParamSchema, body: CaptureFormUpdateSchema, response: CaptureFormSchema }),
  captureFormDelete: route({ method: 'delete', path: '/capture-forms/{id}', summary: 'Delete a form (soft; its URL answers 410); audited', tag: 'capture', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'capture_forms.manage', params: IdParamSchema, response: OkResponseSchema }),
  captureSubmissionList: route({ method: 'get', path: '/capture-forms/{id}/submissions', summary: 'Submissions of a form, newest first', tag: 'capture', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'capture_forms.manage', params: IdParamSchema, query: CaptureSubmissionListQuerySchema, response: pageOf(CaptureSubmissionSchema) }),
  publicCaptureFormGet: route({ method: 'get', path: '/public/forms/{key}', summary: 'Form for the hosted page /f/<key> and iframes (410 CAPTURE_FORM_CLOSED when paused)', tag: 'public', owner: 'backend-core', phase: 19, auth: 'public', permission: null, params: CaptureFormKeyParamSchema, response: PublicCaptureFormSchema }),
  publicCaptureFormSubmit: route({ method: 'post', path: '/public/forms/{key}/submit', summary: 'Submit a form: creates a routed lead (rate limited per IP and form, honeypot, consent, idempotent with clientSubmissionId)', tag: 'public', owner: 'backend-core', phase: 19, auth: 'public', permission: null, params: CaptureFormKeyParamSchema, body: PublicCaptureSubmitSchema, response: PublicCaptureSubmitResultSchema }),

} as const satisfies Record<string, RouteDef>;

/**
 * Every route. Explicit type (change #20): the inferred literal type of one object with all routes exceeded the
 * size TypeScript serialises into the .d.ts (TS7056), so the blocks are declared separately and merged here.
 */
export const API_ROUTES: typeof CORE_ROUTES & typeof BILLING_ROUTES & typeof CONFIG_ROUTES = {
  ...CORE_ROUTES,
  // ---- change #19 wave C: billing (routes in api/routes-billing.ts)
  ...BILLING_ROUTES,
  // ---- change #20: config (routes in api/routes-config.ts)
  ...CONFIG_ROUTES,
};

export type ApiRouteId = keyof typeof API_ROUTES;

/** Infer request/response types for a route id. */
export type RouteBody<K extends ApiRouteId> = (typeof API_ROUTES)[K] extends { body: infer B extends z.ZodType } ? z.input<B> : never;
export type RouteQuery<K extends ApiRouteId> = (typeof API_ROUTES)[K] extends { query: infer Q extends z.ZodType } ? z.input<Q> : never;
export type RouteParams<K extends ApiRouteId> = (typeof API_ROUTES)[K] extends { params: infer P extends z.ZodType } ? z.input<P> : never;
export type RouteResponse<K extends ApiRouteId> = (typeof API_ROUTES)[K] extends { response: infer R extends z.ZodType } ? z.output<R> : void;

/** "/leads/{id}" -> "/leads/:id" for NestJS decorators. */
export function toNestPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}

/** Fill path params: buildPath('/leads/{id}', { id }) -> '/leads/123'. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`Missing path param "${key}" for ${path}`);
    return encodeURIComponent(value);
  });
}

/** Full URL path including /api/v1 unless the route is absolute. */
export function routePath(def: Pick<RouteDef, 'path' | 'absolute'>, params?: Record<string, string>): string {
  const p = buildPath(def.path, params);
  return def.absolute ? p : `${API_BASE_PATH}${p}`;
}
