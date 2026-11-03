import { ConsoleLogger, type LoggerService, type LogLevel } from '@nestjs/common';
import { redact } from './redact.js';
import { currentRequest } from './request-context.js';

const ORDER: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];

/** Levels at and above `min` (Nest's setLogLevels takes the list). */
export function levelsFrom(min: LogLevel): LogLevel[] {
  return ORDER.slice(Math.max(0, ORDER.indexOf(min)));
}

const LEVEL_NAME: Record<LogLevel, string> = { verbose: 'trace', debug: 'debug', log: 'info', warn: 'warn', error: 'error', fatal: 'fatal' };

function textOf(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return `${message.name}: ${message.message}`;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

/**
 * Structured JSON logs (change #20): one line per entry on stdout (stderr for error and fatal) with time, level,
 * context, message, request id, user and workspace ids from the request context, and the app name. Every message
 * and stack goes through redact() (e-mails, phones, tokens, passwords, GSTIN, PAN). Text mode keeps Nest's console
 * format for development, also redacted.
 */
export class VistarLogger implements LoggerService {
  private levels: Set<LogLevel>;
  private readonly text: ConsoleLogger | null;

  constructor(
    private readonly opts: { json: boolean; level: LogLevel; app?: string },
  ) {
    this.levels = new Set(levelsFrom(opts.level));
    this.text = opts.json ? null : new ConsoleLogger({ prefix: opts.app ?? 'vistar-api', logLevels: levelsFrom(opts.level) });
  }

  setLogLevels(levels: LogLevel[]): void {
    this.levels = new Set(levels);
    this.text?.setLogLevels(levels);
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.write('log', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('verbose', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]): void {
    this.write('fatal', message, rest);
  }

  /** Structured entry with extra fields (HTTP access log). */
  event(level: LogLevel, context: string, msg: string, fields: Record<string, unknown>): void {
    if (!this.levels.has(level)) return;
    if (this.text) {
      this.text[level === 'fatal' ? 'fatal' : level](`${redact(msg)} ${redact(JSON.stringify(fields))}`, context);
      return;
    }
    this.emit(level, { context, msg: redact(msg), ...fields });
  }

  private write(level: LogLevel, message: unknown, rest: unknown[]): void {
    if (!this.levels.has(level)) return;
    const params = [...rest];
    const context = typeof params[params.length - 1] === 'string' && params.length > 0 ? (params.pop() as string) : undefined;
    let stack: string | undefined;
    if ((level === 'error' || level === 'fatal') && typeof params[0] === 'string' && params[0].includes('\n    at ')) stack = params.shift() as string;
    if (message instanceof Error) stack ??= message.stack;
    const msg = redact(textOf(message));
    if (this.text) {
      const args: unknown[] = [msg];
      if (stack) args.push(redact(stack));
      if (context) args.push(context);
      (this.text[level === 'fatal' ? 'fatal' : level] as (...a: unknown[]) => void)(...args);
      return;
    }
    const entry: Record<string, unknown> = { context, msg };
    if (stack) entry.stack = redact(stack).split('\n').slice(0, 20).join('\n');
    if (params.length) entry.extra = redact(textOf(params.length === 1 ? params[0] : params));
    this.emit(level, entry);
  }

  private emit(level: LogLevel, fields: Record<string, unknown>): void {
    const req = currentRequest();
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: LEVEL_NAME[level],
      app: this.opts.app ?? 'vistar-api',
      ...(req ? { requestId: req.requestId, userId: req.userId ?? undefined, workspaceId: req.workspaceId ?? undefined } : {}),
      ...fields,
    });
    (level === 'error' || level === 'fatal' ? process.stderr : process.stdout).write(`${line}\n`);
  }
}
