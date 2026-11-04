import { z } from 'zod';

/**
 * PLATFORM CONFIG REGISTRY (change #20, SPEC 30, D-073).
 *
 * Every key, token, secret or setting the Super Admin must set lives in one typed registry, rendered by the
 * Super Admin > Config page from these definitions (CONFIG-WEB) and resolved by the API (`PlatformConfigService`):
 *
 *   panel value (PlatformSetting `config.<group>`, secrets encrypted with ENCRYPTION_KEY)
 *     -> env fallback (`field.env`, kept for existing deployments)
 *       -> safe default (`field.default`)
 *         -> dev default (`field.devDefault`, outside production only; never in production)
 *
 * Secrets are write-only: the API returns only `secretSet` and a masked `secretHint`, never the value.
 * Card groups (firebase, android_releases, razorpay, billing_profile) keep their own routes and cards; the
 * registry lists them with a status so the page shows everything in one place.
 */
export const CONFIG_FIELD_TYPES = ['text', 'textarea', 'secret', 'number', 'boolean', 'select', 'email', 'url', 'list'] as const;
export const ConfigFieldTypeSchema = z.enum(CONFIG_FIELD_TYPES);
export type ConfigFieldType = z.infer<typeof ConfigFieldTypeSchema>;

/** A stored or resolved field value. Secrets are strings (never returned by the API). */
export const ConfigValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export type ConfigValue = z.infer<typeof ConfigValueSchema>;

/** Where the effective value of a field comes from. */
export const CONFIG_VALUE_SOURCES = ['panel', 'env', 'default', 'dev_default', 'none'] as const;
export const ConfigValueSourceSchema = z.enum(CONFIG_VALUE_SOURCES);
export type ConfigValueSource = z.infer<typeof ConfigValueSourceSchema>;

/**
 * Group status chip:
 * - configured: every required field has a panel value or a safe default
 * - missing: a required field has no value (the feature is off or refuses to work)
 * - env_fallback: works, but at least one value still comes from the server env (move it into the panel)
 * - dev_default: works only because of a development default (Mailpit, local disk, mock provider); never in production
 */
export const CONFIG_GROUP_STATUSES = ['configured', 'missing', 'env_fallback', 'dev_default'] as const;
export const ConfigGroupStatusSchema = z.enum(CONFIG_GROUP_STATUSES);
export type ConfigGroupStatus = z.infer<typeof ConfigGroupStatusSchema>;

export interface ConfigFieldOption {
  readonly value: string;
  readonly label: string;
}

export interface ConfigFieldDef {
  readonly key: string;
  readonly label: string;
  readonly type: ConfigFieldType;
  readonly help?: string;
  readonly placeholder?: string;
  /** Env var read when the panel has no value (shown as "using env fallback: SMTP_HOST"). */
  readonly env?: string;
  /** Safe default (never for secrets). */
  readonly default?: ConfigValue;
  /** Used only outside production when nothing else is set (status dev_default). */
  readonly devDefault?: ConfigValue;
  /** The group cannot work without this field (when its `when` condition holds). */
  readonly required?: boolean;
  /** Field applies only when another field of the group has one of these values (e.g. driver = s3). */
  readonly when?: { readonly field: string; readonly in: readonly string[] };
  readonly options?: readonly ConfigFieldOption[];
  readonly min?: number;
  readonly max?: number;
  /** number: decimals allowed (sample rates); default integers only. */
  readonly decimal?: boolean;
  /** list: each item must match (e.g. IP or CIDR). */
  readonly itemPattern?: string;
  readonly itemHelp?: string;
  /** Max string length (text 500, textarea 5000, secret 10000 by default). */
  readonly maxLength?: number;
}

export const CONFIG_GROUP_KINDS = ['registry', 'card'] as const;
export type ConfigGroupKind = (typeof CONFIG_GROUP_KINDS)[number];

