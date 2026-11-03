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
  /** Inbound sources with verification `token` (change #19 wave C); `?token=` works too. */
  token: 'x-vistar-token',
} as const;

export const WEBHOOK_TOLERANCE_SEC = 300;
export const WEBHOOK_IDEMPOTENCY_TTL_SEC = 86_400;

/** Outbound retry schedule (seconds after the previous attempt). After the last one -> dead-letter. */
export const WEBHOOK_RETRY_DELAYS_SEC = [60, 300, 1800, 7200, 21_600, 86_400] as const;
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_RESPONSE_BYTES = 4096;

/** Events available to outbound webhook subscriptions: SPEC 15.5 plus (wave C) the wave B CRM events. */
export const SPEC_OUTBOUND_WEBHOOK_EVENTS = [
  'lead.created',
  'lead.updated',
  'lead.assigned',
  'stage.changed',
  'call.ended',
  'message.received',
  'task.overdue',
  'workflow.failed',
] as const;
// ---- change #19 wave C: hub
export const CRM_OUTBOUND_WEBHOOK_EVENTS = [
  'contact.created',
  'contact.updated',
  'account.created',
  'account.updated',
  'deal.created',
  'deal.updated',
  'deal.moved',
  'quotation.created',
  'quotation.updated',
  'invoice.created',
  'invoice.updated',
  'invoice.payment_recorded',
  'meeting.created',
  'meeting.updated',
] as const;
/** Every entry is a domain event name (checked in events.ts: OUTBOUND_EVENTS_ARE_DOMAIN_EVENTS). */
export const OUTBOUND_WEBHOOK_EVENTS = [...SPEC_OUTBOUND_WEBHOOK_EVENTS, ...CRM_OUTBOUND_WEBHOOK_EVENTS] as const;
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

// ---- change #19 wave C: hub (D-069)

/** The string that is signed: `${t}.${rawBody}` (rawBody = the exact request bytes as UTF-8). */
export const signaturePayload = (timestamp: number, rawBody: string): string => `${timestamp}.${rawBody}`;

/** Total attempts of one outbound delivery (first try + retries); after the last one the delivery is dead (dead-letter). */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_SEC.length + 1;
/** Seconds after the first attempt at which attempt n (1-based) runs: [0, 60, 360, 2160, 9360, 30960, 117360]. */
export const webhookAttemptOffsetsSec = (): number[] =>
  [0, ...WEBHOOK_RETRY_DELAYS_SEC].map((_, i) => WEBHOOK_RETRY_DELAYS_SEC.slice(0, i).reduce((a, b) => a + b, 0));
/** An outbound endpoint is switched off (with a notification to company admins) after this many dead deliveries in a row. */
export const WEBHOOK_AUTO_DISABLE_AFTER_DEAD = 3;
/** After a secret rotation the previous secret stays valid (inbound) and is also signed with (outbound) for this long. */
export const WEBHOOK_SECRET_GRACE_DEFAULT_HOURS = 24;
export const WEBHOOK_SECRET_GRACE_MAX_HOURS = 72;
/** Sample capture: the next verified request to an inbound source within this many minutes is stored as the sample (capture then stops). */
export const WEBHOOK_CAPTURE_DEFAULT_MIN = 15;
export const WEBHOOK_CAPTURE_MAX_MIN = 60;
/** Request bodies above this size are rejected (413 PAYLOAD_TOO_LARGE) on /api/hooks/*: the API's JSON body limit. */
export const WEBHOOK_MAX_INBOUND_BYTES = 100 * 1024;
/** Event type of POST /webhooks/endpoints/{id}/test deliveries (not subscribable). */
export const WEBHOOK_TEST_EVENT = 'webhook.test';
/** Path segments taken by provider receivers; custom inbound sources cannot use them as sourceKey. */
export const RESERVED_SOURCE_KEYS = ['whatsapp', 'indiamart', 'telephony', 'oauth', 'test'] as const;

