import { z } from 'zod';
import {
  ApiKeyStatusSchema,
  InboundWebhookActionSchema,
  IntegrationAvailabilitySchema,
  IntegrationModeSchema,
  IntegrationProviderSchema,
  IntegrationStatusSchema,
  TelephonyProviderSchema,
  WebhookDeliveryStatusSchema,
  WebhookDirectionSchema,
  WebhookMatchKeySchema,
  WebhookVerificationSchema,
} from '../enums.js';
import { API_KEY_MAX_RATE_LIMIT_PER_MIN, API_KEY_ROTATION_GRACE_DEFAULT_MIN, API_KEY_ROTATION_GRACE_MAX_MIN, ApiKeyScopeSchema, FeatureFlagSchema } from '../rbac.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateTimeSchema } from './common.js';
import { LeadImportFieldSchema } from './lead.js';
import { UserSummarySchema } from './workspace.js';
import {
  OUTBOUND_WEBHOOK_EVENTS,
  RESERVED_SOURCE_KEYS,
  WEBHOOK_CAPTURE_DEFAULT_MIN,
  WEBHOOK_CAPTURE_MAX_MIN,
  WEBHOOK_SECRET_GRACE_DEFAULT_HOURS,
  WEBHOOK_SECRET_GRACE_MAX_HOURS,
} from '../webhooks.js';

/*
 * Integration hub, inbound / outbound webhooks and API keys (SPEC 15.5; change #19 wave C, D-069, D-070).
 * Secrets are write-only: accepted on connect, encrypted with ENCRYPTION_KEY, never returned (only a masked
 * hint like "••••a9f2"). Tokens Vistar generates for a provider to call us (IndiaMART push key, WhatsApp verify
 * token, telephony callback token) are shown to integrations.manage holders in `endpoints` so they can be copied.
 */

// ---------------------------------------------------------------- integration hub

export const IntegrationProviderParamSchema = z.object({ provider: IntegrationProviderSchema });
export type IntegrationProviderParam = z.infer<typeof IntegrationProviderParamSchema>;

export const INTEGRATION_FIELD_TYPES = ['text', 'password', 'number', 'boolean', 'select', 'email', 'tags'] as const;
export const IntegrationFieldTypeSchema = z.enum(INTEGRATION_FIELD_TYPES);

/** One field of a provider's connect form (catalog). `secret` fields go in `secrets`, the rest in `config`. */
export const IntegrationFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: IntegrationFieldTypeSchema,
  secret: z.boolean(),
  required: z.boolean().describe('Required in live mode; mock mode needs no credentials'),
  placeholder: z.string().nullable(),
  help: z.string().nullable(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).nullable(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).nullable(),
  /** Show the field only when another config field has this value (e.g. Exotel fields when provider = exotel). */
  showIf: z.object({ key: z.string(), equals: z.union([z.string(), z.boolean()]) }).nullable(),
});
export type IntegrationField = z.infer<typeof IntegrationFieldSchema>;

export const INTEGRATION_CATEGORIES = ['leads', 'messaging', 'calls', 'email', 'calendar'] as const;

export const IntegrationCapabilitiesSchema = z.object({
  test: z.boolean(),
  sync: z.boolean().describe('"Sync now" button'),
  push: z.boolean().describe('The provider calls a Vistar URL (IndiaMART push, WhatsApp webhook, telephony callbacks)'),
  oauth: z.boolean().describe('Connect through a provider sign-in (Google)'),
  mock: z.boolean().describe('A dev mock mode exists'),
});

/** Catalog entry (static part in INTEGRATION_CATALOG; availability and enabled are computed per request). */
export const IntegrationProviderInfoSchema = z.object({
  provider: IntegrationProviderSchema,
  label: z.string(),
  description: z.string(),
  category: z.enum(INTEGRATION_CATEGORIES),
  /** Plan feature the provider needs (whatsapp, telephony); null = every plan. */
  featureFlag: FeatureFlagSchema.nullable(),
  fields: z.array(IntegrationFieldSchema),
  setupSteps: z.array(z.string()).describe('Plain-language steps for the connect sheet'),
  capabilities: IntegrationCapabilitiesSchema,
  docsUrl: z.string().url().nullable(),
  availability: IntegrationAvailabilitySchema,
  availabilityNote: z.string().nullable(),
  /** The workspace plan has the feature (featureFlag) or the provider needs none. */
  enabled: z.boolean(),
});
export type IntegrationProviderInfo = z.infer<typeof IntegrationProviderInfoSchema>;

