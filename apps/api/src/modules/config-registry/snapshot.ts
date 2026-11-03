import {
  configFieldActive,
  evaluateConfigGroup,
  PLATFORM_CONFIG_GROUPS,
  REGISTRY_GROUP_KEYS,
  resolveConfigField,
  type ConfigFieldDef,
  type ConfigGroupEvaluation,
  type ConfigValue,
  type MailProviderKind,
  type PlatformConfigValues,
  type RegistryGroupKey,
  type ResolvedConfigField,
  type StorageDriverKind,
} from '@vistar/shared';
import { getEnv } from '../../config/env.js';

/**
 * PLATFORM CONFIG SNAPSHOT (change #20, D-073). The in-memory, already-resolved view of every registry group:
 * panel (database) -> env fallback -> safe default -> dev default (never in production).
 *
 * `PlatformConfigService` loads it at boot, refreshes it every 30 s and right after a save (other API instances
 * pick a change up within 30 s). Before the first load (scripts, unit tests) the snapshot is built from the env
 * only, so callers never wait. Read it synchronously anywhere:
 *
 *   const g = googleOAuthConfig();            // null when not configured
 *   const s = securityPolicy().passwordMinLength;
 *
 * Never log a snapshot: it holds decrypted secrets.
 */
export type PanelValues = Partial<Record<string, ConfigValue | null>>;

export interface ResolvedGroup<G extends RegistryGroupKey> {
  values: PlatformConfigValues<G>;
  fields: Record<string, ResolvedConfigField>;
  evaluation: ConfigGroupEvaluation;
}

export type PlatformConfigSnapshot = { readonly [G in RegistryGroupKey]: ResolvedGroup<G> } & { readonly loadedAt: number; readonly fromDatabase: boolean };

const fieldsOf = (group: RegistryGroupKey) => PLATFORM_CONFIG_GROUPS[group].fields as readonly ConfigFieldDef[];

/** "Vistar <no-reply@x.in>" -> { name, email }. */
function parseFrom(raw: string | undefined): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null };
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: m[1]!.trim() || null, email: m[2]!.trim() };
  return { name: null, email: raw.includes('@') ? raw.trim() : null };
}

/** "15m" -> 15 (minutes); "30d" -> 30 (days). */
function ttlIn(raw: string | undefined, unit: 'm' | 'd'): number | null {
  if (!raw) return null;
  const m = /^(\d+)\s*(s|m|h|d)?$/i.exec(raw.trim());
  if (!m) return null;
  const sec = Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86_400 } as Record<string, number>)[(m[2] ?? 's').toLowerCase()]!;
  const v = unit === 'm' ? Math.round(sec / 60) : Math.round(sec / 86_400);
  return v > 0 ? v : null;
}

const str = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/**
 * Env fallbacks per field (existing deployments keep working). Only the variables listed in `.env.example`
 * as "optional fallbacks"; the panel always wins.
 */
export function envFallbacks(group: RegistryGroupKey): Record<string, ConfigValue | null> {
  const env = getEnv();
  const raw = process.env;
  switch (group) {
    case 'email': {
      const from = parseFrom(env.SMTP_FROM);
      return {
        provider: env.SMTP_HOST ? 'smtp' : null,
        smtpHost: str(env.SMTP_HOST),
        smtpPort: env.SMTP_PORT ?? null,
        smtpUser: str(env.SMTP_USER),
        smtpPassword: str(env.SMTP_PASSWORD),
        fromName: from.name,
        fromEmail: from.email,
      };
    }
    case 'storage':
      return {
        driver: env.STORAGE_DRIVER ?? null,
        s3Endpoint: str(env.S3_ENDPOINT),
        s3Region: str(env.S3_REGION),
        s3Bucket: str(env.S3_BUCKET),
        s3AccessKey: str(env.S3_ACCESS_KEY),
        s3SecretKey: str(env.S3_SECRET_KEY),
        s3ForcePathStyle: raw.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE : null,
        publicBaseUrl: str(env.S3_PUBLIC_BASE_URL),
      };
    case 'google_oauth':
      return { clientId: str(env.GOOGLE_CLIENT_ID), clientSecret: str(env.GOOGLE_CLIENT_SECRET) };
    case 'whatsapp_app':
      return { appId: str(env.WHATSAPP_APP_ID), appSecret: str(env.WHATSAPP_APP_SECRET), verifyToken: str(env.WHATSAPP_VERIFY_TOKEN), graphVersion: str(env.WHATSAPP_GRAPH_VERSION) };
    case 'telephony':
      return { provider: str(env.TELEPHONY_PROVIDER) };
    case 'monitoring':
      return { sentryDsnApi: str(env.SENTRY_DSN), sentryDsnWeb: str(raw.NEXT_PUBLIC_SENTRY_DSN), environment: str(env.SENTRY_ENVIRONMENT) };
    case 'security':
      // Only explicit env values count (env.ts has parsing defaults for these two).
      return { accessTokenTtlMin: ttlIn(raw.JWT_ACCESS_TTL, 'm'), refreshTokenTtlDays: ttlIn(raw.JWT_REFRESH_TTL, 'd') };
    default:
      return {};
  }
}