export interface ConfigGroupDef {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** lucide-react icon name */
  readonly icon: string;
  readonly kind: ConfigGroupKind;
  /** Listed by the go-live checklist when not configured. */
  readonly requiredInProduction: boolean;
  /** POST /api/super/config/groups/{group}/test exists for this group. */
  readonly testable: boolean;
  readonly testLabel?: string;
  /** Test needs a recipient e-mail (`to`). */
  readonly testNeedsRecipient?: boolean;
  /** Card groups: web path of the existing card (inside the Config page). */
  readonly cardAnchor?: string;
  readonly fields: readonly ConfigFieldDef[];
}

const IP_OR_CIDR = '^(?:(?:\\d{1,3}\\.){3}\\d{1,3}(?:/(?:[0-9]|[12][0-9]|3[0-2]))?|[0-9a-fA-F:]{2,39})$';

const BUNNY_REGIONS = [
  { value: 'de', label: 'Falkenstein (storage.bunnycdn.com)' },
  { value: 'uk', label: 'London (uk.storage.bunnycdn.com)' },
  { value: 'se', label: 'Stockholm (se.storage.bunnycdn.com)' },
  { value: 'ny', label: 'New York (ny.storage.bunnycdn.com)' },
  { value: 'la', label: 'Los Angeles (la.storage.bunnycdn.com)' },
  { value: 'sg', label: 'Singapore (sg.storage.bunnycdn.com)' },
  { value: 'syd', label: 'Sydney (syd.storage.bunnycdn.com)' },
  { value: 'br', label: 'Sao Paulo (br.storage.bunnycdn.com)' },
  { value: 'jh', label: 'Johannesburg (jh.storage.bunnycdn.com)' },
] as const;

/** Bunny Storage API host per region (native adapter; the S3 signature did not work with Bunny). */
export const BUNNY_STORAGE_HOSTS: Record<string, string> = {
  de: 'storage.bunnycdn.com',
  uk: 'uk.storage.bunnycdn.com',
  se: 'se.storage.bunnycdn.com',
  ny: 'ny.storage.bunnycdn.com',
  la: 'la.storage.bunnycdn.com',
  sg: 'sg.storage.bunnycdn.com',
  syd: 'syd.storage.bunnycdn.com',
  br: 'br.storage.bunnycdn.com',
  jh: 'jh.storage.bunnycdn.com',
};

export const MAIL_PROVIDERS = ['smtp', 'resend', 'sendgrid'] as const;
export type MailProviderKind = (typeof MAIL_PROVIDERS)[number];
export const STORAGE_DRIVERS = ['local', 's3', 'bunny'] as const;
export type StorageDriverKind = (typeof STORAGE_DRIVERS)[number];
export const PLATFORM_TELEPHONY_PROVIDERS = ['mock', 'exotel'] as const;

/**
 * The registry. Order = order on the Config page. Field keys are stable API names (never reuse a key).
 * Typed values: `PlatformConfigValues<'email'>` etc.
 */
