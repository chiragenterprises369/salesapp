import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request context for logs and error reports (change #20). Filled by the HTTP logging middleware. */
export interface RequestContext {
  requestId: string;
  method: string;
  /** Path with tokens redacted (see redactPath). */
  path: string;
  userId?: string | null;
  workspaceId?: string | null;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentRequest(): RequestContext | undefined {
  return requestContext.getStore();
}
