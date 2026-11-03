import {
  inboundWebhookPath,
  WEBHOOK_MAX_ATTEMPTS,
  WebhookAttemptSchema,
  type OutboundWebhookEvent,
  type PayloadMapping,
  type WebhookAttempt,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookMatchKey,
} from '@vistar/shared';
import { z } from 'zod';
import { getEnv } from '../../config/env.js';
import type { WebhookDelivery as DeliveryRow, WebhookEndpoint as EndpointRow } from '../../generated/prisma/client.js';
import { hmacSha256Hex } from '../../infra/crypto/secrets.js';

export type { DeliveryRow, EndpointRow };

/**
 * Zero-config inbound mapping (used when a source has no mapping yet): common field names of website forms, Zapier,
 * Pabbly, JustDial / Facebook lead exports.
 */
export const DEFAULT_INBOUND_MAPPING: PayloadMapping = {
  fields: [
    { from: 'name || full_name || fullName || contact_name || first_name + last_name || firstName + lastName', to: 'name', transform: 'trim' },
    { from: 'phone || mobile || phone_number || mobile_number || phoneNumber || mobileNumber || contact_number || whatsapp', to: 'phone', transform: 'phone_in' },
    { from: 'email || email_address || emailAddress', to: 'email', transform: 'lower' },
    { from: 'company || company_name || companyName || organisation || organization', to: 'companyName', transform: 'trim' },
    { from: 'city', to: 'city', transform: 'trim' },
    { from: 'state', to: 'state', transform: 'trim' },
    { from: 'product || product_name || productName || service', to: 'productInterest', transform: 'trim' },
    { from: 'message || requirement || comments || notes || enquiry || inquiry', to: 'requirement', transform: 'none' },
    { from: 'id || lead_id || leadId || reference', to: 'sourceRef', transform: 'trim' },
  ],
  defaults: {},
};

const KEEP_HEADERS = new Set(['content-type', 'user-agent', 'idempotency-key', 'x-vistar-event', 'x-vistar-delivery', 'x-vistar-timestamp', 'x-request-id', 'x-forwarded-for']);
const REDACT_HEADERS = new Set(['x-vistar-signature', 'x-vistar-token', 'x-hub-signature-256', 'authorization', 'cookie']);

/** Headers safe to store: a small allowlist; signatures and tokens become "[redacted]". */
export function redactHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (REDACT_HEADERS.has(key)) out[key] = '[redacted]';
    else if (KEEP_HEADERS.has(key)) out[key] = (Array.isArray(v) ? v.join(', ') : String(v ?? '')).slice(0, 300);
  }
  return out;
}

/** X-Vistar-Signature value: t=<unix>,v1=<hex>[,v1=<hex>] (one v1 per secret, current first). */
export function signatureHeader(secrets: readonly string[], timestamp: number, rawBody: string): string {
  return [`t=${timestamp}`, ...secrets.map((s) => `v1=${hmacSha256Hex(s, `${timestamp}.${rawBody}`)}`)].join(',');
}

const AttemptsSchema = z.array(WebhookAttemptSchema);
export const attemptsOf = (row: Pick<DeliveryRow, 'attempts'>): WebhookAttempt[] => {
  const parsed = AttemptsSchema.safeParse(row.attempts);
  return parsed.success ? parsed.data : [];
};

const ResultSchema = z.object({ action: z.string().nullable(), leadId: z.string().nullable(), runId: z.string().nullable(), duplicate: z.boolean(), captured: z.boolean() });

/** Outbound test deliveries (POST /webhooks/endpoints/{id}/test) have no eventId and are tried once. */
export const isTestDelivery = (d: Pick<DeliveryRow, 'direction' | 'eventId' | 'replayOfId'>) => d.direction === 'outbound' && !d.eventId && !d.replayOfId;

export function toDeliveryDto(d: DeliveryRow, endpointName: string): WebhookDelivery {
  const result = ResultSchema.safeParse(d.result);
  const maxAttempts = d.direction === 'inbound' || isTestDelivery(d) ? 1 : WEBHOOK_MAX_ATTEMPTS;
  return {
    id: d.id,
    endpointId: d.endpointId,
    endpointName,
    direction: d.direction,
    event: d.event,
    status: d.status,
    attempt: d.attempt,
    maxAttempts,
    attempts: attemptsOf(d),
    requestHeaders: (d.requestHeaders ?? {}) as Record<string, string>,
    requestBody: d.requestBody ?? null,
    responseStatus: d.responseStatus,
    responseBody: d.responseBody,
    latencyMs: d.latencyMs,
    error: d.error,
    idempotencyKey: d.idempotencyKey,
    replayOfId: d.replayOfId,
    nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
    signatureValid: d.direction === 'inbound' ? (d.signatureValid ?? null) : null,
    result: d.direction === 'inbound' && result.success ? result.data : null,
    canReplay: d.direction === 'outbound' ? d.status !== 'pending' && d.requestBody !== null : d.signatureValid === true && d.requestBody !== null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toEndpointDto(e: EndpointRow, stats: { deliveries24h: number; failures24h: number } = { deliveries24h: 0, failures24h: 0 }): WebhookEndpoint {
  const api = getEnv().API_PUBLIC_URL.replace(/\/$/, '');
  const inbound = e.direction === 'inbound';
  const graceOn = !!e.previousSecretExpiresAt && e.previousSecretExpiresAt.getTime() > Date.now();
  return {
    id: e.id,
    direction: e.direction,
    name: e.name,
    isActive: e.isActive,
    sourceKey: inbound ? e.sourceKey : null,
    inboundUrl: inbound && e.sourceKey ? `${api}${inboundWebhookPath(e.workspaceId, e.sourceKey)}` : null,
    action: inbound ? e.action : null,
    workflowId: e.workflowId,
    mapping: inbound ? ((e.mapping as PayloadMapping | null) ?? null) : null,
    verification: inbound ? (e.verification ?? 'hmac') : null,
    matchBy: inbound ? (e.matchBy as WebhookMatchKey[]) : [],
    createIfMissing: e.createIfMissing,
    samplePayload: inbound ? (e.samplePayload ?? null) : null,
    sampleCapturedAt: e.sampleCapturedAt?.toISOString() ?? null,
    captureUntil: e.captureUntil && e.captureUntil.getTime() > Date.now() ? e.captureUntil.toISOString() : null,
    url: inbound ? null : e.url,
    events: inbound ? [] : (e.events as OutboundWebhookEvent[]),
    secretPreview: `…${e.secretLast4}`,
    secretRotatedAt: e.secretRotatedAt?.toISOString() ?? null,
    previousSecretExpiresAt: graceOn ? e.previousSecretExpiresAt!.toISOString() : null,
    disabledAt: e.disabledAt?.toISOString() ?? null,
    disabledReason: e.disabledReason,
    consecutiveFailures: e.consecutiveFailures,
    deadStreak: e.deadStreak,
    lastDeliveryAt: e.lastDeliveryAt?.toISOString() ?? null,
    lastSuccessAt: e.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: e.lastFailureAt?.toISOString() ?? null,
    stats,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
