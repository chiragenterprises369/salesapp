import { z } from 'zod';
import { PlanSchema, UsageMetricSchema } from './enums.js';

/**
 * Stable, machine-readable error codes. Every non-2xx API response uses ApiErrorSchema.
 * Never change an existing code's meaning; add new codes instead.
 */
export const ErrorCode = {
  // generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  // auth / rbac / tenancy
  AUTH_UNAUTHENTICATED: 'AUTH_UNAUTHENTICATED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  AUTH_INVITE_INVALID: 'AUTH_INVITE_INVALID',
  AUTH_ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
  FORBIDDEN: 'FORBIDDEN',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  API_KEY_INVALID: 'API_KEY_INVALID',
  API_KEY_SCOPE_MISSING: 'API_KEY_SCOPE_MISSING',
  // leads / pipeline
  LEAD_DUPLICATE: 'LEAD_DUPLICATE',
  LEAD_MERGE_INVALID: 'LEAD_MERGE_INVALID',
  STAGE_NOT_IN_PIPELINE: 'STAGE_NOT_IN_PIPELINE',
  STAGE_IN_USE: 'STAGE_IN_USE',
  IMPORT_INVALID_FILE: 'IMPORT_INVALID_FILE',
  IMPORT_MAPPING_INVALID: 'IMPORT_MAPPING_INVALID',
  // messaging / compliance
  CONSENT_OPTED_OUT: 'CONSENT_OPTED_OUT',
  CONSENT_MISSING: 'CONSENT_MISSING',
  WHATSAPP_WINDOW_CLOSED: 'WHATSAPP_WINDOW_CLOSED',
  WHATSAPP_TEMPLATE_NOT_APPROVED: 'WHATSAPP_TEMPLATE_NOT_APPROVED',
  QUIET_HOURS: 'QUIET_HOURS',
  SEND_RATE_LIMITED: 'SEND_RATE_LIMITED',
  // integrations / webhooks
  INTEGRATION_NOT_CONNECTED: 'INTEGRATION_NOT_CONNECTED',
  INTEGRATION_PROVIDER_ERROR: 'INTEGRATION_PROVIDER_ERROR',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  WEBHOOK_TIMESTAMP_EXPIRED: 'WEBHOOK_TIMESTAMP_EXPIRED',
  WEBHOOK_DUPLICATE: 'WEBHOOK_DUPLICATE',
  WEBHOOK_ENDPOINT_DISABLED: 'WEBHOOK_ENDPOINT_DISABLED',
  // workflows
  WORKFLOW_INVALID_GRAPH: 'WORKFLOW_INVALID_GRAPH',
  WORKFLOW_NOT_ACTIVE: 'WORKFLOW_NOT_ACTIVE',
  WORKFLOW_LOOP_LIMIT: 'WORKFLOW_LOOP_LIMIT',
  // billing
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  // customization / packs
  FIELD_KEY_TAKEN: 'FIELD_KEY_TAKEN',
  FIELD_VALUE_NOT_UNIQUE: 'FIELD_VALUE_NOT_UNIQUE',
  PACK_NOT_ENTITLED: 'PACK_NOT_ENTITLED',
  PACK_CORE_LOCKED: 'PACK_CORE_LOCKED',
  PACK_INSTALL_FAILED: 'PACK_INSTALL_FAILED',
  // change #19: features, files, domains, platform config, attendance, floors
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  FILE_INVALID: 'FILE_INVALID',
  DOMAIN_INVALID: 'DOMAIN_INVALID',
  DOMAIN_TAKEN: 'DOMAIN_TAKEN',
  DOMAIN_VERIFICATION_FAILED: 'DOMAIN_VERIFICATION_FAILED',
  FIREBASE_CONFIG_INVALID: 'FIREBASE_CONFIG_INVALID',
  PUSH_NOT_CONFIGURED: 'PUSH_NOT_CONFIGURED',
  APP_RELEASE_INVALID: 'APP_RELEASE_INVALID',
  NOT_FIELD_STAFF: 'NOT_FIELD_STAFF',
  TRACKING_CONSENT_REQUIRED: 'TRACKING_CONSENT_REQUIRED',
  OUTSIDE_WORKING_HOURS: 'OUTSIDE_WORKING_HOURS',
  ATTENDANCE_STATE_INVALID: 'ATTENDANCE_STATE_INVALID',
  FLOOR_REQUEST_INCOMPLETE: 'FLOOR_REQUEST_INCOMPLETE',
  FLOOR_NOT_READY: 'FLOOR_NOT_READY',
  // change #19 wave B: CRM features
  DOCUMENT_STATE_INVALID: 'DOCUMENT_STATE_INVALID',
  SELLER_PROFILE_INCOMPLETE: 'SELLER_PROFILE_INCOMPLETE',
  PAYMENT_EXCEEDS_BALANCE: 'PAYMENT_EXCEEDS_BALANCE',
  RECORD_MERGE_INVALID: 'RECORD_MERGE_INVALID',
  PRODUCT_SKU_TAKEN: 'PRODUCT_SKU_TAKEN',
  SHARE_LINK_EXPIRED: 'SHARE_LINK_EXPIRED',
  CAPTURE_FORM_CLOSED: 'CAPTURE_FORM_CLOSED',
  // ---- change #19 wave C: hub
  INTEGRATION_NOT_CONFIGURED: 'INTEGRATION_NOT_CONFIGURED',
  WEBHOOK_URL_BLOCKED: 'WEBHOOK_URL_BLOCKED',
  WEBHOOK_REPLAY_NOT_ALLOWED: 'WEBHOOK_REPLAY_NOT_ALLOWED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  API_KEY_SCOPE_NOT_ALLOWED: 'API_KEY_SCOPE_NOT_ALLOWED',
  OAUTH_STATE_INVALID: 'OAUTH_STATE_INVALID',
  // ---- change #19 wave C: billing
  PAYMENT_PROVIDER_NOT_CONFIGURED: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
  PAYMENT_VERIFICATION_FAILED: 'PAYMENT_VERIFICATION_FAILED',
  PLAN_CHANGE_INVALID: 'PLAN_CHANGE_INVALID',
  // ---- change #20: config
  CONFIG_MISSING: 'CONFIG_MISSING',
  TEMPLATE_INVALID: 'TEMPLATE_INVALID',
  TEMPLATE_STATE_INVALID: 'TEMPLATE_STATE_INVALID',
  MAIL_SEND_FAILED: 'MAIL_SEND_FAILED',
  AUTH_LINK_INVALID: 'AUTH_LINK_INVALID',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
export const ErrorCodeSchema = z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]);

