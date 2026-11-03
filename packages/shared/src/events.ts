import { z } from 'zod';
import { AppScreenSchema, ComponentStyleSchema, EmployeeStatusSchema, MessageStatusSchema, PresenceSourceSchema, PresenceStatusSchema, WorkflowRunStatusSchema, ZoneSignalSourceSchema } from './enums.js';
import { ThemeModeSchema } from './theme.js';
import { CustomRecordSchema } from './customization/objects.js';
import { ActivitySchema } from './schemas/activity.js';
import { AttendanceSessionSchema } from './schemas/attendance.js';
import { WorkspaceBrandingSchema } from './schemas/branding.js';
import { CallSchema } from './schemas/call.js';
import { IdSchema, IsoDateTimeSchema } from './schemas/common.js';
import { ConversationSchema, MessageSchema } from './schemas/conversation.js';
import { AttentionItemSchema, DashboardKpisSchema, FeedItemSchema } from './schemas/dashboard.js';
import { FloorRequestSchema, TeamFloorRefSchema } from './schemas/floor.js';
import { LeadListItemSchema } from './schemas/lead.js';
import { NotificationSchema } from './schemas/notification.js';
import { PresenceActivitySchema, ZoneSignalSchema } from './schemas/presence.js';
import { TaskSchema } from './schemas/task.js';
import { IntegrationSchema, WebhookDeliverySchema, WebhookEndpointSchema } from './schemas/integration.js';
import { OUTBOUND_WEBHOOK_EVENTS } from './webhooks.js';
import { UserSummarySchema } from './schemas/workspace.js';
import { WorkflowRunStepSchema } from './schemas/workflow.js';
import { AccountListItemSchema, ContactListItemSchema, DealListItemSchema } from './schemas/crm.js';
import { InvoiceListItemSchema, PaymentSchema, QuotationListItemSchema } from './schemas/documents.js';
import { MeetingSchema } from './schemas/calendar.js';

/**
 * REALTIME EVENT CONTRACT
 *
 * Transport: Socket.IO namespace `/realtime` (path /socket.io). Handshake: `auth: { token: <accessToken> }`.
 * The server joins each socket to `ws:<workspaceId>` and `user:<userId>` automatically.
 * Every server->client message is a DomainEvent envelope; the Socket.IO event name equals `type`.
 * Events are emitted only AFTER the DB transaction commits.
 * Clients update the TanStack Query cache from events (no polling). On reconnect the server emits
 * `sync.required`; the client invalidates the listed query scopes and refetches.
 *
 * The same envelope is published on the server event bus (Redis channel `vistar:events`) and is the
 * body of outbound webhooks (for OUTBOUND_WEBHOOK_EVENTS).
 */

export const EVENT_BUS_CHANNEL = 'vistar:events';
export const REALTIME_NAMESPACE = '/realtime';

export const rooms = {
  workspace: (workspaceId: string) => `ws:${workspaceId}`,
  user: (userId: string) => `user:${userId}`,
  lead: (leadId: string) => `lead:${leadId}`,
  workflow: (workflowId: string) => `workflow:${workflowId}`,
  workflowRun: (runId: string) => `run:${runId}`,
  conversation: (conversationId: string) => `conv:${conversationId}`,
} as const;

/** Joinable rooms (client must request). Server validates tenant ownership before joining. */
export const JoinableRoomSchema = z.string().regex(/^(lead|workflow|run|conv):[0-9a-f-]{36}$/);

export const EventActorSchema = z.object({
  type: z.enum(['user', 'system', 'workflow', 'integration', 'api_key', 'simulator']),
  id: z.string().nullable(),
  name: z.string().nullable(),
});
export type EventActor = z.infer<typeof EventActorSchema>;