export const PLATFORM_CONFIG_GROUPS = {
  email: {
    key: 'email',
    label: 'Platform email',
    description: 'Sender for invites, password resets, e-mail verification, Super Admin login alerts and Vistar billing e-mails. SMTP or a provider API key (Resend, SendGrid).',
    icon: 'Mail',
    kind: 'registry',
    requiredInProduction: true,
    testable: true,
    testLabel: 'Send a test e-mail',
    testNeedsRecipient: true,
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: [{ value: 'smtp', label: 'SMTP server' }, { value: 'resend', label: 'Resend API' }, { value: 'sendgrid', label: 'SendGrid API' }], required: true, devDefault: 'smtp', help: 'SMTP works with any mailbox or relay (Amazon SES, Zoho, Google Workspace). Resend and SendGrid use an API key over HTTPS.' },
      { key: 'smtpHost', label: 'SMTP host', type: 'text', env: 'SMTP_HOST', devDefault: 'localhost', required: true, when: { field: 'provider', in: ['smtp'] }, placeholder: 'smtp.example.com', help: 'Development uses Mailpit on localhost:1025 when empty.' },
      { key: 'smtpPort', label: 'SMTP port', type: 'number', env: 'SMTP_PORT', devDefault: 1025, default: 587, min: 1, max: 65535, when: { field: 'provider', in: ['smtp'] }, help: '587 (STARTTLS) or 465 (TLS).' },
      { key: 'smtpTls', label: 'TLS', type: 'select', options: [{ value: 'starttls', label: 'STARTTLS (port 587)' }, { value: 'tls', label: 'TLS from the start (port 465)' }, { value: 'none', label: 'None (development only)' }], default: 'starttls', devDefault: 'none', when: { field: 'provider', in: ['smtp'] } },
      { key: 'smtpUser', label: 'SMTP user name', type: 'text', env: 'SMTP_USER', when: { field: 'provider', in: ['smtp'] } },
      { key: 'smtpPassword', label: 'SMTP password', type: 'secret', env: 'SMTP_PASSWORD', when: { field: 'provider', in: ['smtp'] } },
      { key: 'apiKey', label: 'API key', type: 'secret', required: true, when: { field: 'provider', in: ['resend', 'sendgrid'] }, help: 'Resend: re_... ; SendGrid: SG.... Needs permission to send mail only.' },
      { key: 'fromName', label: 'From name', type: 'text', env: 'SMTP_FROM', default: 'Tootodo', maxLength: 80 },
      { key: 'fromEmail', label: 'From address', type: 'email', env: 'SMTP_FROM', devDefault: 'no-reply@tootodo.local', required: true, help: 'Must be a verified sender or domain at your provider (SPF, DKIM).' },
      { key: 'replyTo', label: 'Reply-to address', type: 'email', placeholder: 'support@example.com' },
    ],
  },
  storage: {
    key: 'storage',
    label: 'File storage',
    description: 'Where uploads are stored (logos, reference images, floor files, APKs, call recordings, documents). Local disk is for development only.',
    icon: 'HardDrive',
    kind: 'registry',
    requiredInProduction: true,
    testable: true,
    testLabel: 'Write and delete a test file',
    fields: [
      { key: 'driver', label: 'Driver', type: 'select', env: 'STORAGE_DRIVER', devDefault: 'local', required: true, options: [{ value: 'local', label: 'Local disk (development)' }, { value: 's3', label: 'S3-compatible (AWS S3, MinIO, Cloudflare R2, Wasabi)' }, { value: 'bunny', label: 'Bunny Storage (native API)' }], help: 'Existing files keep the driver they were written with, so switching does not break old links.' },
      { key: 's3Endpoint', label: 'S3 endpoint', type: 'url', env: 'S3_ENDPOINT', when: { field: 'driver', in: ['s3'] }, placeholder: 'https://s3.ap-south-1.amazonaws.com', help: 'Empty = AWS S3 for the region.' },
      { key: 's3Region', label: 'S3 region', type: 'text', env: 'S3_REGION', default: 'ap-south-1', when: { field: 'driver', in: ['s3'] } },
      { key: 's3Bucket', label: 'S3 bucket', type: 'text', env: 'S3_BUCKET', required: true, when: { field: 'driver', in: ['s3'] } },
      { key: 's3AccessKey', label: 'S3 access key id', type: 'text', env: 'S3_ACCESS_KEY', required: true, when: { field: 'driver', in: ['s3'] } },
      { key: 's3SecretKey', label: 'S3 secret key', type: 'secret', env: 'S3_SECRET_KEY', required: true, when: { field: 'driver', in: ['s3'] } },
      { key: 's3ForcePathStyle', label: 'Path-style URLs', type: 'boolean', env: 'S3_FORCE_PATH_STYLE', default: false, when: { field: 'driver', in: ['s3'] }, help: 'On for MinIO and most self-hosted servers.' },
      { key: 'bunnyStorageZone', label: 'Bunny storage zone', type: 'text', required: true, when: { field: 'driver', in: ['bunny'] }, placeholder: 'vistar-prod' },
      { key: 'bunnyRegion', label: 'Bunny region', type: 'select', default: 'de', options: BUNNY_REGIONS, when: { field: 'driver', in: ['bunny'] }, help: 'The primary region of the storage zone.' },
      { key: 'bunnyPassword', label: 'Bunny storage password', type: 'secret', required: true, when: { field: 'driver', in: ['bunny'] }, help: 'Storage zone > FTP & API access > Password (not the account API key).' },
      { key: 'publicBaseUrl', label: 'Public base URL (CDN)', type: 'url', env: 'S3_PUBLIC_BASE_URL', when: { field: 'driver', in: ['s3', 'bunny'] }, placeholder: 'https://vistar.b-cdn.net', help: 'Optional pull zone or CDN for public files (logos, favicons). Private files always use signed API links.' },
    ],
  },
  google_oauth: {
    key: 'google_oauth',
    label: 'Google OAuth client',
    description: 'Sign in with Google and the Google Calendar integration. Authorised redirect URI: <API_PUBLIC_URL>/api/oauth/google/callback.',
    icon: 'KeyRound',
    kind: 'registry',
    requiredInProduction: false,
    testable: true,
    testLabel: 'Check the client credentials',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', env: 'GOOGLE_CLIENT_ID', required: true, placeholder: '1234-abc.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'Client secret', type: 'secret', env: 'GOOGLE_CLIENT_SECRET', required: true },
    ],
  },
  whatsapp_app: {
    key: 'whatsapp_app',
    label: 'WhatsApp platform app',
    description: "Tootodo's Meta app for the shared webhook (/api/hooks/whatsapp, routed by phone number id). Companies still connect their own number in Integrations.",
    icon: 'MessageCircle',
    kind: 'registry',
    requiredInProduction: false,
    testable: true,
    testLabel: 'Check the app secret with Meta',
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', env: 'WHATSAPP_APP_ID', required: true },
      { key: 'appSecret', label: 'App secret', type: 'secret', env: 'WHATSAPP_APP_SECRET', required: true, help: 'Verifies X-Hub-Signature-256 on every webhook.' },
      { key: 'verifyToken', label: 'Webhook verify token', type: 'secret', env: 'WHATSAPP_VERIFY_TOKEN', required: true, help: 'Any long random string; paste the same value into Meta > WhatsApp > Configuration.' },
      { key: 'graphVersion', label: 'Graph API version', type: 'text', env: 'WHATSAPP_GRAPH_VERSION', default: 'v23.0', placeholder: 'v23.0' },
    ],
  },
  telephony: {
    key: 'telephony',
    label: 'Telephony platform account',
    description: 'Vistar\'s Exotel account for click-to-call when a company has not connected its own telephony account. Mock calls in development.',
    icon: 'PhoneCall',
    kind: 'registry',
    requiredInProduction: false,
    testable: true,
    testLabel: 'Check the Exotel credentials',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', env: 'TELEPHONY_PROVIDER', devDefault: 'mock', required: true, options: [{ value: 'exotel', label: 'Exotel' }, { value: 'mock', label: 'Mock (development only)' }] },
      { key: 'exotelAccountSid', label: 'Exotel account SID', type: 'text', required: true, when: { field: 'provider', in: ['exotel'] } },
      { key: 'exotelApiKey', label: 'Exotel API key', type: 'text', required: true, when: { field: 'provider', in: ['exotel'] } },
      { key: 'exotelApiToken', label: 'Exotel API token', type: 'secret', required: true, when: { field: 'provider', in: ['exotel'] } },
      { key: 'exotelSubdomain', label: 'Exotel API host', type: 'select', default: 'api.in.exotel.com', options: [{ value: 'api.in.exotel.com', label: 'Mumbai (api.in.exotel.com)' }, { value: 'api.exotel.com', label: 'Singapore (api.exotel.com)' }], when: { field: 'provider', in: ['exotel'] } },
      { key: 'exotelCallerId', label: 'ExoPhone (caller id)', type: 'text', when: { field: 'provider', in: ['exotel'] }, placeholder: '08047xxxxxx', help: 'Virtual number shown to the customer.' },
    ],
  },
  monitoring: {
    key: 'monitoring',
    label: 'Error monitoring',
    description: 'Sentry DSNs for the API and the web app. The web DSN is public by design; the API DSN stays on the server.',
    icon: 'Bug',
    kind: 'registry',
    requiredInProduction: true,
    testable: true,
    testLabel: 'Send a test event',
    fields: [
      { key: 'sentryDsnApi', label: 'Sentry DSN (API)', type: 'secret', env: 'SENTRY_DSN', required: true, help: 'https://<key>@o<org>.ingest.sentry.io/<project>' },
      { key: 'sentryDsnWeb', label: 'Sentry DSN (web)', type: 'url', env: 'NEXT_PUBLIC_SENTRY_DSN' },
      { key: 'environment', label: 'Environment name', type: 'text', env: 'SENTRY_ENVIRONMENT', placeholder: 'production', help: 'Empty = NODE_ENV.' },
      { key: 'tracesSampleRate', label: 'Trace sample rate', type: 'number', decimal: true, min: 0, max: 1, default: 0.1 },
      { key: 'errorSampleRate', label: 'Error sample rate', type: 'number', decimal: true, min: 0, max: 1, default: 1 },
    ],
  },
  security: {
    key: 'security',
    label: 'Security policy',
    description: 'Password rules, session lifetimes, the Super Admin network allowlist and login rate limits. Safe defaults apply until changed.',
    icon: 'ShieldCheck',
    kind: 'registry',
    requiredInProduction: false,
    testable: false,
    fields: [
      { key: 'passwordMinLength', label: 'Minimum password length', type: 'number', min: 8, max: 64, default: 8, help: 'Applies to sign-up, invites and password resets (existing passwords keep working).' },
      { key: 'accessTokenTtlMin', label: 'Access token lifetime (minutes)', type: 'number', env: 'JWT_ACCESS_TTL', min: 5, max: 60, default: 15 },
      { key: 'refreshTokenTtlDays', label: 'Stay signed in for (days)', type: 'number', env: 'JWT_REFRESH_TTL', min: 1, max: 90, default: 30, help: 'Workspace refresh sessions; new sessions use the new value.' },
      { key: 'superIdleTimeoutMin', label: 'Super Admin idle timeout (minutes)', type: 'number', min: 5, max: 120, default: 30 },
      { key: 'superAbsoluteTimeoutHours', label: 'Super Admin session limit (hours)', type: 'number', min: 1, max: 24, default: 12 },
      { key: 'superIpAllowlist', label: 'Super Admin IP allowlist', type: 'list', itemPattern: IP_OR_CIDR, itemHelp: 'IPv4, IPv4 CIDR (10.0.0.0/8) or IPv6', default: [], help: 'Empty = any network. Applies on top of each admin\'s own allowlist. Add your current IP first or you lock yourself out.' },
      { key: 'loginRateLimitPerMinute', label: 'Login attempts per minute per IP', type: 'number', min: 3, max: 100, default: 10, help: 'Login, sign-up, Google sign-in, invite accept and password reset.' },
      { key: 'superLoginRateLimitPerMinute', label: 'Super Admin login attempts per minute per IP', type: 'number', min: 3, max: 50, default: 10 },
    ],
  },
  branding: {
    key: 'branding',
    label: 'Platform branding',
    description: "Tootodo's own name and contacts on the login, sign-up and legal pages and in platform e-mails.",
    icon: 'Palette',
    kind: 'registry',
    requiredInProduction: false,
    testable: false,
    fields: [
      { key: 'productName', label: 'Product name', type: 'text', default: 'Tootodo', maxLength: 60 },
      { key: 'supportEmail', label: 'Support e-mail', type: 'email', placeholder: 'support@example.com' },
      { key: 'supportPhone', label: 'Support phone', type: 'text', placeholder: '+91 80 0000 0000', maxLength: 30 },
      { key: 'websiteUrl', label: 'Website', type: 'url' },
      { key: 'termsUrl', label: 'Terms of service URL', type: 'url' },
      { key: 'privacyUrl', label: 'Privacy policy URL', type: 'url' },
      { key: 'emailFooter', label: 'E-mail footer text', type: 'textarea', maxLength: 500, placeholder: 'Tootodo Technologies Pvt Ltd, Bengaluru' },
    ],
  },
  // ---------------- existing cards (own routes; listed with a status)
  billing_profile: {
    key: 'billing_profile',
    label: 'Tootodo billing profile',
    description: "Tootodo's legal name, GSTIN, address with state code, bank details and invoice prefix on Tootodo invoices (GET|PUT /api/super/billing/profile).",
    icon: 'Landmark',
    kind: 'card',
    requiredInProduction: true,
    testable: false,
    cardAnchor: 'billing-profile',
    fields: [],
  },
  razorpay: {
    key: 'razorpay',
    label: 'Razorpay',
    description: 'Online payment of Tootodo invoices (GET|PUT|DELETE /api/super/config/razorpay).',
    icon: 'CreditCard',
    kind: 'card',
    requiredInProduction: true,
    testable: false,
    cardAnchor: 'razorpay',
    fields: [],
  },
  firebase: {
    key: 'firebase',
    label: 'Firebase (push)',
    description: 'google-services.json for the Android app and the service account for push (/api/super/config/firebase*).',
    icon: 'BellRing',
    kind: 'card',
    requiredInProduction: true,
    testable: false,
    cardAnchor: 'firebase',
    fields: [],
  },
  android_releases: {
    key: 'android_releases',
    label: 'Android releases',
    description: 'APK uploads; the employee panel links to the newest release (/api/super/android-releases).',
    icon: 'Smartphone',
    kind: 'card',
    requiredInProduction: true,
    testable: false,
    cardAnchor: 'android-releases',
    fields: [],
  },
} as const satisfies Record<string, ConfigGroupDef>;