export const OUTBOUND_EVENT_GROUPS = ['leads', 'activity', 'crm', 'documents', 'calendar'] as const;
export type OutboundEventGroup = (typeof OUTBOUND_EVENT_GROUPS)[number];
/** Labels for the event checklist of an outbound subscription. Body = the domain event envelope (see OutboundWebhookBody). */
export const OUTBOUND_EVENT_INFO: Record<OutboundWebhookEvent, { label: string; group: OutboundEventGroup; description: string }> = {
  'lead.created': { label: 'Lead created', group: 'leads', description: 'A lead was added (form, webhook, IndiaMART, import, API or by hand); payload.lead' },
  'lead.updated': { label: 'Lead updated', group: 'leads', description: 'Fields of a lead changed; payload.lead and payload.changed' },
  'lead.assigned': { label: 'Lead assigned', group: 'leads', description: 'Owner changed (routing or by hand); payload.lead, fromUserId, toUserId, rule' },
  'stage.changed': { label: 'Stage changed', group: 'leads', description: 'A lead moved to another stage; payload.lead, fromStageId, toStageId' },
  'call.ended': { label: 'Call ended', group: 'activity', description: 'A call finished; payload.call' },
  'message.received': { label: 'Message received', group: 'activity', description: 'An inbound WhatsApp message; payload.conversation and payload.message' },
  'task.overdue': { label: 'Task overdue', group: 'activity', description: 'A task passed its due time; payload.task' },
  'workflow.failed': { label: 'Workflow failed', group: 'activity', description: 'A workflow run failed; payload.runId, workflowId, error' },
  'contact.created': { label: 'Contact created', group: 'crm', description: 'payload.contact' },
  'contact.updated': { label: 'Contact updated', group: 'crm', description: 'payload.contact' },
  'account.created': { label: 'Account created', group: 'crm', description: 'payload.account' },
  'account.updated': { label: 'Account updated', group: 'crm', description: 'payload.account' },
  'deal.created': { label: 'Deal created', group: 'crm', description: 'payload.deal' },
  'deal.updated': { label: 'Deal updated', group: 'crm', description: 'payload.deal' },
  'deal.moved': { label: 'Deal moved', group: 'crm', description: 'A deal changed stage on the board; payload.deal' },
  'quotation.created': { label: 'Quotation created', group: 'documents', description: 'payload.quotation' },
  'quotation.updated': { label: 'Quotation updated', group: 'documents', description: 'Includes status changes (sent, accepted, rejected); payload.quotation' },
  'invoice.created': { label: 'Invoice created', group: 'documents', description: 'payload.invoice' },
  'invoice.updated': { label: 'Invoice updated', group: 'documents', description: 'Includes issue and cancel; payload.invoice' },
  'invoice.payment_recorded': { label: 'Payment recorded', group: 'documents', description: 'payload.invoice and payload.payment' },
  'meeting.created': { label: 'Meeting created', group: 'calendar', description: 'payload.meeting' },
  'meeting.updated': { label: 'Meeting updated', group: 'calendar', description: 'payload.meeting' },
};

/**
 * Outbound body (JSON): the domain event envelope `{ id, type, workspaceId, occurredAt, actor, payload }`.
 * Headers: X-Vistar-Signature (t=<unix>,v1=<hex>[,v1=<hex of the previous secret during a rotation grace>]),
 * X-Vistar-Event, X-Vistar-Delivery (delivery id; stable across retries of the same delivery, new on replay),
 * X-Vistar-Timestamp, Idempotency-Key (= event id for originals, = delivery id for replays and tests),
 * User-Agent "Vistar-Webhooks/1.0". 2xx = delivered; anything else (or a timeout / network error) = retry
 * after WEBHOOK_RETRY_DELAYS_SEC; redirects are not followed.
 */
export const OUTBOUND_USER_AGENT = 'Vistar-Webhooks/1.0';

/** Provider receivers (absolute paths, no /v1). The IndiaMART push key goes in `?key=`; the telephony token in `?token=`. */
export const indiamartPushPath = (workspaceId: string) => `/api/hooks/${workspaceId}/indiamart`;
export const whatsappWebhookPath = (workspaceId: string) => `/api/hooks/${workspaceId}/whatsapp`;
export const telephonyWebhookPath = (workspaceId: string, provider: string) => `/api/hooks/${workspaceId}/telephony/${provider}`;
/** Google OAuth redirect URI (register `${API_PUBLIC_URL}${GOOGLE_OAUTH_CALLBACK_PATH}` in the Google Cloud console). */
export const GOOGLE_OAUTH_CALLBACK_PATH = '/api/oauth/google/callback';
/** Public API reference (OpenAPI 3.1, only the API-key routes). */
export const PUBLIC_OPENAPI_PATH = '/api/v1/openapi.json';