/** Payload schema per event type. */
export const eventPayloadSchemas = {
  // leads & pipeline
  'lead.created': z.object({ lead: LeadListItemSchema }),
  'lead.updated': z.object({
    lead: LeadListItemSchema,
    changed: z.array(z.string()).describe('Top-level field names that changed'),
  }),
  'lead.assigned': z.object({
    lead: LeadListItemSchema,
    fromUserId: IdSchema.nullable(),
    toUserId: IdSchema.nullable(),
    rule: z.string().nullable().describe('round_robin | least_busy | rule | manual | workflow'),
  }),
  'lead.deleted': z.object({ leadIds: z.array(IdSchema) }),
  'lead.merged': z.object({ primaryId: IdSchema, mergedIds: z.array(IdSchema) }),
  'stage.changed': z.object({
    lead: LeadListItemSchema,
    fromStageId: IdSchema.nullable(),
    toStageId: IdSchema,
    /** New fractional-index position within the target stage. */
    position: z.string(),
  }),
  'activity.created': z.object({ activity: ActivitySchema }),
  'feed.item': z.object({ item: FeedItemSchema }),

  // tasks
  'task.created': z.object({ task: TaskSchema }),
  'task.updated': z.object({ task: TaskSchema }),
  'task.overdue': z.object({ task: TaskSchema }),

  // calls & presence
  'call.started': z.object({ call: CallSchema }),
  'call.ended': z.object({ call: CallSchema }),
  'call.updated': z.object({ call: CallSchema }),
  'employee.status_changed': z.object({
    userId: IdSchema,
    status: EmployeeStatusSchema,
    previousStatus: EmployeeStatusSchema.nullable(),
    currentLeadId: IdSchema.nullable(),
    callId: IdSchema.nullable(),
    at: IsoDateTimeSchema,
    /** Detailed live status (D-062). Always set by the presence engine; optional only for older simulators. */
    presence: PresenceStatusSchema.optional(),
    /** Per-user monotonic change counter (Presence.version); drop events at or below the version you hold. */
    version: z.number().int().min(0).optional(),
    /** When the current status started. */
    since: IsoDateTimeSchema.optional(),
    previousPresence: PresenceStatusSchema.nullable().optional(),
    source: PresenceSourceSchema.optional(),
    lastSeenAt: IsoDateTimeSchema.nullable().optional(),
    activity: PresenceActivitySchema.optional(),
  }),

  /** Room / zone change inside the office (BLE, Wi-Fi, QR/NFC marker or manual); zoneId null = left the known zones. */
  'employee.zone_changed': z.object({
    userId: IdSchema,
    zoneId: z.string().nullable(),
    previousZoneId: z.string().nullable(),
    source: ZoneSignalSourceSchema,
    confidence: z.number().min(0).max(1),
    at: IsoDateTimeSchema,
  }),

  // attendance & field tracking (D-063); fan-out: the user, admins, and managers of the user's team
  'attendance.checked_in': z.object({ session: AttendanceSessionSchema, user: UserSummarySchema }),
  'attendance.checked_out': z.object({ session: AttendanceSessionSchema, user: UserSummarySchema }),
  'location.updated': z.object({
    userId: IdSchema,
    sessionId: IdSchema,
    point: z.object({ lat: z.number(), lng: z.number(), accuracy: z.number().nullable(), at: IsoDateTimeSchema, battery: z.number().int().nullable() }),
  }),

  // appearance & floors
  'workspace.branding_changed': z.object({ branding: WorkspaceBrandingSchema, componentStyle: ComponentStyleSchema }),
  /** A floor request changed (status or note); company admins refresh the Team Floor tab. */
  'floor_request.updated': z.object({ request: FloorRequestSchema.omit({ images: true }) }),
  /** A custom floor was published; every Team Floor reloads GET /team-floor/layout. */
  'floor.published': z.object({ floor: TeamFloorRefSchema }),

  // messaging
  'message.received': z.object({ conversation: ConversationSchema, message: MessageSchema }),
  'message.sent': z.object({ conversation: ConversationSchema, message: MessageSchema }),
  'message.status_updated': z.object({
    conversationId: IdSchema,
    messageId: IdSchema,
    status: MessageStatusSchema,
    error: z.string().nullable(),
  }),
  'conversation.updated': z.object({ conversation: ConversationSchema }),

  // notifications & attention
  'notification.created': z.object({ notification: NotificationSchema }),
  'attention.raised': z.object({ item: AttentionItemSchema }),
  'attention.resolved': z.object({ id: z.string() }),
  'dashboard.kpis_updated': z.object({ kpis: DashboardKpisSchema, from: IsoDateTimeSchema, to: IsoDateTimeSchema }),

  // workflows
  'workflow.run_updated': z.object({
    runId: IdSchema,
    workflowId: IdSchema,
    leadId: IdSchema.nullable(),
    status: WorkflowRunStatusSchema,
    isTest: z.boolean(),
  }),
  'workflow.step_updated': z.object({
    runId: IdSchema,
    workflowId: IdSchema,
    step: WorkflowRunStepSchema,
    /** Edge the run is travelling along next (for packet animation), if any. */
    nextEdgeId: z.string().nullable(),
  }),
  'workflow.failed': z.object({
    runId: IdSchema,
    workflowId: IdSchema,
    workflowName: z.string(),
    leadId: IdSchema.nullable(),
    nodeId: z.string().nullable(),
    error: z.string(),
  }),

  // integrations
  'webhook.delivery_updated': z.object({ delivery: WebhookDeliverySchema }),
  // ---- change #19 wave C: hub (audience: integrations.read / webhooks.read)
  /** Status, last check, last sync or attention changed (connect, test, sync, disconnect, cron pull, webhook verify). `endpoints` is always null here (read-only users get it too): refetch GET /integrations/{provider}. */
  'integration.updated': z.object({ integration: IntegrationSchema }),
  /** Endpoint changed outside a user edit, e.g. auto-disabled after repeated dead deliveries, or a sample was captured. */
  'webhook.endpoint_updated': z.object({ endpoint: WebhookEndpointSchema, reason: z.enum(['auto_disabled', 'sample_captured', 'updated']) }),
  // ---- end change #19 wave C: hub
  'import.progress': z.object({ importId: IdSchema, processed: z.number().int(), total: z.number().int(), done: z.boolean() }),

  // settings
  'theme.changed': z.object({
    scope: z.enum(['workspace', 'user']),
    userId: IdSchema.nullable(),
    mode: ThemeModeSchema,
  }),

  // customization & packs (flexible data layer)
  'customization.changed': z.object({
    /** What changed; clients refetch field definitions, objects, labels, pipelines or the pack runtime. */
    scope: z.enum(['fields', 'objects', 'labels', 'stages', 'packs']),
    target: z.string().nullable().describe('Field target or object key when scope is fields/objects'),
  }),
  'pack.installed': z.object({
    packKey: z.string(),
    version: z.string(),
    modes: z.array(z.string()),
    action: z.enum(['install', 'upgrade', 'sync']),
    summary: z.record(z.string(), z.number().int()),
  }),
  'pack.uninstalled': z.object({ packKey: z.string(), version: z.string().nullable() }),
  'record.created': z.object({ record: CustomRecordSchema }),
  'record.updated': z.object({ record: CustomRecordSchema, changed: z.array(z.string()).describe('Changed value keys, plus "ownerId"') }),
  'record.deleted': z.object({ objectKey: z.string(), recordIds: z.array(IdSchema) }),

  // change #19 wave B: CRM (fan-out by owner and permission like leads; see realtime/audience.ts)
  'contact.created': z.object({ contact: ContactListItemSchema }),
  'contact.updated': z.object({ contact: ContactListItemSchema, changed: z.array(z.string()) }),
  'contact.deleted': z.object({ contactIds: z.array(IdSchema) }),
  'contact.merged': z.object({ primaryId: IdSchema, mergedIds: z.array(IdSchema) }),
  'account.created': z.object({ account: AccountListItemSchema }),
  'account.updated': z.object({ account: AccountListItemSchema, changed: z.array(z.string()) }),
  'account.deleted': z.object({ accountIds: z.array(IdSchema) }),
  'account.merged': z.object({ primaryId: IdSchema, mergedIds: z.array(IdSchema) }),
  'deal.created': z.object({ deal: DealListItemSchema }),
  'deal.updated': z.object({ deal: DealListItemSchema, changed: z.array(z.string()) }),
  /** Board move (stage and/or position); also sent after a stage change through PATCH. */
  'deal.moved': z.object({ deal: DealListItemSchema, fromStageId: IdSchema.nullable(), toStageId: IdSchema, position: z.string() }),
  'deal.deleted': z.object({ dealIds: z.array(IdSchema) }),
  'quotation.created': z.object({ quotation: QuotationListItemSchema }),
  /** Any change incl. status (sent, accepted, rejected, expired, reopened) and share links. */
  'quotation.updated': z.object({ quotation: QuotationListItemSchema, changed: z.array(z.string()) }),
  'quotation.deleted': z.object({ quotationIds: z.array(IdSchema) }),
  'invoice.created': z.object({ invoice: InvoiceListItemSchema }),
  'invoice.updated': z.object({ invoice: InvoiceListItemSchema, changed: z.array(z.string()) }),
  'invoice.deleted': z.object({ invoiceIds: z.array(IdSchema) }),
  /** A payment was recorded or voided (`voided` true); the invoice carries the new paid and balance amounts. */
  'invoice.payment_recorded': z.object({ invoice: InvoiceListItemSchema, payment: PaymentSchema, voided: z.boolean() }),
  /** Products or price lists changed; clients refetch the catalog. */
  'catalog.changed': z.object({ scope: z.enum(['products', 'price_lists']), ids: z.array(IdSchema) }),
  'meeting.created': z.object({ meeting: MeetingSchema }),
  'meeting.updated': z.object({ meeting: MeetingSchema, changed: z.array(z.string()) }),
  'meeting.deleted': z.object({ meetingId: IdSchema, organizerId: IdSchema.nullable(), attendeeUserIds: z.array(IdSchema) }),
  /** Sent to each attending user's room (envelope userId) `minutesBefore` the occurrence start. */
  'meeting.reminder': z.object({ meeting: MeetingSchema, occurrenceStart: IsoDateTimeSchema, minutesBefore: z.number().int() }),
} as const;