export type ConfigGroupKey = keyof typeof PLATFORM_CONFIG_GROUPS;
export const CONFIG_GROUP_KEYS = Object.keys(PLATFORM_CONFIG_GROUPS) as ConfigGroupKey[];
export const ConfigGroupKeySchema = z.enum(CONFIG_GROUP_KEYS as [ConfigGroupKey, ...ConfigGroupKey[]]);
/** Groups whose fields are edited through PUT /api/super/config/groups/{group}. */
export type RegistryGroupKey = { [K in ConfigGroupKey]: (typeof PLATFORM_CONFIG_GROUPS)[K]['kind'] extends 'registry' ? K : never }[ConfigGroupKey];
export const REGISTRY_GROUP_KEYS = CONFIG_GROUP_KEYS.filter((k) => PLATFORM_CONFIG_GROUPS[k].kind === 'registry') as RegistryGroupKey[];
export const RegistryGroupKeySchema = z.enum(REGISTRY_GROUP_KEYS as [RegistryGroupKey, ...RegistryGroupKey[]]);

type FieldValueOf<F> = F extends { type: 'number' } ? number : F extends { type: 'boolean' } ? boolean : F extends { type: 'list' } ? string[] : string;
/** Resolved values of a group: every field, null when nothing is set (or the field does not apply). */
export type PlatformConfigValues<G extends RegistryGroupKey> = {
  [F in (typeof PLATFORM_CONFIG_GROUPS)[G]['fields'][number] as F['key']]: FieldValueOf<F> | null;
};

