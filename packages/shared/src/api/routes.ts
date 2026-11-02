import { z } from 'zod';
import type { Permission, PlatformPermission } from '../rbac.js';
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
import { MyPresenceSchema, PresenceEventSchema, PresenceHeartbeatSchema, PresenceHistoryQuerySchema } from '../schemas/presence.js';
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
  ApiKeySchema,
  InboundEndpointCreateSchema,
  IntegrationConnectSchema,
  IntegrationSchema,
  IntegrationTestResultSchema,
  MappingPreviewRequestSchema,
  MappingPreviewResponseSchema,
  OutboundEndpointCreateSchema,
  WebhookDeliveryQuerySchema,
  WebhookDeliverySchema,
  WebhookEndpointSchema,
  WebhookEndpointUpdateSchema,
  WebhookSecretSchema,
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
  PipelineSchema,
  StageCreateSchema,
  StageReorderSchema,
  StageSchema,
  StageUpdateSchema,
} from '../schemas/pipeline.js';
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
  responseContentType?: 'text/csv' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' | 'application/octet-stream' | 'application/vnd.android.package-archive';
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
});
const ProviderParam = z.object({ provider: z.string() });

export const API_ROUTES = {
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
  pipelineList: route({ method: 'get', path: '/pipelines', summary: 'Pipelines with stages', tag: 'pipeline', owner: 'backend-core', phase: 3, auth: 'jwt', permission: 'leads.read', response: listOf(PipelineSchema) }),
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
  integrationList: route({ method: 'get', path: '/integrations', summary: 'Integration hub status', tag: 'integrations', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'integrations.manage', response: listOf(IntegrationSchema) }),
  integrationConnect: route({ method: 'post', path: '/integrations/{provider}/connect', summary: 'Connect or update an integration', tag: 'integrations', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'integrations.manage', params: ProviderParam, body: IntegrationConnectSchema, response: IntegrationSchema }),
  integrationTest: route({ method: 'post', path: '/integrations/{provider}/test', summary: 'Test connection', tag: 'integrations', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'integrations.manage', params: ProviderParam, response: IntegrationTestResultSchema }),
  integrationDisconnect: route({ method: 'delete', path: '/integrations/{provider}', summary: 'Disconnect and wipe secrets', tag: 'integrations', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'integrations.manage', params: ProviderParam, response: OkResponseSchema }),
  webhookEndpointList: route({ method: 'get', path: '/webhooks/endpoints', summary: 'Inbound and outbound endpoints', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', response: listOf(WebhookEndpointSchema) }),
  webhookInboundCreate: route({ method: 'post', path: '/webhooks/endpoints/inbound', summary: 'Create an inbound source URL (secret returned once)', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', body: InboundEndpointCreateSchema, response: WebhookEndpointSchema.extend(WebhookSecretSchema.shape), status: 201 }),
  webhookOutboundCreate: route({ method: 'post', path: '/webhooks/endpoints/outbound', summary: 'Subscribe a URL to events (secret returned once)', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', body: OutboundEndpointCreateSchema, response: WebhookEndpointSchema.extend(WebhookSecretSchema.shape), status: 201 }),
  webhookEndpointUpdate: route({ method: 'patch', path: '/webhooks/endpoints/{id}', summary: 'Update an endpoint', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', params: IdParamSchema, body: WebhookEndpointUpdateSchema, response: WebhookEndpointSchema }),
  webhookEndpointDelete: route({ method: 'delete', path: '/webhooks/endpoints/{id}', summary: 'Delete an endpoint', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', params: IdParamSchema, response: OkResponseSchema }),
  webhookRotateSecret: route({ method: 'post', path: '/webhooks/endpoints/{id}/rotate-secret', summary: 'Rotate signing secret (returned once)', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', params: IdParamSchema, response: WebhookSecretSchema }),
  webhookMappingPreview: route({ method: 'post', path: '/webhooks/mapping/preview', summary: 'Preview mapping on a sample payload', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', body: MappingPreviewRequestSchema, response: MappingPreviewResponseSchema }),
  webhookDeliveryList: route({ method: 'get', path: '/webhooks/deliveries', summary: 'Delivery log', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', query: WebhookDeliveryQuerySchema, response: pageOf(WebhookDeliverySchema) }),
  webhookDeliveryGet: route({ method: 'get', path: '/webhooks/deliveries/{id}', summary: 'Delivery detail', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', params: IdParamSchema, response: WebhookDeliverySchema }),
  webhookDeliveryReplay: route({ method: 'post', path: '/webhooks/deliveries/{id}/replay', summary: 'Replay a delivery', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'webhooks.manage', params: IdParamSchema, response: WebhookDeliverySchema, status: 201 }),
  inboundWebhook: route({ method: 'post', path: '/api/hooks/{workspaceId}/{sourceKey}', absolute: true, summary: 'Inbound webhook (HMAC-SHA256 signed)', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'webhook', permission: null, params: z.object({ workspaceId: IdSchema, sourceKey: z.string() }), body: z.unknown(), response: InboundWebhookResponseSchema, status: 202 }),
  whatsappWebhookVerify: route({ method: 'get', path: '/api/hooks/whatsapp', absolute: true, summary: 'WhatsApp Cloud API verification challenge', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'public', permission: null, query: z.object({ 'hub.mode': z.string(), 'hub.verify_token': z.string(), 'hub.challenge': z.string() }), response: null }),
  whatsappWebhook: route({ method: 'post', path: '/api/hooks/whatsapp', absolute: true, summary: 'WhatsApp Cloud API events (X-Hub-Signature-256)', tag: 'webhooks', owner: 'realtime-integrations', phase: 5, auth: 'webhook', permission: null, body: z.unknown(), response: null }),
  apiKeyList: route({ method: 'get', path: '/api-keys', summary: 'API keys', tag: 'api-keys', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'apikeys.manage', response: listOf(ApiKeySchema) }),
  apiKeyCreate: route({ method: 'post', path: '/api-keys', summary: 'Create an API key (shown once)', tag: 'api-keys', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'apikeys.manage', body: ApiKeyCreateSchema, response: ApiKeyCreatedSchema, status: 201 }),
  apiKeyRotate: route({ method: 'post', path: '/api-keys/{id}/rotate', summary: 'Rotate an API key (shown once)', tag: 'api-keys', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'apikeys.manage', params: IdParamSchema, response: ApiKeyCreatedSchema }),
  apiKeyRevoke: route({ method: 'delete', path: '/api-keys/{id}', summary: 'Revoke an API key', tag: 'api-keys', owner: 'realtime-integrations', phase: 5, auth: 'jwt', permission: 'apikeys.manage', params: IdParamSchema, response: OkResponseSchema }),

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
  telephonyWebhook: route({ method: 'post', path: '/api/hooks/telephony/{provider}', absolute: true, summary: 'Telephony provider callbacks', tag: 'calls', owner: 'realtime-integrations', phase: 7, auth: 'webhook', permission: null, params: ProviderParam, body: z.unknown(), response: null }),

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
  superFloorUpload: route({ method: 'post', path: '/api/super/companies/{id}/floors', absolute: true, summary: 'Upload the AI-made floor for a company: .glb or .zip with a .gltf (max 40 MB, validated); creates a draft version; audited', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.manage', params: IdParamSchema, bodyContentType: 'multipart/form-data', bodyFields: FloorUploadFieldsSchema, response: FloorAssetSchema, status: 201 }),
  superFloorGet: route({ method: 'get', path: '/api/super/floors/{id}', absolute: true, summary: 'One floor version with a signed model URL (preview)', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.read', params: IdParamSchema, response: FloorAssetSchema }),
  superFloorSeatMap: route({ method: 'put', path: '/api/super/floors/{id}/seat-map', absolute: true, summary: 'Save seats and zones (seat tool); not allowed on superseded versions', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.manage', params: IdParamSchema, body: SeatMapSchema, response: FloorAssetSchema }),
  superFloorPublish: route({ method: 'post', path: '/api/super/floors/{id}/publish', absolute: true, summary: 'Publish (needs a seat map): older published version becomes superseded, request -> published; audited; emits floor.published', tag: 'super-floors', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.companies.manage', params: IdParamSchema, response: FloorAssetSchema }),
} as const satisfies Record<string, RouteDef>;

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