/** Default HTTP status for each code. Inbound duplicate webhooks return 200 (idempotent replay). */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  AUTH_UNAUTHENTICATED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_TOKEN_INVALID: 401,
  AUTH_EMAIL_TAKEN: 409,
  AUTH_INVITE_INVALID: 400,
  AUTH_ACCOUNT_DISABLED: 403,
  FORBIDDEN: 403,
  TENANT_MISMATCH: 404,
  API_KEY_INVALID: 401,
  API_KEY_SCOPE_MISSING: 403,
  LEAD_DUPLICATE: 409,
  LEAD_MERGE_INVALID: 400,
  STAGE_NOT_IN_PIPELINE: 400,
  STAGE_IN_USE: 409,
  IMPORT_INVALID_FILE: 400,
  IMPORT_MAPPING_INVALID: 400,
  CONSENT_OPTED_OUT: 422,
  CONSENT_MISSING: 422,
  WHATSAPP_WINDOW_CLOSED: 422,
  WHATSAPP_TEMPLATE_NOT_APPROVED: 422,
  QUIET_HOURS: 422,
  SEND_RATE_LIMITED: 429,
  INTEGRATION_NOT_CONNECTED: 422,
  INTEGRATION_PROVIDER_ERROR: 502,
  WEBHOOK_SIGNATURE_INVALID: 401,
  WEBHOOK_TIMESTAMP_EXPIRED: 401,
  WEBHOOK_DUPLICATE: 200,
  WEBHOOK_ENDPOINT_DISABLED: 410,
  WORKFLOW_INVALID_GRAPH: 400,
  WORKFLOW_NOT_ACTIVE: 409,
  WORKFLOW_LOOP_LIMIT: 422,
  PLAN_LIMIT_REACHED: 402,
  FIELD_KEY_TAKEN: 409,
  FIELD_VALUE_NOT_UNIQUE: 409,
  PACK_NOT_ENTITLED: 403,
  PACK_CORE_LOCKED: 409,
  PACK_INSTALL_FAILED: 422,
  /** The company's plan or a Super Admin switch does not include the feature (custom_domain, field_tracking). */
  FEATURE_DISABLED: 403,
  FILE_TYPE_NOT_ALLOWED: 415,
  /** Content does not match the declared type (e.g. not a GLB, broken JSON, APK is not a zip). */
  FILE_INVALID: 422,
  DOMAIN_INVALID: 422,
  DOMAIN_TAKEN: 409,
  DOMAIN_VERIFICATION_FAILED: 422,
  FIREBASE_CONFIG_INVALID: 422,
  PUSH_NOT_CONFIGURED: 422,
  APP_RELEASE_INVALID: 422,
  NOT_FIELD_STAFF: 403,
  TRACKING_CONSENT_REQUIRED: 422,
  OUTSIDE_WORKING_HOURS: 422,
  /** Check-in while checked in, check-out or location while not checked in. */
  ATTENDANCE_STATE_INVALID: 409,
  /** Fewer than 3 reference images, or missing work_area / cabin-or-meeting_room. */
  FLOOR_REQUEST_INCOMPLETE: 422,
  /** Publish without a seat map, or a seat map on a superseded floor. */
  FLOOR_NOT_READY: 409,
  /** The action is not allowed in the document's status (edit a sent quotation, issue a cancelled invoice). */
  DOCUMENT_STATE_INVALID: 409,
  /** Sending a quotation or issuing an invoice needs the seller legal name and state code (GET /billing/profile). */
  SELLER_PROFILE_INCOMPLETE: 422,
  PAYMENT_EXCEEDS_BALANCE: 422,
  /** Merge of a record into itself, a deleted record, or more than 10 records. */
  RECORD_MERGE_INVALID: 400,
  PRODUCT_SKU_TAKEN: 409,
  /** Share link revoked, rotated or past its expiry. */
  SHARE_LINK_EXPIRED: 410,
  /** Lead capture form paused or deleted. */
  CAPTURE_FORM_CLOSED: 410,
  // ---- change #19 wave C: hub
  /** The provider needs a platform setting that is missing (e.g. GOOGLE_CLIENT_ID/SECRET for Google Calendar), or mock mode in production. */
  INTEGRATION_NOT_CONFIGURED: 422,
  /** Outbound URL or host resolves to a private, loopback or link-local address (SSRF guard), or uses http outside the dev allowlist. */
  WEBHOOK_URL_BLOCKED: 422,
  /** Inbound deliveries that failed signature or token verification cannot be replayed. */
  WEBHOOK_REPLAY_NOT_ALLOWED: 422,
  /** The same Idempotency-Key with a different body, or the first request with this key is still running. */
  IDEMPOTENCY_CONFLICT: 409,
  /** An API key scope the creator does not hold. */
  API_KEY_SCOPE_NOT_ALLOWED: 403,
  /** OAuth callback with an unknown, used or expired state. */
  OAUTH_STATE_INVALID: 400,
  // ---- change #19 wave C: billing
  /** Online payment asked for while neither Razorpay nor the dev mock provider is active (use "Request change"). */
  PAYMENT_PROVIDER_NOT_CONFIGURED: 422,
  /** Checkout signature or order does not match (tampered or stale payment). */
  PAYMENT_VERIFICATION_FAILED: 400,
  /** Same plan, inactive plan, or a change the subscription state does not allow. */
  PLAN_CHANGE_INVALID: 422,
  // ---- change #20: config
  /** A platform setting the action needs is not set (platform mailer, file storage, telephony account); the message names the Config group. */
  CONFIG_MISSING: 422,
  /** E-mail template with unknown or missing required variables, or a WhatsApp template Meta would reject (details per field). */
  TEMPLATE_INVALID: 422,
  /** Edit or submit of a WhatsApp template in a status that does not allow it (pending, approved, paused). */
  TEMPLATE_STATE_INVALID: 409,
  /** The mail server or provider refused the message (test sends; background sends only log). */
  MAIL_SEND_FAILED: 502,
  /** Password reset or e-mail verification link unknown, used or expired. */
  AUTH_LINK_INVALID: 400,
};