/** PlatformSetting key of a registry group. */
export const configSettingKey = (group: RegistryGroupKey) => `config.${group}`;

export function configGroupDef(group: ConfigGroupKey): ConfigGroupDef {
  return PLATFORM_CONFIG_GROUPS[group];
}

export function configFieldDef(group: ConfigGroupKey, key: string): ConfigFieldDef | undefined {
  return (PLATFORM_CONFIG_GROUPS[group].fields as readonly ConfigFieldDef[]).find((f) => f.key === key);
}

/** zod schema of one field's value (used by the API on save and by the web form). */
export function configFieldSchema(f: ConfigFieldDef): z.ZodType<ConfigValue> {
  switch (f.type) {
    case 'number': {
      let s = f.decimal ? z.number() : z.number().int();
      if (f.min !== undefined) s = s.min(f.min);
      if (f.max !== undefined) s = s.max(f.max);
      return s;
    }
    case 'boolean':
      return z.boolean();
    case 'list': {
      let item = z.string().trim().min(1).max(200);
      if (f.itemPattern) item = item.regex(new RegExp(f.itemPattern), { error: f.itemHelp ?? 'Invalid value' });
      return z.array(item).max(100);
    }
    case 'select': {
      const values = (f.options ?? []).map((o) => o.value);
      return z.string().refine((v) => values.includes(v), { error: `Use one of: ${values.join(', ')}` });
    }
    case 'email':
      return z.email().max(254);
    case 'url':
      return z.url({ protocol: /^https?$/ }).max(f.maxLength ?? 500);
    case 'secret':
      return z.string().min(1).max(f.maxLength ?? 10_000);
    case 'textarea':
      return z.string().max(f.maxLength ?? 5000);
    default:
      return z.string().trim().max(f.maxLength ?? 500);
  }
}

