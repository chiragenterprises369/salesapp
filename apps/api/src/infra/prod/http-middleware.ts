import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { VistarLogger } from './logger.js';
import { redactPath } from './redact.js';
import { requestContext, type RequestContext } from './request-context.js';

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const QUIET_PATHS = new Set(['/api/health', '/api/ready']);

/** IPv4 /24, IPv6 /48: enough for abuse patterns, not a precise address in the logs. */
export function truncateIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.0');
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::`;
  return undefined;
}

/**
 * Request id (incoming x-request-id when it is a safe token, else a UUID), the async request context for logs and
 * error reports, and one access-log line per request (method, redacted path, status, duration, truncated IP,
 * user and workspace ids; never query strings, headers or bodies). Health and readiness probes are not logged.
 */
export function requestLogging(logger: VistarLogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers['x-request-id'];
    const id = typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();
    req.id = id;
    res.setHeader('x-request-id', id);
    const ctx: RequestContext = { requestId: id, method: req.method, path: redactPath(req.originalUrl ?? req.url) };
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (QUIET_PATHS.has(ctx.path)) return;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const status = res.statusCode;
      const level = status >= 500 ? 'error' : status >= 400 && status !== 404 && status !== 401 ? 'warn' : 'log';
      logger.event(level, 'HTTP', `${req.method} ${ctx.path} ${status}`, {
        requestId: id,
        http: {
          method: req.method,
          path: ctx.path,
          route: (req.route as { path?: string } | undefined)?.path,
          status,
          durationMs: Math.round(ms * 10) / 10,
          ip: truncateIp(req.ip),
          bytes: Number(res.getHeader('content-length') ?? 0) || undefined,
        },
        userId: req.auth?.userId ?? ctx.userId ?? undefined,
        workspaceId: req.auth?.workspaceId ?? ctx.workspaceId ?? undefined,
        apiKeyId: req.auth?.apiKeyId ?? undefined,
        adminId: req.platformAuth?.adminId,
      });
    });
    requestContext.run(ctx, () => next());
  };
}
