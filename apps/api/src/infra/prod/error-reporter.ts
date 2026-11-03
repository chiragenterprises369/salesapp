import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { getEnv } from '../../config/env.js';
import { safeFetch } from '../http/safe-http.js';
import { appVersion, getProdEnv } from './prod-env.js';
import { redact } from './redact.js';
import { currentRequest } from './request-context.js';

/**
 * Error monitoring (change #20): unhandled API errors (5xx from the exception filter, unhandled rejections and
 * uncaught exceptions) go to a Sentry-compatible endpoint as envelopes, without an SDK dependency. Settings come
 * from Super Admin > Config > Error monitoring (CONFIG-API registry, through `setErrorReportingSource`) with the
 * env fallback SENTRY_DSN / SENTRY_ENVIRONMENT / SENTRY_SAMPLE_RATE. Reports carry the redacted message and stack,
 * the request id, method and redacted path, the user and workspace ids, never bodies, headers or query strings.
 * At most 30 reports a minute per process; delivery failures are swallowed.
 */
export interface ErrorReportingConfig {
  dsn: string;
  environment: string;
  sampleRate: number;
}

export type ErrorReportingSource = () => Promise<ErrorReportingConfig | null>;

interface ParsedDsn {
  url: string;
  key: string;
}

/** https://<key>@<host>/<projectId> -> envelope URL and public key. */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn.trim());
    const projectId = u.pathname.replace(/^\/+|\/+$/g, '').split('/').pop();
    if (u.protocol !== 'https:' || !u.username || !projectId || !/^\d+$/.test(projectId)) return null;
    const prefix = u.pathname.replace(/\/?\d+\/?$/, '');
    return { url: `https://${u.host}${prefix}/api/${projectId}/envelope/`, key: decodeURIComponent(u.username) };
  } catch {
    return null;
  }
}

const envSource: ErrorReportingSource = async () => {
  const env = getProdEnv();
  if (!env.SENTRY_DSN) return null;
  return { dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT ?? getEnv().NODE_ENV, sampleRate: env.SENTRY_SAMPLE_RATE ?? 1 };
};

let source: ErrorReportingSource = envSource;
let cache: { at: number; value: ErrorReportingConfig | null } | null = null;
const CACHE_MS = 60_000;
const MAX_PER_MINUTE = 30;
let windowStart = 0;
let sentInWindow = 0;
const logger = new Logger('ErrorReporter');

/** Registry hook: panel config first, env fallback (the registry decides; null = monitoring off). */
export function setErrorReportingSource(next: ErrorReportingSource): void {
  source = next;
  cache = null;
}

/** Drop the cached config (registry change event). */
export function invalidateErrorReportingConfig(): void {
  cache = null;
}

async function config(): Promise<ErrorReportingConfig | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = await source().catch(() => null);
  cache = { at: Date.now(), value };
  return value;
}

function frames(stack: string | undefined): Array<{ function?: string; filename?: string; lineno?: number; colno?: number; in_app: boolean }> {
  if (!stack) return [];
  const out = [];
  for (const line of stack.split('\n').slice(1, 40)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2]!.replace(/^file:\/\//, '');
    out.push({ function: m[1], filename, lineno: Number(m[3]), colno: Number(m[4]), in_app: !filename.includes('node_modules') && !filename.startsWith('node:') });
  }
  // Sentry wants the innermost frame last
  return out.reverse();
}

export interface ReportContext {
  /** Extra tags (no PII). */
  tags?: Record<string, string>;
  level?: 'error' | 'fatal' | 'warning';
}

/** Report one error. Never throws, never awaits the network in the caller's critical path (fire and forget). */
export function reportError(err: unknown, ctx: ReportContext = {}): void {
  void send(err, ctx).catch(() => undefined);
}

async function send(err: unknown, ctx: ReportContext): Promise<void> {
  const cfg = await config();
  if (!cfg) return;
  const dsn = parseDsn(cfg.dsn);
  if (!dsn) return;
  if (cfg.sampleRate < 1 && Math.random() >= cfg.sampleRate) return;
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    sentInWindow = 0;
  }
  if (++sentInWindow > MAX_PER_MINUTE) return;

  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
  const req = currentRequest();
  const eventId = randomUUID().replace(/-/g, '');
  const event = {
    event_id: eventId,
    timestamp: now / 1000,
    platform: 'node',
    level: ctx.level ?? 'error',
    logger: 'vistar-api',
    server_name: hostname().slice(0, 64),
    release: appVersion(),
    environment: cfg.environment,
    exception: { values: [{ type: e.name, value: redact(e.message).slice(0, 2000), stacktrace: { frames: frames(e.stack ? redact(e.stack) : undefined) } }] },
    tags: { ...(ctx.tags ?? {}), ...(req ? { requestId: req.requestId } : {}) },
    ...(req ? { request: { method: req.method, url: req.path }, user: req.userId ? { id: req.userId } : undefined, extra: { workspaceId: req.workspaceId ?? null } } : {}),
  };
  const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date(now).toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
  try {
    await safeFetch({
      url: dsn.url,
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=vistar-api/${appVersion()}` },
      body,
      timeoutMs: 5_000,
      maxResponseBytes: 1024,
    });
  } catch (sendErr) {
    logger.warn(`Error report not delivered (${(sendErr as Error).name})`);
  }
}

/** Process-level hooks: unhandled rejections and uncaught exceptions are reported (and logged by Node as before). */
export function installProcessErrorHooks(): void {
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
    reportError(reason, { tags: { kind: 'unhandledRejection' } });
  });
  process.on('uncaughtExceptionMonitor', (error) => {
    reportError(error, { level: 'fatal', tags: { kind: 'uncaughtException' } });
  });
}