/** Resolve one group from its panel values (non-secret and decrypted secret values merged). */
export function resolveGroup<G extends RegistryGroupKey>(group: G, panel: PanelValues, production: boolean): ResolvedGroup<G> {
  const env = envFallbacks(group);
  const fields: Record<string, ResolvedConfigField> = {};
  for (const f of fieldsOf(group)) fields[f.key] = resolveConfigField(f, panel[f.key], env[f.key], production);
  // Fields whose `when` condition does not hold resolve to null (an S3 key is meaningless with driver bunny).
  const raw = Object.fromEntries(Object.entries(fields).map(([k, r]) => [k, r.value]));
  const values = Object.fromEntries(fieldsOf(group).map((f) => [f.key, configFieldActive(f, raw) ? fields[f.key]!.value : null])) as PlatformConfigValues<G>;
  return { values, fields, evaluation: evaluateConfigGroup(group, fields) };
}

export function buildSnapshot(panels: Partial<Record<RegistryGroupKey, PanelValues>>, fromDatabase: boolean): PlatformConfigSnapshot {
  const production = getEnv().NODE_ENV === 'production';
  const groups = Object.fromEntries(REGISTRY_GROUP_KEYS.map((g) => [g, resolveGroup(g, panels[g] ?? {}, production)]));
  return { ...groups, loadedAt: Date.now(), fromDatabase } as PlatformConfigSnapshot;
}

let current: PlatformConfigSnapshot | null = null;

/** The current snapshot (env-only until PlatformConfigService has loaded the database). */
export function platformConfig(): PlatformConfigSnapshot {
  if (!current) current = buildSnapshot({}, false);
  return current;
}

/** Called by PlatformConfigService after a load or a save. */
export function setPlatformConfigSnapshot(next: PlatformConfigSnapshot): void {
  current = next;
}

/** Tests: drop the snapshot so the next read rebuilds it from the env. */
export function resetPlatformConfigSnapshot(): void {
  current = null;
}

const isProduction = () => getEnv().NODE_ENV === 'production';

// ---------------------------------------------------------------- typed getters

export interface MailConfig {
  provider: MailProviderKind;
  smtp: { host: string; port: number; tls: 'starttls' | 'tls' | 'none'; user: string | null; password: string | null } | null;
  apiKey: string | null;
  from: { name: string; email: string };
  replyTo: string | null;
  /** Values come from a development default (Mailpit). */
  devDefault: boolean;
}

/** Platform mailer settings; null = not configured (production refuses to send). */
export function mailConfig(): MailConfig | null {
  const g = platformConfig().email;
  if (g.evaluation.status === 'missing') return null;
  const v = g.values;
  const provider = (v.provider ?? 'smtp') as MailProviderKind;
  return {
    provider,
    smtp: provider === 'smtp' && v.smtpHost ? { host: v.smtpHost, port: v.smtpPort ?? 587, tls: (v.smtpTls ?? 'starttls') as 'starttls' | 'tls' | 'none', user: v.smtpUser, password: v.smtpPassword } : null,
    apiKey: v.apiKey,
    from: { name: v.fromName ?? platformBranding().productName, email: v.fromEmail! },
    replyTo: v.replyTo ?? platformBranding().supportEmail,
    devDefault: g.evaluation.status === 'dev_default',
  };
}

export type StorageConfig =
  | { driver: 'local'; root: string | null }
  | { driver: 's3'; endpoint: string | null; region: string; bucket: string; accessKey: string; secretKey: string; forcePathStyle: boolean; publicBaseUrl: string | null }
  | { driver: 'bunny'; storageZone: string; region: string; password: string; publicBaseUrl: string | null };

/** Storage for NEW uploads; null = not configured (production without a cloud driver: uploads answer CONFIG_MISSING). */
export function storageConfig(): StorageConfig | null {
  const g = platformConfig().storage;
  const v = g.values;
  const driver = v.driver as StorageDriverKind | null;
  const root = getEnv().STORAGE_LOCAL_ROOT ?? null;
  if (g.evaluation.status === 'missing' || !driver) return null;
  if (driver === 's3') return { driver, endpoint: v.s3Endpoint, region: v.s3Region ?? 'ap-south-1', bucket: v.s3Bucket!, accessKey: v.s3AccessKey!, secretKey: v.s3SecretKey!, forcePathStyle: v.s3ForcePathStyle ?? false, publicBaseUrl: v.publicBaseUrl };
  if (driver === 'bunny') return { driver, storageZone: v.bunnyStorageZone!, region: v.bunnyRegion ?? 'de', password: v.bunnyPassword!, publicBaseUrl: v.publicBaseUrl };
  // Production never writes new uploads to the local disk, whatever the source (panel refuses it, env STORAGE_DRIVER=local
  // included): uploads answer CONFIG_MISSING and the go-live checklist fails until S3 or Bunny is set.
  if (isProduction()) return null;
  return { driver: 'local', root };
}

