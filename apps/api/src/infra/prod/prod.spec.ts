import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env.js';
import { parseDsn } from './error-reporter.js';
import { truncateIp } from './http-middleware.js';
import { levelsFrom } from './logger.js';
import { productionIssues, publicUrlProblem, weakSecretReason } from './production-config.js';
import { bucketOf } from './rate-limit.js';
import { redact, redactPath } from './redact.js';
import { mayIssueCertificate, ownHosts } from './tls-ask.js';

// change #20 (PROD-HUB): pure production pieces. Written for the Kiro Crew run; not executed in this wave.

const STRONG = 'q7Lk2pX9vRt4mWz8Nc3Hb6Yf1Jd5Gs0AeUiOoP-_xyz';
const STRONG2 = 'Zx8Cv7Bn6Mm5Ll4Kk3Jj2Hh1Gg0Ff9Dd8Ss7Aa6Qq5Ww';
const STRONG3 = 'Pp1Oo2Ii3Uu4Yy5Tt6Rr7Ee8Ww9Qq0Aa1Ss2Dd3Ff4Gg';
const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256)).toString('base64');

function env(over: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'production',
    API_PORT: 4000,
    WEB_ORIGIN: 'https://app.vistar.in',
    API_PUBLIC_URL: 'https://api.vistar.in',
    DATABASE_URL: 'postgresql://vistar:Xk29fLm0qPz7Rt5w@postgres:5432/vistar',
    REDIS_URL: 'redis://:pw@redis:6379',
    JWT_ACCESS_SECRET: STRONG,
    JWT_REFRESH_SECRET: STRONG2,
    SUPER_JWT_SECRET: STRONG3,
    ENCRYPTION_KEY: KEY,
    BILLING_PROVIDER: 'auto',
    DEV_AUTH: false,
    ...over,
  } as Env;
}

