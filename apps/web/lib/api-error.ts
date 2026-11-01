import type { ErrorCode, FieldError } from '@vistar/shared';

/**
 * Error thrown by data sources (mock now, HTTP later) with the ApiErrorSchema fields.
 * OWNER: orchestrator. UI code shows `message` and maps `details` to form fields by `path`.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export const isApiRequestError = (e: unknown): e is ApiRequestError => e instanceof ApiRequestError;

/** Field errors keyed by path ("values.name" -> "Name is required"). */
export function fieldErrorMap(e: unknown): Record<string, string> {
  if (!isApiRequestError(e)) return {};
  return Object.fromEntries(e.details.map((d) => [d.path, d.message]));
}