/** Is a field active for these values (its `when` condition holds)? */
export function configFieldActive(f: ConfigFieldDef, values: Readonly<Record<string, unknown>>): boolean {
  if (!f.when) return true;
  const v = values[f.when.field];
  return typeof v === 'string' && f.when.in.includes(v);
}

export interface ResolvedConfigField {
  value: ConfigValue | null;
  source: ConfigValueSource;
}

/** Arrays count as set (an empty allowlist saved in the panel is a real value). */
const empty = (v: unknown) => v === undefined || v === null || v === '';

/**
 * Resolution order for one field: panel -> env -> default -> dev default (not in production) -> none.
 * `env` is the already-parsed env value (the API maps env vars to field values).
 */
export function resolveConfigField(f: ConfigFieldDef, panel: ConfigValue | null | undefined, env: ConfigValue | null | undefined, production: boolean): ResolvedConfigField {
  if (!empty(panel)) return { value: panel as ConfigValue, source: 'panel' };
  if (!empty(env)) return { value: env as ConfigValue, source: 'env' };
  if (f.default !== undefined && f.type !== 'secret') return { value: f.default, source: 'default' };
  if (!production && f.devDefault !== undefined) return { value: f.devDefault, source: 'dev_default' };
  return { value: null, source: 'none' };
}