/** Per-provider config (non-secret) and secrets. Validated server-side on connect (live mode). */
export const IndiamartConfigSchema = z.object({
  pullEnabled: z.boolean().default(true),
  pullIntervalMin: z.number().int().min(5).max(60).default(15).describe('IndiaMART allows one pull per 5 minutes'),
  pushEnabled: z.boolean().default(false),
  /** Tags added to every IndiaMART lead. */
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});
export const IndiamartSecretsSchema = z.object({ crmKey: z.string().min(10).max(300).describe('Pull API key (glusr_crm_key)') });
export const WhatsappCloudConfigSchema = z.object({
  phoneNumberId: z.string().regex(/^\d{5,25}$/, { error: 'Phone number ID is a number from the Meta app (WhatsApp > API setup)' }),
  wabaId: z.string().regex(/^\d{5,25}$/).optional(),
  displayPhoneNumber: z.string().max(30).optional(),
});
export const WhatsappCloudSecretsSchema = z.object({
  accessToken: z.string().min(20).max(2000).describe('System user access token'),
  appSecret: z.string().min(16).max(200).describe('App secret (verifies X-Hub-Signature-256)'),
});
export const TelephonyConfigSchema = z.object({
  provider: TelephonyProviderSchema.default('exotel'),
  accountSid: z.string().max(100).optional(),
  subdomain: z.enum(['api.exotel.com', 'api.in.exotel.com']).default('api.in.exotel.com'),
  callerId: z.string().max(20).optional().describe('ExoPhone shown to customers'),
  recordCalls: z.boolean().default(true),
});
export const TelephonySecretsSchema = z.object({ apiKey: z.string().min(1).max(200), apiToken: z.string().min(1).max(200) });
export const SmtpConfigSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false).describe('true = TLS from the start (port 465); false = STARTTLS when offered'),
  username: z.string().max(255).optional(),
  fromEmail: z.email(),
  fromName: z.string().max(100).optional(),
});
export const SmtpSecretsSchema = z.object({ password: z.string().max(500).optional() });
export const GoogleCalendarConfigSchema = z.object({
  calendarId: z.string().max(200).default('primary'),
  pushMeetings: z.boolean().default(true).describe('Copy Vistar meetings to this calendar (follow-up)'),
});
/** OAuth tokens are stored by the callback; nothing is posted. */
export const GoogleCalendarSecretsSchema = z.object({});

export const INTEGRATION_CONFIG_SCHEMAS = {
  indiamart: { config: IndiamartConfigSchema, secrets: IndiamartSecretsSchema },
  whatsapp_cloud: { config: WhatsappCloudConfigSchema, secrets: WhatsappCloudSecretsSchema },
  telephony: { config: TelephonyConfigSchema, secrets: TelephonySecretsSchema },
  smtp: { config: SmtpConfigSchema, secrets: SmtpSecretsSchema },
  google_calendar: { config: GoogleCalendarConfigSchema, secrets: GoogleCalendarSecretsSchema },
} as const;

/** URLs and tokens a provider needs to call Vistar. Null for read-only callers and for providers without them. */
export const IntegrationEndpointsSchema = z.object({
  /** IndiaMART push URL including `?key=` (paste into Lead Manager > Push API). */
  pushUrl: z.string().url().nullable(),
  /** WhatsApp Cloud API callback URL for this workspace's Meta app. */
  webhookUrl: z.string().url().nullable(),
  /** WhatsApp verify token (Meta asks for it with the callback URL). */
  verifyToken: z.string().nullable(),
  /** Telephony status callback URL including `?token=`. */
  callbackUrl: z.string().url().nullable(),
  /** Google OAuth redirect URI to register in the Google Cloud console. */
  oauthRedirectUri: z.string().url().nullable(),
});
export type IntegrationEndpoints = z.infer<typeof IntegrationEndpointsSchema>;

