import { z } from 'zod';
import {
  ConfigGroupKeySchema,
  ConfigGroupStatusSchema,
  ConfigValueSchema,
  ConfigValueSourceSchema,
  ConfigFieldTypeSchema,
  RegistryGroupKeySchema,
} from '../config-registry.js';
import {
  CompanyEmailTemplateKeySchema,
  EmailLayoutThemeSchema,
  EmailTemplateVariableSchema,
  PlatformEmailTemplateKeySchema,
} from '../email-templates.js';
import { TemplateCategorySchema, TemplateStatusSchema } from '../enums.js';
import { PasswordSchema } from './auth.js';
import { IdSchema, IsoDateTimeSchema, PhoneSchema } from './common.js';

/**
 * Change #20 (SPEC 30, D-073, D-074): platform config registry, platform and company e-mail templates, WhatsApp
 * message templates synced with Meta, company setup checklist, Super Admin go-live checklist, password reset
 * and e-mail verification, public platform info.
 */

// ---------------------------------------------------------------- platform config registry

export const ConfigGroupParamSchema = z.object({ group: ConfigGroupKeySchema });
export const RegistryGroupParamSchema = z.object({ group: RegistryGroupKeySchema });

export const ConfigFieldOptionSchema = z.object({ value: z.string(), label: z.string() });

/** One field as the Config page renders it. Secrets: `value` is always null; use `secretSet` and `secretHint`. */
export const ConfigFieldStateSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: ConfigFieldTypeSchema,
  secret: z.boolean(),
  help: z.string().nullable(),
  placeholder: z.string().nullable(),
  required: z.boolean().describe('Required for the group to work (when `active`)'),
  /** The field's `when` condition holds for the current values (hide inactive fields). */
  active: z.boolean(),
  when: z.object({ field: z.string(), in: z.array(z.string()) }).nullable(),
  options: z.array(ConfigFieldOptionSchema).nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  /** Effective non-secret value (panel, env, default or dev default); null for secrets and unset fields. */
  value: ConfigValueSchema.nullable(),
  /** Value saved in the panel (non-secret only); null = not saved in the panel. */
  panelValue: ConfigValueSchema.nullable(),
  source: ConfigValueSourceSchema,
  /** Env var that is (or would be) the fallback; shown as "using env fallback: SMTP_HOST". */
  envVar: z.string().nullable(),
  defaultValue: ConfigValueSchema.nullable(),
  secretSet: z.boolean(),
  secretHint: z.string().nullable().describe('"••••abcd"; never the secret'),
});
export type ConfigFieldState = z.infer<typeof ConfigFieldStateSchema>;

export const ConfigTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number().int().nullable(),
  at: IsoDateTimeSchema,
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable(),
});
export type ConfigTestResult = z.infer<typeof ConfigTestResultSchema>;

export const ConfigGroupSchema = z.object({
  key: ConfigGroupKeySchema,
  label: z.string(),
  description: z.string(),
  icon: z.string(),
  kind: z.enum(['registry', 'card']),
  status: ConfigGroupStatusSchema,
  /** One line under the chip, e.g. "SMTP host comes from SMTP_HOST" or "Add the service account JSON". */
  statusNote: z.string().nullable(),
  requiredInProduction: z.boolean(),
  testable: z.boolean(),
  testLabel: z.string().nullable(),
  testNeedsRecipient: z.boolean(),
  cardAnchor: z.string().nullable(),
  fields: z.array(ConfigFieldStateSchema),
  missing: z.array(z.string()).describe('Required active field keys without a value'),
  lastTest: ConfigTestResultSchema.nullable(),
  updatedAt: IsoDateTimeSchema.nullable(),
  updatedBy: z.object({ id: IdSchema, name: z.string() }).nullable(),
});
export type ConfigGroup = z.infer<typeof ConfigGroupSchema>;

export const ConfigRegistrySchema = z.object({
  environment: z.enum(['development', 'test', 'production']),
  groups: z.array(ConfigGroupSchema),
});
export type ConfigRegistry = z.infer<typeof ConfigRegistrySchema>;

/**
 * Save a registry group. Keys left out stay as they are; `null` clears the panel value (env fallback or default
 * apply again). Secrets: a string replaces the stored secret, `null` clears it; secrets are never returned.
 */
export const ConfigGroupUpdateSchema = z.object({
  values: z.record(z.string(), ConfigValueSchema.nullable()),
});
export type ConfigGroupUpdate = z.infer<typeof ConfigGroupUpdateSchema>;