export interface ConfigGroupEvaluation {
  status: ConfigGroupStatus;
  /** Required active fields without a value. */
  missing: string[];
  /** Active fields whose value comes from the env. */
  fromEnv: string[];
  /** Active fields that use a development default. */
  devDefaults: string[];
}

/** Status of a registry group from its resolved fields. */
export function evaluateConfigGroup(group: ConfigGroupKey, resolved: Readonly<Record<string, ResolvedConfigField>>): ConfigGroupEvaluation {
  const values = Object.fromEntries(Object.entries(resolved).map(([k, r]) => [k, r.value]));
  const active = (PLATFORM_CONFIG_GROUPS[group].fields as readonly ConfigFieldDef[]).filter((f) => configFieldActive(f, values));
  const missing = active.filter((f) => f.required && (resolved[f.key]?.source ?? 'none') === 'none').map((f) => f.key);
  const fromEnv = active.filter((f) => resolved[f.key]?.source === 'env').map((f) => f.key);
  const devDefaults = active.filter((f) => resolved[f.key]?.source === 'dev_default').map((f) => f.key);
  const status: ConfigGroupStatus = missing.length ? 'missing' : devDefaults.length ? 'dev_default' : fromEnv.length ? 'env_fallback' : 'configured';
  return { status, missing, fromEnv, devDefaults };
}

/** "abcdefgh1234" -> "••••1234" (short secrets only show the bullets). */
export function maskSecretHint(value: string): string {
  return value.length >= 8 ? `••••${value.slice(-4)}` : '••••';
}

/** Parse a Sentry DSN (https://<key>@<host>/<projectId>); null when malformed. */
export function parseSentryDsn(dsn: string): { publicKey: string; host: string; projectId: string; protocol: 'https' | 'http' } | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+|\/+$/g, '').split('/').pop() ?? '';
    if (!u.username || !/^\d+$/.test(projectId) || (u.protocol !== 'https:' && u.protocol !== 'http:')) return null;
    return { publicKey: u.username, host: u.host, projectId, protocol: u.protocol === 'https:' ? 'https' : 'http' };
  } catch {
    return null;
  }
}