/**
 * One provider in the hub. GET /integrations returns all five providers; never-connected ones have
 * id null and status not_connected.
 */
export const IntegrationSchema = z.object({
  id: IdSchema.nullable(),
  provider: IntegrationProviderSchema,
  status: IntegrationStatusSchema,
  mode: IntegrationModeSchema,
  displayName: z.string(),
  config: z.record(z.string(), z.unknown()).describe('Non-secret config only'),
  hasSecrets: z.boolean(),
  /** Masked hint per stored secret field, e.g. { crmKey: "••••a9f2" }. */
  secretHints: z.record(z.string(), z.string()),
  lastCheckedAt: IsoDateTimeSchema.nullable(),
  lastError: z.string().nullable(),
  lastSyncAt: IsoDateTimeSchema.nullable(),
  nextSyncAt: IsoDateTimeSchema.nullable(),
  /** Why the status is needs_attention (what the admin should do). */
  attention: z.string().nullable(),
  connectedAt: IsoDateTimeSchema.nullable(),
  connectedBy: UserSummarySchema.nullable(),
  endpoints: IntegrationEndpointsSchema.nullable(),
  /** Provider numbers for the card, e.g. { leadsImported30d: 42, lastPulledCount: 3, messagesReceived30d: 120 }. */
  stats: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
  availability: IntegrationAvailabilitySchema,
  availabilityNote: z.string().nullable(),
  enabled: z.boolean().describe('Plan feature present (whatsapp, telephony)'),
  updatedAt: IsoDateTimeSchema.nullable(),
});
export type Integration = z.infer<typeof IntegrationSchema>;

export const IntegrationConnectSchema = z.object({
  mode: IntegrationModeSchema.default('live').describe('mock is refused in production'),
  displayName: z.string().trim().min(1).max(80).optional(),
  config: z.record(z.string(), z.unknown()).default({}).describe('Validated with INTEGRATION_CONFIG_SCHEMAS[provider].config'),
  secrets: z
    .record(z.string(), z.string().max(4000))
    .default({})
    .describe('Encrypted at rest; never echoed back. Omitted keys keep the stored value; "" removes it'),
  /** Run the connection test right after saving (status follows the result). */
  test: z.boolean().default(true),
});
export type IntegrationConnect = z.infer<typeof IntegrationConnectSchema>;

/** Optional body of POST /integrations/{provider}/test (SMTP: test e-mail recipient, default the caller). */
export const IntegrationTestRequestSchema = z.object({ to: z.email().optional() }).prefault({});
export type IntegrationTestRequest = z.infer<typeof IntegrationTestRequestSchema>;

export const IntegrationTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number().int().nullable(),
  integration: IntegrationSchema,
});
export type IntegrationTestResult = z.infer<typeof IntegrationTestResultSchema>;

export const IntegrationSyncResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  fetched: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int().describe('Duplicates (e.g. IndiaMART UNIQUE_QUERY_ID already imported)'),
  windowStart: IsoDateTimeSchema.nullable(),
  windowEnd: IsoDateTimeSchema.nullable(),
  integration: IntegrationSchema,
});
export type IntegrationSyncResult = z.infer<typeof IntegrationSyncResultSchema>;

export const IntegrationOAuthStartSchema = z.object({ authUrl: z.string().url(), expiresAt: IsoDateTimeSchema });
export type IntegrationOAuthStart = z.infer<typeof IntegrationOAuthStartSchema>;

export const OAuthCallbackQuerySchema = z.object({
  code: z.string().max(2000).optional(),
  state: z.string().max(2000),
  error: z.string().max(200).optional(),
});

/** IndiaMART push receiver result (IndiaMART only needs a 200). */
export const IndiamartPushResultSchema = z.object({ ok: z.literal(true), duplicate: z.boolean(), leadId: IdSchema.nullable() });

export const WhatsappVerifyQuerySchema = z.object({ 'hub.mode': z.string(), 'hub.verify_token': z.string(), 'hub.challenge': z.string().max(200) });

export const TelephonyProviderParamSchema = z.object({ workspaceId: IdSchema, provider: TelephonyProviderSchema });

// ---------------------------------------------------------------- inbound payload mapping