/** Last known settings of a driver even when it is not the active one (reading old files after a switch). */
export function storageDriverConfig(driver: StorageDriverKind): StorageConfig | null {
  const v = platformConfig().storage.values as Record<string, ConfigValue | null>;
  const panel = platformConfig().storage.fields;
  const val = (k: string) => (panel[k]?.value ?? v[k] ?? null) as string | null;
  if (driver === 'local') return { driver, root: getEnv().STORAGE_LOCAL_ROOT ?? null };
  if (driver === 's3') {
    const bucket = val('s3Bucket');
    const accessKey = val('s3AccessKey');
    const secretKey = val('s3SecretKey');
    if (!bucket || !accessKey || !secretKey) return null;
    return { driver, endpoint: val('s3Endpoint'), region: val('s3Region') ?? 'ap-south-1', bucket, accessKey, secretKey, forcePathStyle: panel.s3ForcePathStyle?.value === true, publicBaseUrl: val('publicBaseUrl') };
  }
  const zone = val('bunnyStorageZone');
  const password = val('bunnyPassword');
  if (!zone || !password) return null;
  return { driver, storageZone: zone, region: val('bunnyRegion') ?? 'de', password, publicBaseUrl: val('publicBaseUrl') };
}

/** Google OAuth client (sign in with Google, Google Calendar); null = not configured. */
export function googleOAuthConfig(): { clientId: string; clientSecret: string } | null {
  const v = platformConfig().google_oauth.values;
  return v.clientId && v.clientSecret ? { clientId: v.clientId, clientSecret: v.clientSecret } : null;
}

/** Client id alone (ID-token audience for sign in with Google works without the secret). */
export function googleClientId(): string | null {
  return platformConfig().google_oauth.values.clientId;
}

/** WhatsApp platform app (shared webhook). Fields are null when not set. */
export function whatsappAppConfig(): { appId: string | null; appSecret: string | null; verifyToken: string | null; graphVersion: string } {
  const v = platformConfig().whatsapp_app.values;
  return { appId: v.appId, appSecret: v.appSecret, verifyToken: v.verifyToken, graphVersion: v.graphVersion ?? 'v23.0' };
}

export type PlatformTelephonyConfig =
  | { provider: 'mock' }
  | { provider: 'exotel'; accountSid: string; apiKey: string; apiToken: string; subdomain: string; callerId: string | null };

/** Platform telephony account; null = not configured. `mock` never in production. */
export function telephonyConfig(): PlatformTelephonyConfig | null {
  const g = platformConfig().telephony;
  const v = g.values;
  if (g.evaluation.status === 'missing') return null;
  if (v.provider === 'exotel') return { provider: 'exotel', accountSid: v.exotelAccountSid!, apiKey: v.exotelApiKey!, apiToken: v.exotelApiToken!, subdomain: v.exotelSubdomain ?? 'api.in.exotel.com', callerId: v.exotelCallerId };
  if (v.provider === 'mock' && !isProduction()) return { provider: 'mock' };
  return null;
}

export interface MonitoringConfig {
  apiDsn: string | null;
  webDsn: string | null;
  environment: string;
  tracesSampleRate: number;
  errorSampleRate: number;
}

export function monitoringConfig(): MonitoringConfig {
  const v = platformConfig().monitoring.values;
  return { apiDsn: v.sentryDsnApi, webDsn: v.sentryDsnWeb, environment: v.environment ?? getEnv().NODE_ENV, tracesSampleRate: v.tracesSampleRate ?? 0.1, errorSampleRate: v.errorSampleRate ?? 1 };
}

export interface SecurityPolicy {
  passwordMinLength: number;
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
  superIdleTimeoutMs: number;
  superAbsoluteTimeoutMs: number;
  superIpAllowlist: string[];
  loginRateLimitPerMinute: number;
  superLoginRateLimitPerMinute: number;
}

export function securityPolicy(): SecurityPolicy {
  const v = platformConfig().security.values;
  return {
    passwordMinLength: v.passwordMinLength ?? 8,
    accessTokenTtlSec: (v.accessTokenTtlMin ?? 15) * 60,
    refreshTokenTtlSec: (v.refreshTokenTtlDays ?? 30) * 86_400,
    superIdleTimeoutMs: (v.superIdleTimeoutMin ?? 30) * 60_000,
    superAbsoluteTimeoutMs: (v.superAbsoluteTimeoutHours ?? 12) * 3_600_000,
    superIpAllowlist: v.superIpAllowlist ?? [],
    loginRateLimitPerMinute: v.loginRateLimitPerMinute ?? 10,
    superLoginRateLimitPerMinute: v.superLoginRateLimitPerMinute ?? 10,
  };
}

export interface PlatformBranding {
  productName: string;
  supportEmail: string | null;
  supportPhone: string | null;
  websiteUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  emailFooter: string | null;
}

export function platformBranding(): PlatformBranding {
  const v = platformConfig().branding.values;
  return { productName: v.productName ?? 'Vistar', supportEmail: v.supportEmail, supportPhone: v.supportPhone, websiteUrl: v.websiteUrl, termsUrl: v.termsUrl, privacyUrl: v.privacyUrl, emailFooter: v.emailFooter };
}
