import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiError, ErrorCode } from '@vistar/shared';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppException } from './app-exception.js';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'AUTH_UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Converts every thrown error into the ApiError envelope. Logs 5xx without request bodies (PII-safe). */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    if (!res || typeof res.status !== 'function') return; // non-HTTP context (ws/queue) handles its own errors
    const requestId = req?.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiError['error'] = { code: 'INTERNAL_ERROR', message: 'Something went wrong. Try again.', requestId };

    if (exception instanceof AppException) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, details: exception.details, requestId };
    } else if (exception instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_FAILED',
        message: 'Some fields are invalid',
        details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId,
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const message = typeof r === 'string' ? r : ((r as { message?: string | string[] }).message ?? exception.message);
      body = {
        code: STATUS_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED'),
        message: Array.isArray(message) ? message.join('; ') : String(message),
        requestId,
      };
    } else if (isPrismaKnownError(exception)) {
      if (exception.code === 'P2002') {
        status = 409;
        body = { code: 'CONFLICT', message: 'A record with these details already exists', requestId };
      } else if (exception.code === 'P2025') {
        status = 404;
        body = { code: 'NOT_FOUND', message: 'Record not found', requestId };
      }
    }

    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(`${req?.method} ${req?.route?.path ?? req?.path} failed [${requestId}]: ${err.message}`, err.stack);
    }
    res.status(status).json({ error: body } satisfies ApiError);
  }
}

function isPrismaKnownError(e: unknown): e is { code: string; name: string } {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'PrismaClientKnownRequestError' && typeof (e as { code?: unknown }).code === 'string';
}