/**
 * Transforms: trim, lower, upper, phone_in (Indian mobile or E.164 -> E.164), number (digits and dot; "₹1,25,000" ->
 * 125000), first_name / last_name (split a full name at the first space).
 */
export const MAPPING_TRANSFORMS = ['none', 'trim', 'lower', 'upper', 'phone_in', 'number', 'first_name', 'last_name'] as const;
export const MappingTransformSchema = z.enum(MAPPING_TRANSFORMS);
export type MappingTransform = z.infer<typeof MappingTransformSchema>;

/**
 * Path expressions (see mapping.ts): `data.customer.mobile`, `$.items[0].name`, `entry.0.id`, fallbacks with `||`
 * (`mobile || phone`), joins with `+` (`first_name + last_name`, joined by one space) and quoted constants (`"IndiaMART"`).
 */
export const PayloadMappingFieldSchema = z.object({
  from: z.string().trim().min(1).max(500),
  to: LeadImportFieldSchema.describe('LEAD_IMPORT_FIELDS value or custom.<key>'),
  transform: MappingTransformSchema.default('none'),
});
export const PayloadMappingSchema = z.object({
  fields: z.array(PayloadMappingFieldSchema).max(60),
  /** Constants per lead field, used when the mapped value is empty (e.g. { "source": "website", "tags": "facebook" }). */
  defaults: z.record(z.string(), z.string().max(500)).default({}),
});
export type PayloadMapping = z.infer<typeof PayloadMappingSchema>;

export const OutboundEventSchema = z.enum(OUTBOUND_WEBHOOK_EVENTS);

// ---------------------------------------------------------------- webhook endpoints

export const WebhookEndpointSchema = z.object({
  id: IdSchema,
  direction: WebhookDirectionSchema,
  name: z.string(),
  isActive: z.boolean(),
  // inbound
  sourceKey: z.string().nullable().describe('Inbound URL: POST /api/hooks/{workspaceId}/{sourceKey}'),
  inboundUrl: z.string().url().nullable(),
  action: InboundWebhookActionSchema.nullable(),
  workflowId: IdSchema.nullable(),
  mapping: PayloadMappingSchema.nullable(),
  verification: WebhookVerificationSchema.nullable(),
  matchBy: z.array(WebhookMatchKeySchema),
  createIfMissing: z.boolean(),
  samplePayload: z.unknown().nullable().describe('Captured or pasted sample (inbound)'),
  sampleCapturedAt: IsoDateTimeSchema.nullable(),
  /** Capture mode: requests until this time are stored as the sample and not processed. */
  captureUntil: IsoDateTimeSchema.nullable(),
  // outbound
  url: z.string().url().nullable(),
  events: z.array(OutboundEventSchema),
  // both
  secretPreview: z.string().describe('Last 4 chars only, e.g. "…a9f2"'),
  secretRotatedAt: IsoDateTimeSchema.nullable(),
  /** During a rotation grace the previous secret is still accepted (inbound) and also signed with (outbound). */
  previousSecretExpiresAt: IsoDateTimeSchema.nullable(),
  /** Set when Vistar switched the endpoint off (WEBHOOK_AUTO_DISABLE_AFTER_DEAD dead deliveries in a row). */
  disabledAt: IsoDateTimeSchema.nullable(),
  disabledReason: z.string().nullable(),
  consecutiveFailures: z.number().int().describe('Failed attempts since the last success'),
  deadStreak: z.number().int().describe('Dead deliveries in a row'),
  lastDeliveryAt: IsoDateTimeSchema.nullable(),
  lastSuccessAt: IsoDateTimeSchema.nullable(),
  lastFailureAt: IsoDateTimeSchema.nullable(),
  stats: z.object({ deliveries24h: z.number().int(), failures24h: z.number().int() }),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;

export const WebhookEndpointListQuerySchema = z.object({ direction: WebhookDirectionSchema.optional() });

const SourceKeySchema = z
  .string()
  .regex(/^[a-z0-9-]{3,40}$/, { error: '3 to 40 lowercase letters, digits or dashes' })
  .refine((k) => !(RESERVED_SOURCE_KEYS as readonly string[]).includes(k), { error: 'This name is reserved' });

export const InboundEndpointCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    sourceKey: SourceKeySchema,
    action: InboundWebhookActionSchema.default('create_lead'),
    workflowId: IdSchema.optional(),
    mapping: PayloadMappingSchema.optional(),
    verification: WebhookVerificationSchema.default('hmac'),
    matchBy: z.array(WebhookMatchKeySchema).min(1).max(2).default(['phone', 'email']),
    createIfMissing: z.boolean().default(true),
    samplePayload: z.unknown().optional(),
  })
  .refine((b) => b.action !== 'start_workflow' || !!b.workflowId, { error: 'Pick the workflow to start', path: ['workflowId'] });