export const FieldErrorSchema = z.object({
  path: z.string().describe('Dot path of the invalid field, e.g. "contact.phone"'),
  message: z.string(),
});
export type FieldError = z.infer<typeof FieldErrorSchema>;

// ---- change #19 wave C: billing
/**
 * Body extra of PLAN_LIMIT_REACHED (402): which limit stopped the create, the numbers, and where to upgrade.
 * `upgradePlan` is the cheapest active plan whose limit is higher (null on the top plan: contact Vistar).
 */
export const PlanLimitErrorSchema = z.object({
  metric: UsageMetricSchema,
  limit: z.number().int(),
  used: z.number().int(),
  plan: PlanSchema,
  upgradePlan: PlanSchema.nullable(),
  upgradeUrl: z.string().describe('Web path, e.g. /app/billing?upgrade=growth'),
});
export type PlanLimitError = z.infer<typeof PlanLimitErrorSchema>;

/** Error envelope for every non-2xx response. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string().describe('Human-readable, safe to show to the user. Never contains PII or secrets.'),
    details: z.array(FieldErrorSchema).optional(),
    requestId: z.string().optional(),
    // ---- change #19 wave C: billing
    planLimit: PlanLimitErrorSchema.optional().describe('Only on PLAN_LIMIT_REACHED (402)'),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Type guard for clients parsing unknown error bodies. */
export function isApiError(body: unknown): body is ApiError {
  return ApiErrorSchema.safeParse(body).success;
}
