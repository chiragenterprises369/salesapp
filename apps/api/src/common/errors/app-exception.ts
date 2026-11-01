import { HttpException } from '@nestjs/common';
import { ERROR_HTTP_STATUS, type ErrorCode, type FieldError } from '@vistar/shared';

/**
 * Throw this for every expected error. The global filter turns it into the ApiError envelope.
 * `message` must be safe to show to users: no PII, no secrets, no stack traces.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: FieldError[];

  constructor(code: ErrorCode, message: string, opts: { details?: FieldError[]; status?: number; cause?: unknown } = {}) {
    super({ code, message, details: opts.details }, opts.status ?? ERROR_HTTP_STATUS[code], { cause: opts.cause });
    this.code = code;
    this.details = opts.details;
  }
}

export const notFound = (what = 'Record') => new AppException('NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do this') => new AppException('FORBIDDEN', message);
export const conflict = (message: string) => new AppException('CONFLICT', message);
