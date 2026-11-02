import type { ErrorCode, FieldError } from '@vistar/shared';

/**
 * Error thrown by data sources (HTTP client and the test-only mock layer) with the ApiErrorSchema
 * fields. OWNER: orchestrator. UI code shows `message` and maps `details` to form fields by `path`.
 * The HTTP client (lib/api) also fills `status` (0 = the request never got an answer) and the
 * `requestId` the API logged, so support can find the request.
 */
export interface ApiRequestMeta {
  status?: number;
  requestId?: string | null;
  /** True when the client gave up waiting (timeout). */
  timeout?: boolean;
}

export class ApiRequestError extends Error {
  readonly status: number | undefined;
  readonly requestId: string | null;
  readonly timeout: boolean;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: FieldError[] = [],
    meta: ApiRequestMeta = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = meta.status;
    this.requestId = meta.requestId ?? null;
    this.timeout = !!meta.timeout;
  }
}

export const isApiRequestError = (e: unknown): e is ApiRequestError => e instanceof ApiRequestError;

/** Field errors keyed by path ("values.name" -> "Name is required"). */
export function fieldErrorMap(e: unknown): Record<string, string> {
  if (!isApiRequestError(e)) return {};
  return Object.fromEntries(e.details.map((d) => [d.path, d.message]));
}