export const ConfigGroupTestSchema = z.object({
  /** Recipient of the test e-mail (group email; default = the signed-in Super Admin's e-mail). */
  to: z.email().optional(),
});
export type ConfigGroupTest = z.infer<typeof ConfigGroupTestSchema>;

export const ConfigAuditEntrySchema = z.object({
  id: IdSchema,
  action: z.string().describe('config.<group>.update | .reset | .test, or the card actions (config.firebase_client, config.razorpay, billing.profile_update, android_release.*)'),
  adminName: z.string().nullable(),
  /** Field keys changed or cleared (never values). */
  changed: z.array(z.string()),
  cleared: z.array(z.string()),
  ok: z.boolean().nullable().describe('Test result for .test entries'),
  ip: z.string().nullable(),
  at: IsoDateTimeSchema,
});
export type ConfigAuditEntry = z.infer<typeof ConfigAuditEntrySchema>;

// ---------------------------------------------------------------- e-mail templates (platform and company)

export const PlatformEmailTemplateParamSchema = z.object({ key: PlatformEmailTemplateKeySchema });
export const CompanyEmailTemplateParamSchema = z.object({ key: CompanyEmailTemplateKeySchema });

export const EmailTemplateSchema = z.object({
  key: z.string(),
  scope: z.enum(['platform', 'company']),
  label: z.string(),
  description: z.string(),
  subject: z.string(),
  html: z.string().describe('Body fragment (the layout adds header, footer and branding)'),
  /** Plain-text part derived from the HTML. */
  text: z.string(),
  variables: z.array(EmailTemplateVariableSchema),
  /** false = the default shipped in code. */
  isCustom: z.boolean(),
  defaultSubject: z.string(),
  defaultHtml: z.string(),
  updatedAt: IsoDateTimeSchema.nullable(),
  updatedBy: z.object({ id: IdSchema, name: z.string() }).nullable(),
});
export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;

export const EmailTemplateSummarySchema = EmailTemplateSchema.pick({ key: true, scope: true, label: true, description: true, subject: true, isCustom: true, updatedAt: true });
export type EmailTemplateSummary = z.infer<typeof EmailTemplateSummarySchema>;

export const EmailTemplateUpdateSchema = z.object({
  subject: z.string().trim().min(1).max(250),
  html: z.string().min(1).max(50_000),
});
export type EmailTemplateUpdate = z.infer<typeof EmailTemplateUpdateSchema>;

/** Preview a draft (subject/html omitted = the saved template) with sample data or given values. */
export const EmailTemplatePreviewSchema = z.object({
  subject: z.string().max(250).optional(),
  html: z.string().max(50_000).optional(),
  values: z.record(z.string(), z.string().max(2000)).optional().describe('Overrides of the sample values'),
  theme: EmailLayoutThemeSchema.default('light'),
});
export type EmailTemplatePreview = z.infer<typeof EmailTemplatePreviewSchema>;

export const EmailPreviewSchema = z.object({
  subject: z.string(),
  /** Full HTML document: render it in `<iframe sandbox="" srcdoc>` only. */
  html: z.string(),
  text: z.string(),
  unknownVariables: z.array(z.string()),
  missingRequired: z.array(z.string()),
  unsafeMarkupRemoved: z.boolean(),
});
export type EmailPreview = z.infer<typeof EmailPreviewSchema>;

export const EmailTemplateTestSchema = z.object({
  to: z.email().optional().describe('Default: the caller\'s own e-mail'),
  subject: z.string().max(250).optional(),
  html: z.string().max(50_000).optional(),
});
export type EmailTemplateTest = z.infer<typeof EmailTemplateTestSchema>;

export const EmailSendResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  messageId: z.string().nullable(),
  /** smtp | resend | sendgrid | dev_log (development without a mailer: built and logged, not sent) | company_smtp */
  via: z.string().nullable(),
});
export type EmailSendResult = z.infer<typeof EmailSendResultSchema>;

// ---------------------------------------------------------------- WhatsApp message templates (Meta)

export const WHATSAPP_HEADER_FORMATS = ['none', 'text', 'image', 'video', 'document'] as const;
export const WhatsAppHeaderFormatSchema = z.enum(WHATSAPP_HEADER_FORMATS);
export type WhatsAppHeaderFormat = z.infer<typeof WhatsAppHeaderFormatSchema>;

/** Meta names: lowercase letters, digits and underscores. */
export const WhatsAppTemplateNameSchema = z.string().regex(/^[a-z0-9_]{1,512}$/, { error: 'Use lowercase letters, digits and underscores, e.g. order_update_v1' });
/** Meta language codes: en, en_US, hi, mr, gu, ta, ... */
export const WhatsAppLanguageSchema = z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, { error: 'Use a Meta language code, e.g. en, en_US, hi' });

export const WhatsAppTemplateButtonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('quick_reply'), text: z.string().trim().min(1).max(25) }),
  z.object({
    type: z.literal('url'),
    text: z.string().trim().min(1).max(25),
    url: z.url({ protocol: /^https$/, error: 'Use an https URL' }).max(2000).describe('May end with {{1}} for a dynamic suffix'),
    example: z.string().max(2000).nullable().default(null).describe('Full example URL when the URL has {{1}}'),
  }),
  z.object({ type: z.literal('phone'), text: z.string().trim().min(1).max(25), phone: PhoneSchema }),
]);
export type WhatsAppTemplateButton = z.infer<typeof WhatsAppTemplateButtonSchema>;

export const WhatsAppTemplateHeaderSchema = z.object({
  format: WhatsAppHeaderFormatSchema.default('none'),
  /** format text: up to 60 characters, at most one variable {{1}} */
  text: z.string().max(60).nullable().default(null),
  /** format text with {{1}}: example value; media formats: an https example URL Meta can download */
  example: z.string().max(2000).nullable().default(null),
});
export type WhatsAppTemplateHeader = z.infer<typeof WhatsAppTemplateHeaderSchema>;

export const WhatsAppTemplateCreateSchema = z.object({
  name: WhatsAppTemplateNameSchema,
  language: WhatsAppLanguageSchema.default('en'),
  category: TemplateCategorySchema,
  header: WhatsAppTemplateHeaderSchema.default({ format: 'none', text: null, example: null }),
  /** Up to 1024 characters with numbered variables {{1}}, {{2}}, ... in order. */
  body: z.string().trim().min(1).max(1024),
  /** One example per numbered variable (Meta requires them for review). */
  bodyExamples: z.array(z.string().min(1).max(200)).max(20).default([]),
  /** Vistar variable keys for the numbered variables, e.g. ["lead.name","owner.name"] (used by workflows and the inbox). */
  variables: z.array(z.string().max(80)).max(20).default([]),
  footer: z.string().max(60).nullable().default(null),
  buttons: z.array(WhatsAppTemplateButtonSchema).max(10).default([]),
});
export type WhatsAppTemplateCreate = z.infer<typeof WhatsAppTemplateCreateSchema>;

/** Only draft and rejected templates can be edited (name and language are fixed after create). */
export const WhatsAppTemplateUpdateSchema = z.object({
  category: TemplateCategorySchema.optional(),
  header: WhatsAppTemplateHeaderSchema.optional(),
  body: z.string().trim().min(1).max(1024).optional(),
  bodyExamples: z.array(z.string().min(1).max(200)).max(20).optional(),
  variables: z.array(z.string().max(80)).max(20).optional(),
  footer: z.string().max(60).nullable().optional(),
  buttons: z.array(WhatsAppTemplateButtonSchema).max(10).optional(),
});
export type WhatsAppTemplateUpdate = z.infer<typeof WhatsAppTemplateUpdateSchema>;

