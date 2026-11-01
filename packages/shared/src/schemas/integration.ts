import { z } from 'zod';
import {
  InboundWebhookActionSchema,
  IntegrationProviderSchema,
  IntegrationStatusSchema,
  WebhookDeliveryStatusSchema,
  WebhookDirectionSchema,
} from '../enums.js';
import { ApiKeyScopeSchema } from '../rbac.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateTimeSchema } from './common.js';
import { OUTBOUND_WEBHOOK_EVENTS } from '../webhooks.js';

/** Secrets are write-only: accepted on connect/update, never returned. */
export const IntegrationSchema = z.object({
  id: IdSchema,
  provider: IntegrationProviderSchema,
  status: IntegrationStatusSchema,
  displayName: z.string(),
  config: z.record(z.string(), z.unknown()).describe('Non-secret config only'),
  hasSecrets: z.boolean(),
  lastCheckedAt: IsoDateTimeSchema.nullable(),
  lastError: z.string().nullable(),
  connectedAt: IsoDateTimeSchema.nullable(),
});
export type Integration = z.infer<typeof IntegrationSchema>;

export const IntegrationConnectSchema = z.object({
  config: z.record(z.string(), z.unknown()).default({}),
  secrets: z.record(z.string(), z.string()).default({}).describe('Encrypted at rest; never echoed back'),
});
export type IntegrationConnect = z.infer<typeof IntegrationConnectSchema>;

export const IntegrationTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number().int().nullable(),
});

/** Inbound payload mapping: JSON path in the incoming body -> lead field. */
export const PayloadMappingSchema = z.object({
  fields: z.array(
    z.object({
      from: z.string().describe('Dot/JSONPath-lite path, e.g. "data.customer.mobile"'),
      to: z.string().describe('LEAD_IMPORT_FIELDS value or custom.<key>'),
      transform: z.enum(['none', 'trim', 'lower', 'phone_in', 'number']).default('none'),
    }),
  ),
  defaults: z.record(z.string(), z.string()).default({}),
});
export type PayloadMapping = z.infer<typeof PayloadMappingSchema>;

export const OutboundEventSchema = z.enum(OUTBOUND_WEBHOOK_EVENTS);

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
  // outbound
  url: z.string().url().nullable(),
  events: z.array(OutboundEventSchema),
  secretPreview: z.string().describe('Last 4 chars only, e.g. "…a9f2"'),
  createdAt: IsoDateTimeSchema,
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;

export const InboundEndpointCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sourceKey: z.string().regex(/^[a-z0-9-]{3,40}$/),
  action: InboundWebhookActionSchema.default('create_lead'),
  workflowId: IdSchema.optional(),
  mapping: PayloadMappingSchema.optional(),
});
export const OutboundEndpointCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url().refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), {
    error: 'Must be https',
  }),
  events: z.array(OutboundEventSchema).min(1),
});

/** Returned once at creation / rotation. */
export const WebhookSecretSchema = z.object({ secret: z.string() });

export const WebhookDeliverySchema = z.object({
  id: IdSchema,
  endpointId: IdSchema,
  direction: WebhookDirectionSchema,
  event: z.string().nullable(),
  status: WebhookDeliveryStatusSchema,
  attempt: z.number().int(),
  requestHeaders: z.record(z.string(), z.string()).describe('Sensitive headers redacted'),
  requestBody: z.unknown(),
  responseStatus: z.number().int().nullable(),
  responseBody: z.string().nullable().describe('Truncated to 4KB'),
  latencyMs: z.number().int().nullable(),
  error: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  replayOfId: IdSchema.nullable(),
  nextAttemptAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

export const WebhookDeliveryQuerySchema = CursorPaginationQuerySchema.extend({
  endpointId: IdSchema.optional(),
  status: WebhookDeliveryStatusSchema.optional(),
  direction: WebhookDirectionSchema.optional(),
});

export const MappingPreviewRequestSchema = z.object({ samplePayload: z.unknown(), mapping: PayloadMappingSchema });
export const MappingPreviewResponseSchema = z.object({
  lead: z.record(z.string(), z.unknown()),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});

export const ApiKeySchema = z.object({
  id: IdSchema,
  name: z.string(),
  prefix: z.string().describe('First 8 chars, e.g. "vst_live_ab12"'),
  scopes: z.array(ApiKeyScopeSchema),
  lastUsedAt: IsoDateTimeSchema.nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const ApiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(ApiKeyScopeSchema).min(1),
  expiresAt: IsoDateTimeSchema.optional(),
});
/** The plaintext key is returned exactly once. */
export const ApiKeyCreatedSchema = ApiKeySchema.extend({ key: z.string() });
export type ApiKeyCreated = z.infer<typeof ApiKeyCreatedSchema>;