export type EventName = keyof typeof eventPayloadSchemas;
export const EVENT_NAMES = Object.keys(eventPayloadSchemas) as EventName[];
export const EventNameSchema = z.enum(EVENT_NAMES as [EventName, ...EventName[]]);
export type EventPayload<E extends EventName> = z.infer<(typeof eventPayloadSchemas)[E]>;

/** Compile-time check (change #19 wave C): every outbound webhook event is a domain event (its body is the envelope). */
export const OUTBOUND_EVENTS_ARE_DOMAIN_EVENTS: readonly EventName[] = OUTBOUND_WEBHOOK_EVENTS;

/** Envelope for every domain event. `id` is a UUIDv7/ULID usable for dedupe. */
export interface DomainEvent<E extends EventName = EventName> {
  id: string;
  type: E;
  workspaceId: string;
  occurredAt: string;
  actor: EventActor | null;
  /** If set, deliver only to this user's room instead of the whole workspace. */
  userId?: string | null;
  payload: EventPayload<E>;
}

export const domainEventSchema = <E extends EventName>(type: E) =>
  z.object({
    id: z.string(),
    type: z.literal(type),
    workspaceId: IdSchema,
    occurredAt: IsoDateTimeSchema,
    actor: EventActorSchema.nullable(),
    userId: IdSchema.nullable().optional(),
    payload: eventPayloadSchemas[type],
  });

