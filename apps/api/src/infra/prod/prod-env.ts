import { z } from 'zod';
import { getEnv } from '../../config/env.js';

/**
 * Production tuning values (change #20, PROD-HUB). Bootstrap-level knobs that are not panel config: database pool,
 * shutdown timings, log level, rate limits and body size. All optional with safe defaults; parsed from process.env
 * after `getEnv()` has loaded the .env files. Never log the result of getEnv(); this object holds no secrets.
 */
const int = (min: number, max: number, dflt: number) => z.coerce.number().int().min(min).max(max).default(dflt);

const ProdEnvSchema = z.object({
  /** Connections per API process in the pg pool (Prisma driver adapter). */
  DB_POOL_MAX: int(1, 200, 10),
  DB_POOL_IDLE_MS: int(1_000, 600_000, 30_000),
  DB_CONNECT_TIMEOUT_MS: int(500, 60_000, 5_000),
  /** After SIGTERM: /api/ready answers 503 for this long so the proxy stops sending traffic, then HTTP drains. */
  SHUTDOWN_DRAIN_MS: int(0, 60_000, 5_000),
  /** Hard limit for the whole shutdown (drain + close); the process exits with code 1 after it. */
  SHUTDOWN_TIMEOUT_MS: int(1_000, 120_000, 25_000),
  /** error | warn | log | debug | verbose. */
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
  /** json (default in production) or text. */
  LOG_FORMAT: z.enum(['json', 'text']).optional(),
  /** Per IP and minute on /api/v1/auth/* and /api/super/auth/* (all API instances together when Redis is set). */
  RATE_LIMIT_AUTH_PER_MIN: int(1, 10_000, 20),
  /** Per IP and minute on public routes (/api/v1/public/*, files, OAuth callback, OpenAPI). */
  RATE_LIMIT_PUBLIC_PER_MIN: int(1, 100_000, 60),
  /** Per IP and minute on /api/hooks/* (provider callbacks are bursty). */
  RATE_LIMIT_HOOKS_PER_MIN: int(1, 100_000, 1_200),
  /** Per signed-in user (or API key) and minute on every authenticated route. */
  RATE_LIMIT_USER_PER_MIN: int(1, 100_000, 600),
  /** JSON / form body limit (express body-parser syntax). 100kb matches WEBHOOK_MAX_INBOUND_BYTES. */
  BODY_LIMIT_JSON: z.string().regex(/^\d+(b|kb|mb)$/i).default('100kb'),
  /** Version string reported by /api/health and /api/ready and sent to error monitoring (the image sets the git sha). */
  APP_VERSION: z.string().max(80).optional(),
  /** Error monitoring fallback when Super Admin > Config > Error monitoring is empty. */
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().max(60).optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  SENTRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
});

export type ProdEnv = z.infer<typeof ProdEnvSchema>;

let cached: ProdEnv | null = null;

export function getProdEnv(): ProdEnv {
  if (cached) return cached;
  getEnv(); // loads the .env files first
  const parsed = ProdEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** Version shown by health checks and error reports. */
export function appVersion(): string {
  return getProdEnv().APP_VERSION ?? process.env.npm_package_version ?? '0.1.0';
}

/** Tests only. */
export function resetProdEnvForTests(): void {
  cached = null;
}