describe('production config', () => {
  it('passes a clean production env', () => {
    expect(productionIssues(env(), {})).toEqual([]);
  });

  it('ignores development', () => {
    expect(productionIssues(env({ NODE_ENV: 'development', JWT_ACCESS_SECRET: 'x' }), {})).toEqual([]);
  });

  it('rejects weak and example secrets', () => {
    expect(weakSecretReason('short')).toMatch(/shorter/);
    expect(weakSecretReason('a'.repeat(40))).toMatch(/repeats/);
    expect(weakSecretReason(STRONG)).toBeNull();
    const keys = productionIssues(env({ JWT_ACCESS_SECRET: 'changeme'.repeat(5) }), {}).map((i) => i.key);
    expect(keys).toContain('JWT_ACCESS_SECRET');
  });

  it('requires different access and refresh secrets and a random encryption key', () => {
    expect(productionIssues(env({ JWT_REFRESH_SECRET: STRONG }), {}).map((i) => i.key)).toContain('JWT_REFRESH_SECRET');
    expect(productionIssues(env({ ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') }), {}).map((i) => i.key)).toContain('ENCRYPTION_KEY');
  });

  it('requires https public URLs without localhost', () => {
    expect(publicUrlProblem('http://api.vistar.in')).toMatch(/https/);
    expect(publicUrlProblem('https://localhost:4000')).toMatch(/localhost/);
    expect(publicUrlProblem('https://api.vistar.in')).toBeNull();
    const keys = productionIssues(env({ WEB_ORIGIN: 'https://app.vistar.in,http://localhost:3000' }), {}).map((i) => i.key);
    expect(keys).toContain('WEB_ORIGIN');
  });

  it('refuses dev auth, dev CORS, mocks, local storage, demo seed and a missing Redis', () => {
    const issues = productionIssues(env({ DEV_AUTH: true, BILLING_PROVIDER: 'mock', REDIS_URL: undefined }), {
      DEV_CORS_PORTS: '3000-3010',
      STORAGE_DRIVER: 'local',
      TELEPHONY_PROVIDER: 'mock',
      SEED_DEMO: '1',
    }).map((i) => i.key);
    expect(issues).toEqual(expect.arrayContaining(['DEV_AUTH', 'BILLING_PROVIDER', 'REDIS_URL', 'DEV_CORS_PORTS', 'STORAGE_DRIVER', 'TELEPHONY_PROVIDER', 'SEED_DEMO']));
  });

  it('refuses the dev database password', () => {
    expect(productionIssues(env({ DATABASE_URL: 'postgresql://vistar:vistar@postgres:5432/vistar' }), {}).map((i) => i.key)).toContain('DATABASE_URL');
  });
});

describe('redaction', () => {
  it('masks e-mails, phones, tokens and secrets', () => {
    const out = redact('mail asha@shakti.in phone +91 98765 43210 Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk key vst_live_abcdef123456 password=hunter2 {"appSecret":"s3cr3t"}');
    expect(out).not.toContain('asha@');
    expect(out).toContain('***@shakti.in');
    expect(out).not.toContain('98765');
    expect(out).not.toContain('eyJhbGci');
    expect(out).not.toContain('abcdef123456');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('s3cr3t');
  });

  it('masks credentials in URLs and GSTIN', () => {
    expect(redact('postgresql://vistar:pw123@db:5432/x')).toBe('postgresql://***:***@db:5432/x');
    expect(redact('GSTIN 27AAPFU0939F1ZV')).toContain('[gstin]');
  });

  it('drops query strings and token path segments', () => {
    expect(redactPath('/api/hooks/abc/indiamart?key=secret')).toBe('/api/hooks/abc/indiamart');
    expect(redactPath('/api/files/d/tok123')).toBe('/api/files/d/***');
    expect(redactPath('/api/v1/public/documents/tok/pdf')).toBe('/api/v1/public/documents/***/pdf');
  });

  it('truncates IPs', () => {
    expect(truncateIp('203.0.113.77')).toBe('203.0.113.0');
    expect(truncateIp('::ffff:203.0.113.77')).toBe('203.0.113.0');
    expect(truncateIp('2001:db8:1:2::5')).toBe('2001:db8:1::');
  });

  it('log levels from a minimum', () => {
    expect(levelsFrom('warn')).toEqual(['warn', 'error', 'fatal']);
  });
});

describe('rate limit buckets', () => {
  it('maps paths to buckets', () => {
    expect(bucketOf('/api/v1/auth/login')).toBe('auth');
    expect(bucketOf('/api/super/auth/verify')).toBe('auth');
    expect(bucketOf('/api/v1/invites/lookup')).toBe('auth');
    expect(bucketOf('/api/v1/auth/refresh')).toBeNull();
    expect(bucketOf('/api/v1/public/forms/x/submit')).toBe('public');
    expect(bucketOf('/api/files/p/123')).toBe('files');
    expect(bucketOf('/api/hooks/w/whatsapp')).toBe('hooks');
    expect(bucketOf('/api/v1/leads')).toBeNull();
  });
});

describe('on-demand TLS ask', () => {
  const e = { WEB_ORIGIN: 'https://app.vistar.in', API_PUBLIC_URL: 'https://api.vistar.in' };
  it('allows own hosts and verified custom domains only', async () => {
    expect(ownHosts(e)).toEqual(new Set(['app.vistar.in', 'api.vistar.in']));
    const verified = async () => new Set(['crm.shakti.in']);
    expect(await mayIssueCertificate('app.vistar.in', e, verified)).toBe(true);
    expect(await mayIssueCertificate('CRM.Shakti.in.', e, verified)).toBe(true);
    expect(await mayIssueCertificate('random.example.com', e, verified)).toBe(false);
    expect(await mayIssueCertificate('10.0.0.1', e, verified)).toBe(false);
    expect(await mayIssueCertificate('x.localhost', e, verified)).toBe(false);
  });
});

describe('Sentry DSN', () => {
  it('parses the envelope URL and key', () => {
    expect(parseDsn('https://abc123@o1.ingest.sentry.io/4507')).toEqual({ url: 'https://o1.ingest.sentry.io/api/4507/envelope/', key: 'abc123' });
    expect(parseDsn('http://abc@host/1')).toBeNull();
    expect(parseDsn('not a dsn')).toBeNull();
  });
});