/** Parse an unknown envelope (e.g. from Redis or a test). Throws on invalid input. */
export function parseDomainEvent(raw: unknown): DomainEvent {
  const head = z.object({ type: EventNameSchema }).parse(raw);
  return domainEventSchema(head.type).parse(raw) as DomainEvent;
}

/** Query-cache scopes the client should invalidate after a resync. */
export const SYNC_SCOPES = ['leads', 'board', 'tasks', 'calls', 'conversations', 'notifications', 'dashboard', 'team-floor', 'workflows', 'customization', 'records', 'presence', 'attendance', 'workspace', 'contacts', 'accounts', 'deals', 'products', 'quotations', 'invoices', 'calendar', 'routing', 'capture-forms', /* change #19 wave C: hub */ 'integrations', 'webhooks', 'api-keys'] as const;
export type SyncScope = (typeof SYNC_SCOPES)[number];

/**
 * Socket.IO handshake (namespace /realtime, path /socket.io), for the web and the Android app alike:
 * `io(url + '/realtime', { auth: { token, client, appVersion } })` with a WORKSPACE access token
 * (platform tokens are rejected with connect_error "AUTH_TOKEN_INVALID"). When the token expires the server
 * emits `auth.expired` and disconnects; the client refreshes (POST /auth/refresh) and reconnects. A socket
 * counts as a heartbeat source while connected (presence.heartbeat every HEARTBEAT_INTERVAL_MS).
 */
export const SocketAuthSchema = z.object({
  token: z.string().min(10),
  client: z.enum(['web', 'android']).optional(),
  appVersion: z.string().max(40).optional(),
});
export type SocketAuth = z.infer<typeof SocketAuthSchema>;

export const HeartbeatSchema = z.object({
  /** Client-reported activity. Server combines with call events to compute presence. */
  activity: z.enum(['active', 'idle', 'hidden']),
  currentLeadId: IdSchema.nullable().optional(),
  client: z.enum(['web', 'android']).optional(),
  deviceId: z.string().max(64).optional(),
  /** Screen the user has open (same as PresenceHeartbeatSchema.screen; requests-19 #3). */
  screen: AppScreenSchema.optional(),
  /** Latest zone observation (Android app; parity with POST /me/presence/heartbeat). */
  zone: ZoneSignalSchema.optional(),
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;
/** Heartbeat every 15 s (socket or POST /me/presence/heartbeat). */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** No heartbeat for this long -> offline with "last seen" (D-062: 45 s). */
export const PRESENCE_TIMEOUT_MS = 45_000;

export type Ack = (res: { ok: true } | { ok: false; error: string }) => void;

/** Socket.IO typing: server -> client. */
export type ServerToClientEvents = {
  [E in EventName]: (event: DomainEvent<E>) => void;
} & {
  'sync.required': (payload: { scopes: SyncScope[]; reason: 'reconnect' | 'server_restart' | 'gap' }) => void;
  /** The access token expired; refresh and reconnect. */
  'auth.expired': (payload: { reason: 'expired' | 'revoked' }) => void;
};

/** Socket.IO typing: client -> server. */
export interface ClientToServerEvents {
  'presence.heartbeat': (payload: Heartbeat) => void;
  'room.join': (payload: { room: string }, ack: Ack) => void;
  'room.leave': (payload: { room: string }, ack: Ack) => void;
}

export interface SocketData {
  userId: string;
  workspaceId: string;
  role: string;
}