export const WhatsAppTemplateSchema = z.object({
  id: IdSchema,
  name: z.string(),
  language: z.string(),
  category: TemplateCategorySchema,
  status: TemplateStatusSchema.describe('draft (not submitted), pending (Meta review), approved, rejected, paused'),
  header: WhatsAppTemplateHeaderSchema,
  body: z.string(),
  bodyExamples: z.array(z.string()),
  variables: z.array(z.string()),
  footer: z.string().nullable(),
  buttons: z.array(WhatsAppTemplateButtonSchema),
  providerTemplateId: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  submittedAt: IsoDateTimeSchema.nullable(),
  lastSyncedAt: IsoDateTimeSchema.nullable(),
  /** draft and rejected */
  editable: z.boolean(),
  /** mock = submitted to the development mock (no Meta call) */
  mode: z.enum(['live', 'mock']).nullable(),
  packKey: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type WhatsAppTemplate = z.infer<typeof WhatsAppTemplateSchema>;

export const WhatsAppTemplateListQuerySchema = z.object({
  status: TemplateStatusSchema.optional(),
  q: z.string().max(100).optional(),
});

export const WhatsAppTemplateSyncResultSchema = z.object({
  items: z.array(WhatsAppTemplateSchema),
  created: z.number().int(),
  updated: z.number().int(),
  mode: z.enum(['live', 'mock']),
  syncedAt: IsoDateTimeSchema,
});
export type WhatsAppTemplateSyncResult = z.infer<typeof WhatsAppTemplateSyncResultSchema>;

/** Numbered variables used by a WhatsApp body ("Hi {{1}}, your order {{2}}" -> [1, 2]). */
export function whatsappBodyVariables(body: string): number[] {
  const out: number[] = [];
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Problems Meta would reject: variables not 1..n in order, missing examples, header text with more than one variable. */
export function whatsappTemplateProblems(t: Pick<WhatsAppTemplateCreate, 'body' | 'bodyExamples' | 'header' | 'buttons'>): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];
  const vars = whatsappBodyVariables(t.body);
  const sorted = [...vars].sort((a, b) => a - b);
  if (sorted.some((n, i) => n !== i + 1)) problems.push({ path: 'body', message: 'Number the variables {{1}}, {{2}}, ... without gaps' });
  if (vars.length && t.bodyExamples.length !== vars.length) problems.push({ path: 'bodyExamples', message: `Add one example for each of the ${vars.length} variables` });
  if (/^\s*\{\{\s*\d+\s*\}\}|\{\{\s*\d+\s*\}\}\s*$/.test(t.body)) problems.push({ path: 'body', message: 'The body cannot start or end with a variable' });
  const h = t.header;
  if (h.format === 'text') {
    if (!h.text) problems.push({ path: 'header.text', message: 'Enter the header text' });
    const hv = whatsappBodyVariables(h.text ?? '');
    if (hv.length > 1 || (hv.length === 1 && hv[0] !== 1)) problems.push({ path: 'header.text', message: 'A text header can use only {{1}}' });
    if (hv.length === 1 && !h.example) problems.push({ path: 'header.example', message: 'Add an example for {{1}}' });
  }
  if ((h.format === 'image' || h.format === 'video' || h.format === 'document') && h.example && !/^https:\/\//.test(h.example)) problems.push({ path: 'header.example', message: 'Use an https link to a sample file' });
  if (t.buttons.filter((b) => b.type === 'phone').length > 1) problems.push({ path: 'buttons', message: 'Use at most one phone button' });
  if (t.buttons.filter((b) => b.type === 'url').length > 2) problems.push({ path: 'buttons', message: 'Use at most two URL buttons' });
  t.buttons.forEach((b, i) => {
    if (b.type === 'url' && /\{\{\s*1\s*\}\}\s*$/.test(b.url) && !b.example) problems.push({ path: `buttons.${i}.example`, message: 'Add an example URL for the dynamic part' });
  });
  return problems;
}

/** Text of the WhatsApp bubble preview: numbered variables replaced by the examples (or the given values). */
export function renderWhatsappBody(body: string, values: readonly string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => values[Number(n) - 1] ?? m);
}

// ---------------------------------------------------------------- company setup checklist

export const SETUP_ITEM_KEYS = [
  'branding',
  'billing_profile',
  'business_hours',
  'team_invited',
  'roles_reviewed',
  'integrations',
  'whatsapp_templates',
  'email_templates',
  'lead_routing',
  'capture_forms',
  'api_webhooks',
  'office_floor',
  'android_app',
] as const;
export const SetupItemKeySchema = z.enum(SETUP_ITEM_KEYS);
export type SetupItemKey = z.infer<typeof SetupItemKeySchema>;

/** Items the admin can tick by hand (nothing to detect). */
export const SETUP_ACKNOWLEDGEABLE_ITEMS: readonly SetupItemKey[] = ['roles_reviewed', 'business_hours', 'email_templates', 'android_app'];

/** Setting keys (workspace scope: acknowledged items; user scope: dashboard banner dismissed). */
export const SETUP_SETTING_KEYS = { acknowledged: 'setup.acknowledged', bannerDismissed: 'setup.bannerDismissed' } as const;

export const SETUP_ITEM_STATUSES = ['done', 'in_progress', 'todo', 'not_applicable'] as const;
export const SetupItemStatusSchema = z.enum(SETUP_ITEM_STATUSES);

export const SetupItemSchema = z.object({
  key: SetupItemKeySchema,
  label: z.string(),
  description: z.string(),
  status: SetupItemStatusSchema,
  /** Optional items do not count towards the percentage. */
  optional: z.boolean(),
  /** Web path of the page that fixes it, e.g. /app/settings/branding. */
  href: z.string(),
  actionLabel: z.string(),
  /** "2 of 9 employees registered a device", "3 approved templates" */
  detail: z.string().nullable(),
  /** Can be ticked by hand (PUT /setup/items/{key}). */
  acknowledgeable: z.boolean(),
  acknowledged: z.boolean(),
});
export type SetupItem = z.infer<typeof SetupItemSchema>;

export const SetupChecklistSchema = z.object({
  items: z.array(SetupItemSchema),
  /** Required items done / required items (not_applicable excluded). */
  done: z.number().int(),
  total: z.number().int(),
  percent: z.number().int().min(0).max(100),
  complete: z.boolean(),
  /** The caller dismissed the dashboard banner. */
  bannerDismissed: z.boolean(),
});
export type SetupChecklist = z.infer<typeof SetupChecklistSchema>;

export const SetupItemParamSchema = z.object({ key: SetupItemKeySchema });
export const SetupItemAckSchema = z.object({ acknowledged: z.boolean() });
export const SetupBannerSchema = z.object({ dismissed: z.boolean() });

// ---------------------------------------------------------------- Super Admin go-live checklist

export const GO_LIVE_CHECK_KEYS = [
  'node_env',
  'secrets_strong',
  'public_urls_https',
  'storage_cloud',
  'email_configured',
  'email_tested',
  'razorpay_live',
  'firebase',
  'sentry',
  'backups',
  'no_mock_providers',
  'demo_companies_absent',
  'super_admin_2fa',
  'android_release',
  'billing_profile',
] as const;
export const GoLiveCheckKeySchema = z.enum(GO_LIVE_CHECK_KEYS);
export type GoLiveCheckKey = z.infer<typeof GoLiveCheckKeySchema>;

export const GoLiveCheckSchema = z.object({
  key: GoLiveCheckKeySchema,
  label: z.string(),
  status: z.enum(['pass', 'fail', 'warn']),
  detail: z.string(),
  /** Super Admin web path that fixes it (Config group, Companies), or null for server changes (env, deploy). */
  fixHref: z.string().nullable(),
  /** A failing blocking check means "not ready". */
  blocking: z.boolean(),
});
export type GoLiveCheck = z.infer<typeof GoLiveCheckSchema>;

export const GoLiveChecklistSchema = z.object({
  items: z.array(GoLiveCheckSchema),
  passed: z.number().int(),
  total: z.number().int(),
  ready: z.boolean(),
  environment: z.enum(['development', 'test', 'production']),
  checkedAt: IsoDateTimeSchema,
});
export type GoLiveChecklist = z.infer<typeof GoLiveChecklistSchema>;

// ---------------------------------------------------------------- password reset and e-mail verification

export const PasswordForgotSchema = z.object({ email: z.email().max(254).transform((v) => v.toLowerCase()) });
export type PasswordForgot = z.infer<typeof PasswordForgotSchema>;

export const AuthLinkTokenSchema = z.string().min(20).max(200);
export const PasswordResetSchema = z.object({ token: AuthLinkTokenSchema, password: PasswordSchema });
export type PasswordReset = z.infer<typeof PasswordResetSchema>;

export const PasswordResetLookupQuerySchema = z.object({ token: AuthLinkTokenSchema });
export const PasswordResetLookupSchema = z.object({
  valid: z.boolean(),
  /** "p***@example.com" */
  email: z.string().nullable(),
  /** Minimum length from the security policy (the form validates it). */
  passwordMinLength: z.number().int(),
  expiresAt: IsoDateTimeSchema.nullable(),
});
export type PasswordResetLookup = z.infer<typeof PasswordResetLookupSchema>;

export const EmailVerifySchema = z.object({ token: AuthLinkTokenSchema });
export const EmailVerificationStatusSchema = z.object({ verified: z.boolean(), verifiedAt: IsoDateTimeSchema.nullable(), sentAt: IsoDateTimeSchema.nullable() });
export type EmailVerificationStatus = z.infer<typeof EmailVerificationStatusSchema>;

/** Lifetimes of the one-time links. */
export const PASSWORD_RESET_TTL_MIN = 60;
export const EMAIL_VERIFY_TTL_HOURS = 24;
/** Web paths of the links in the e-mails (frontend-app builds the pages). */
export const AUTH_LINK_PATHS = { passwordReset: '/reset-password', emailVerify: '/verify-email' } as const;

// ---------------------------------------------------------------- public platform info (no auth)

export const PublicPlatformInfoSchema = z.object({
  productName: z.string(),
  supportEmail: z.string().nullable(),
  supportPhone: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  termsUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
  /** Minimum password length for sign-up and reset forms. */
  passwordMinLength: z.number().int(),
  /** Web error monitoring (the web DSN is public by design); null = off. */
  monitoring: z.object({ dsn: z.string(), environment: z.string(), tracesSampleRate: z.number(), errorSampleRate: z.number() }).nullable(),
  /** Sign in with Google is available (Google OAuth client configured). */
  googleSignIn: z.boolean(),
  googleClientId: z.string().nullable(),
});
export type PublicPlatformInfo = z.infer<typeof PublicPlatformInfoSchema>;
