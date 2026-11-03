import type { Env } from '../../config/env.js';

/**
 * Strict production boot (change #20, SPEC 30, D-075). With NODE_ENV=production the API refuses to start when a
 * bootstrap value is unsafe: example or weak secrets, http or localhost public URLs, dev CORS origins, DEV_AUTH,
 * local storage or a mock provider forced through env, no Redis, a weak database password. Everything that lives
 * in the panels (mailer, storage credentials, Razorpay, Firebase, Sentry) is checked by the Super Admin go-live
 * checklist instead, so a fresh server can boot and be configured. Pure functions: unit tested without a server.
 */

/** Values that ship in docs, examples, CI and the dev compose file. Never valid in production. */
const KNOWN_WEAK = new Set(
  [
    'changeme',
    'change-me',
    'secret',
    'password',
    'vistar',
    'vistar-dev-secret',
    'vistar-dev-mock-razorpay-secret',
    'development',
    'test',
    'example',
    'please-change-me',
    'replace-me',
    'your-secret-here',
  ].map((s) => s.toLowerCase()),
);

const SECRET_MIN_LENGTH = 32;
const SECRET_MIN_DISTINCT = 12;
const DB_PASSWORD_MIN_LENGTH = 12;

export interface ProductionIssue {
  key: string;
  problem: string;
}

/** Why a secret is too weak for production, or null when it is fine. */
export function weakSecretReason(value: string | undefined, minLength = SECRET_MIN_LENGTH): string | null {
  if (!value) return 'is empty';
  const v = value.trim();
  if (v.length < minLength) return `is shorter than ${minLength} characters`;
  const lower = v.toLowerCase();
  if (KNOWN_WEAK.has(lower)) return 'is an example value';
  for (const weak of KNOWN_WEAK) if (lower.includes(weak) && weak.length >= 6 && v.length < weak.length + 16) return `looks like an example value ("${weak}")`;
  if (new Set(v).size < SECRET_MIN_DISTINCT) return 'repeats too few characters (generate it with pnpm setup:env or openssl rand -base64 48)';
  return null;
}

/** https and not a local host. */
export function publicUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'is not a URL';
  }
  if (url.protocol !== 'https:') return 'must use https';
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '0.0.0.0') return 'must not point at localhost';
  return null;
}

function databasePasswordProblem(databaseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return 'is not a URL';
  }
  const password = decodeURIComponent(url.password);
  if (!password) return null; // peer / IAM auth or a socket without password: nothing to judge
  const reason = weakSecretReason(password, DB_PASSWORD_MIN_LENGTH);
  return reason ? `password ${reason}` : null;
}

/**
 * All production problems of the env. `raw` is process.env (explicitly set values, before defaults), `env` the parsed
 * env. Returns [] outside production.
 */
export function productionIssues(env: Env, raw: NodeJS.ProcessEnv = process.env): ProductionIssue[] {
  if (env.NODE_ENV !== 'production') return [];
  const issues: ProductionIssue[] = [];
  const add = (key: string, problem: string | null) => {
    if (problem) issues.push({ key, problem });
  };

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'SUPER_JWT_SECRET'] as const) add(key, weakSecretReason(env[key]));
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) add('JWT_REFRESH_SECRET', 'must differ from JWT_ACCESS_SECRET');
  const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) add('ENCRYPTION_KEY', 'must be 32 bytes, base64');
  else if (new Set(key).size < 16) add('ENCRYPTION_KEY', 'is not random (generate it with: openssl rand -base64 32)');

  add('API_PUBLIC_URL', publicUrlProblem(env.API_PUBLIC_URL));
  const origins = env.WEB_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  if (!origins.length) add('WEB_ORIGIN', 'is empty');
  for (const origin of origins) {
    if (origin === '*') add('WEB_ORIGIN', 'must list exact origins, not *');
    else add('WEB_ORIGIN', publicUrlProblem(origin) ? `${origin} ${publicUrlProblem(origin)}` : null);
  }

  if (!env.REDIS_URL) add('REDIS_URL', 'is required in production (events across instances, rate limits, OAuth state, job leases)');
  add('DATABASE_URL', databasePasswordProblem(env.DATABASE_URL));

  if (env.DEV_AUTH) add('DEV_AUTH', 'must be off in production');
  if (raw.DEV_CORS_PORTS) add('DEV_CORS_PORTS', 'is a development setting; remove it (dev CORS origins are never allowed in production)');
  if (raw.OUTBOUND_ALLOW_PRIVATE_HOSTS) add('OUTBOUND_ALLOW_PRIVATE_HOSTS', 'is a development allowlist; remove it');

  // Forced through env: local disk storage and mock providers are development tools.
  if ((raw.STORAGE_DRIVER ?? '').trim().toLowerCase() === 'local') add('STORAGE_DRIVER', 'local disk storage is not allowed in production: use s3 or bunny (Super Admin > Config > File storage, or env)');
  if (env.BILLING_PROVIDER === 'mock') add('BILLING_PROVIDER', 'mock checkout is not allowed in production (auto, razorpay or none)');
  if ((raw.TELEPHONY_PROVIDER ?? '').trim().toLowerCase() === 'mock') add('TELEPHONY_PROVIDER', 'the mock telephony provider is not allowed in production; remove the variable');
  if ((raw.NEXT_PUBLIC_DATA_SOURCE ?? '').trim().toLowerCase() === 'mock') add('NEXT_PUBLIC_DATA_SOURCE', 'mock data is for automated tests only');

  // Demo seed: the image has no tsx, and the seed refuses production; an explicit flag is a mistake.
  if (raw.SEED_DEMO === '1' || raw.SEED_DEMO === 'true') add('SEED_DEMO', 'demo data is never seeded in production');
  return issues;
}

/** Throw with a readable list when production problems exist. Call before NestFactory.create(). */
export function assertProductionConfig(env: Env, raw: NodeJS.ProcessEnv = process.env): void {
  const issues = productionIssues(env, raw);
  if (!issues.length) return;
  const list = issues.map((i) => `  - ${i.key} ${i.problem}`).join('\n');
  throw new Error(`Refusing to start in production. Fix these settings (docs/DEPLOY.md, "Environment"):\n${list}`);
}