export type InboundEndpointCreate = z.infer<typeof InboundEndpointCreateSchema>;

/** https only; plain http only for localhost / 127.0.0.1 (the API also applies the SSRF guard and its dev allowlist). */
const httpsUrl = z
  .string()
  .url()
  .max(2000)
  .refine(
    (u) => {
      try {
        const url = new URL(u);
        return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
      } catch {
        return false;
      }
    },
    { error: 'Must be an https URL' },
  );
export const OutboundEndpointCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: httpsUrl,
  events: z.array(OutboundEventSchema).min(1),
  isActive: z.boolean().default(true),
});
export type OutboundEndpointCreate = z.infer<typeof OutboundEndpointCreateSchema>;

/** PATCH body without defaults (Zod 4 `.partial()` keeps defaults). isActive true also clears an auto-disable. */
export const WebhookEndpointUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    isActive: z.boolean(),
    action: InboundWebhookActionSchema,
    workflowId: IdSchema.nullable(),
    mapping: PayloadMappingSchema,
    verification: WebhookVerificationSchema,
    matchBy: z.array(WebhookMatchKeySchema).min(1).max(2),
    createIfMissing: z.boolean(),
    samplePayload: z.unknown().nullable(),
    url: httpsUrl,
    events: z.array(OutboundEventSchema).min(1),
  })
  .partial();
export type WebhookEndpointUpdate = z.infer<typeof WebhookEndpointUpdateSchema>;

/** Returned once at creation / rotation. */
export const WebhookSecretSchema = z.object({ secret: z.string() });
export const WebhookSecretRotatedSchema = WebhookSecretSchema.extend({ previousSecretExpiresAt: IsoDateTimeSchema.nullable() });
export const WebhookRotateSecretSchema = z
  .object({ graceHours: z.number().int().min(0).max(WEBHOOK_SECRET_GRACE_MAX_HOURS).default(WEBHOOK_SECRET_GRACE_DEFAULT_HOURS) })
  .prefault({});

export const WebhookCaptureSchema = z.object({
  enabled: z.boolean(),
  minutes: z.number().int().min(1).max(WEBHOOK_CAPTURE_MAX_MIN).default(WEBHOOK_CAPTURE_DEFAULT_MIN),
});
export type WebhookCapture = z.infer<typeof WebhookCaptureSchema>;

/** Test send: one signed attempt (no retries) with a `webhook.test` body, or a sample body of `event`. */
export const WebhookTestSendSchema = z.object({ event: OutboundEventSchema.optional() }).prefault({});

// ---------------------------------------------------------------- deliveries

