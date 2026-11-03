import { config } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// apps/api/.env (optional, wins) then monorepo root .env. Secrets live only in server env.
config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars (run: pnpm setup:env)'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars (run: pnpm setup:env)'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  SUPER_JWT_SECRET: z.string().min(32, 'SUPER_JWT_SECRET must be at least 32 chars (run: pnpm setup:env)'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64 (run: pnpm setup:env)'),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().default('vistar'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  /** Public CDN base (e.g. Bunny pull zone) for public files only; private files use signed URLs. */
  S3_PUBLIC_BASE_URL: z.string().optional(),

  /** Upload storage (D-065): `local` disk driver in development, `s3` for S3 / MinIO / Bunny (S3_* vars). */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** Root of the local driver; default `<repo root>/.data/uploads` (gitignored). */
  STORAGE_LOCAL_ROOT: z.string().optional(),
  /** Lifetime of signed download URLs (GET /files/{id}/url), seconds. */
  FILE_URL_TTL_SEC: z.coerce.number().int().min(60).max(86_400).default(900),
  /** CNAME target shown in the custom-domain DNS instructions (D-060), e.g. the load balancer host. */
  CUSTOM_DOMAIN_CNAME_TARGET: z.string().default('localhost'),
  /** Extra dev CORS origins: http://localhost:<port> and http://127.0.0.1:<port> for this port range (not in production). */
  DEV_CORS_PORTS: z.string().regex(/^\d{2,5}-\d{2,5}$/).default('3000-3010'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().default('v23.0'),

  TELEPHONY_PROVIDER: z.string().default('mock'),
  // ---- change #19 wave C: hub
  /** Hosts the outbound HTTP client and SMTP may reach although private (dev receivers, Mailpit). Ignored in production. Default localhost,127.0.0.1,::1. */
  OUTBOUND_ALLOW_PRIVATE_HOSTS: z.string().optional(),
  /** IndiaMART Lead Manager pull API (CRM Listing v2). */
  INDIAMART_API_URL: z.string().url().default('https://mapi.indiamart.com/wservce/crm/crmListing/v2/'),
  /** Meta Graph API base for WhatsApp Cloud API calls. */
  WHATSAPP_GRAPH_URL: z.string().url().default('https://graph.facebook.com'),
  /** Background hub jobs in this process: outbound webhook worker and sweeper, IndiaMART pull cron. "off" for extra API replicas. */
  HUB_BACKGROUND_JOBS: z.enum(['on', 'off']).default('on'),
  // ---- end change #19 wave C: hub
  FEATURE_AI_NODE: bool,
  /** Express "trust proxy" (e.g. "loopback", "1", "10.0.0.0/8"). Needed for real client IPs behind a load balancer. */
  TRUST_PROXY: z.string().optional(),
  /** Wave 1 dev-only header auth (x-dev-user). Refused in production. */
  DEV_AUTH: bool,
}).refine((e) => e.SUPER_JWT_SECRET !== e.JWT_ACCESS_SECRET && e.SUPER_JWT_SECRET !== e.JWT_REFRESH_SECRET, {
  message: 'SUPER_JWT_SECRET must differ from the workspace JWT secrets',
  path: ['SUPER_JWT_SECRET'],
}).refine((e) => !(e.DEV_AUTH && e.NODE_ENV === 'production'), {
  message: 'DEV_AUTH must never be enabled in production',
  path: ['DEV_AUTH'],
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parsed, validated server env. Throws with a readable list of problems. Never log the result. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}
