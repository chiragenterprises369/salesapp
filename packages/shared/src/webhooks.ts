/**
 * Webhook signing contract (inbound verification and outbound signing).
 *
 * Header:   X-Vistar-Signature: t=<unix-seconds>,v1=<hex hmac>
 * Signed:   `${t}.${rawBody}` with HMAC-SHA256 and the endpoint secret
 * Tolerance: |now - t| <= WEBHOOK_TOLERANCE_SEC, else WEBHOOK_TIMESTAMP_EXPIRED
 * Compare:  constant-time (crypto.timingSafeEqual)
 * Idempotency: `Idempotency-Key` header (or X-Vistar-Delivery for outbound). Duplicate inbound keys
 *              within 24h return 200 with the original result and do not re-process.
 * Third-party sources with their own scheme (WhatsApp X-Hub-Signature-256, IndiaMART key) are
 * verified by their adapters in apps/api/src/modules/integrations.
 */
export const WEBHOOK_HEADERS = {
  signature: 'x-vistar-signature',
  event: 'x-vistar-event',
  delivery: 'x-vistar-delivery',
  idempotencyKey: 'idempotency-key',
  timestamp: 'x-vistar-timestamp',
} as const;

export const WEBHOOK_TOLERANCE_SEC = 300;
export const WEBHOOK_IDEMPOTENCY_TTL_SEC = 86_400;

/** Outbound retry schedule (seconds after the previous attempt). After the last one -> dead-letter. */
export const WEBHOOK_RETRY_DELAYS_SEC = [60, 300, 1800, 7200, 21_600, 86_400] as const;
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_RESPONSE_BYTES = 4096;

/** Events available to outbound webhook subscriptions. */
export const OUTBOUND_WEBHOOK_EVENTS = [
  'lead.created',
  'lead.updated',
  'lead.assigned',
  'stage.changed',
  'call.ended',
  'message.received',
  'task.overdue',
  'workflow.failed',
] as const;
export type OutboundWebhookEvent = (typeof OUTBOUND_WEBHOOK_EVENTS)[number];

/** Inbound URL path (served without the /v1 prefix). */
export const inboundWebhookPath = (workspaceId: string, sourceKey: string) => `/api/hooks/${workspaceId}/${sourceKey}`;

export interface ParsedSignature {
  timestamp: number;
  signatures: string[];
}

/** Parse `t=...,v1=...[,v1=...]`. Returns null when malformed. */
export function parseSignatureHeader(header: string | undefined | null): ParsedSignature | null {
  if (!header) return null;
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (!k || !v) continue;
    if (k === 't') timestamp = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) signatures.push(v.toLowerCase());
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export function formatSignatureHeader(timestamp: number, hexSignature: string): string {
  return `t=${timestamp},v1=${hexSignature}`;
}