export const WebhookAttemptSchema = z.object({
  attempt: z.number().int(),
  at: IsoDateTimeSchema,
  ok: z.boolean(),
  responseStatus: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type WebhookAttempt = z.infer<typeof WebhookAttemptSchema>;

export const WebhookDeliverySchema = z.object({
  id: IdSchema,
  endpointId: IdSchema,
  endpointName: z.string(),
  direction: WebhookDirectionSchema,
  event: z.string().nullable(),
  status: WebhookDeliveryStatusSchema,
  attempt: z.number().int(),
  maxAttempts: z.number().int(),
  attempts: z.array(WebhookAttemptSchema).describe('Attempt timeline, oldest first'),
  requestHeaders: z.record(z.string(), z.string()).describe('Sensitive headers redacted'),
  requestBody: z.unknown(),
  responseStatus: z.number().int().nullable(),
  responseBody: z.string().nullable().describe('Truncated to 4KB'),
  latencyMs: z.number().int().nullable(),
  error: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  replayOfId: IdSchema.nullable(),
  nextAttemptAt: IsoDateTimeSchema.nullable(),
  /** Inbound: signature / token check passed (null for outbound). */
  signatureValid: z.boolean().nullable(),
  /** Inbound: what Vistar did with it. */
  result: z
    .object({ action: z.string().nullable(), leadId: IdSchema.nullable(), runId: IdSchema.nullable(), duplicate: z.boolean(), captured: z.boolean() })
    .nullable(),
  canReplay: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

export const WebhookDeliveryQuerySchema = CursorPaginationQuerySchema.extend({
  endpointId: IdSchema.optional(),
  status: WebhookDeliveryStatusSchema.optional(),
  direction: WebhookDirectionSchema.optional(),
  event: z.string().max(60).optional(),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});
export type WebhookDeliveryQuery = z.infer<typeof WebhookDeliveryQuerySchema>;

export const MappingPreviewRequestSchema = z.object({ samplePayload: z.unknown(), mapping: PayloadMappingSchema });
export const MappingPreviewResponseSchema = z.object({
  lead: z.record(z.string(), z.unknown()),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
  /** Every leaf path in the sample (for the path picker tree). */
  paths: z.array(z.object({ path: z.string(), type: z.string(), sample: z.string().nullable() })),
});
export type MappingPreviewResponse = z.infer<typeof MappingPreviewResponseSchema>;

// ---------------------------------------------------------------- API keys

export const ApiKeySchema = z.object({
  id: IdSchema,
  name: z.string(),
  prefix: z.string().describe('API_KEY_DISPLAY_PREFIX_LENGTH chars, e.g. "vst_live_ab12"'),
  scopes: z.array(ApiKeyScopeSchema),
  status: ApiKeyStatusSchema,
  lastUsedAt: IsoDateTimeSchema.nullable(),
  /** IP of the last request (updated at most once a minute). */
  lastUsedIp: z.string().nullable(),
  /** Requests per minute; null = API_KEY_DEFAULT_RATE_LIMIT_PER_MIN. */
  rateLimitPerMinute: z.number().int().nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
  rotatedAt: IsoDateTimeSchema.nullable(),
  /** After a rotation the old key works until this time. */
  previousKeyExpiresAt: IsoDateTimeSchema.nullable(),
  createdBy: UserSummarySchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const ApiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(ApiKeyScopeSchema).min(1).describe('Each scope must be a permission the creator holds (API_KEY_SCOPE_NOT_ALLOWED)'),
  expiresAt: IsoDateTimeSchema.optional().describe('Must be in the future'),
  rateLimitPerMinute: z.number().int().min(10).max(API_KEY_MAX_RATE_LIMIT_PER_MIN).optional(),
});
export type ApiKeyCreate = z.infer<typeof ApiKeyCreateSchema>;

export const ApiKeyUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    rateLimitPerMinute: z.number().int().min(10).max(API_KEY_MAX_RATE_LIMIT_PER_MIN).nullable(),
  })
  .partial();
export type ApiKeyUpdate = z.infer<typeof ApiKeyUpdateSchema>;

export const ApiKeyRotateSchema = z
  .object({ graceMinutes: z.number().int().min(0).max(API_KEY_ROTATION_GRACE_MAX_MIN).default(API_KEY_ROTATION_GRACE_DEFAULT_MIN) })
  .prefault({});

/** The plaintext key is returned exactly once. */
export const ApiKeyCreatedSchema = ApiKeySchema.extend({ key: z.string() });
export type ApiKeyCreated = z.infer<typeof ApiKeyCreatedSchema>;

/** Scope picker: every API key scope, grouped by resource, with `allowed` = the caller holds that permission. */
export const ApiKeyScopeOptionSchema = z.object({
  scope: ApiKeyScopeSchema,
  resource: z.string(),
  action: z.string(),
  label: z.string(),
  allowed: z.boolean(),
});
export type ApiKeyScopeOption = z.infer<typeof ApiKeyScopeOptionSchema>;

/** GET /api/v1/openapi.json: OpenAPI 3.1 document of the public API (routes that accept API keys). */
export const PublicOpenApiDocumentSchema = z.record(z.string(), z.unknown()).describe('OpenAPI 3.1 document');
