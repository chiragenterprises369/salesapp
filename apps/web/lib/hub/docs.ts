'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiRequestError } from '../api-error';
import { errorFromResponse, newRequestId } from '../api/client';
import { API_ORIGIN, API_URL, REQUEST_TIMEOUT_MS } from '../api/config';
import { isMockData } from '../api/data-source';
import { hubKeys } from './keys';
import { isOpenApiDocument, type OpenApiDocument } from './openapi';

/**
 * Public API reference (`GET /api/v1/openapi.json`, no sign-in, public part only). Fetched once per
 * page load and cached for 10 minutes; the document is large and changes only with an API release.
 */
async function fetchReference(signal: AbortSignal): Promise<OpenApiDocument> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/openapi.json`, { headers: { accept: 'application/json', 'x-request-id': newRequestId() }, signal: ctrl.signal });
    } catch (e) {
      if (signal.aborted) throw e;
      throw new ApiRequestError('SERVICE_UNAVAILABLE', 'Vistar could not reach the server. Check your connection and try again.', [], { status: 0 });
    }
    if (!res.ok) throw await errorFromResponse(res);
    const json: unknown = await res.json().catch(() => null);
    if (!isOpenApiDocument(json)) throw new ApiRequestError('INTERNAL_ERROR', 'The API reference could not be read. Reload the page.', [], { status: res.status });
    return json;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

export function useApiReference() {
  const mock = isMockData();
  return useQuery({
    queryKey: hubKeys.docs.reference(),
    queryFn: ({ signal }) => fetchReference(signal),
    staleTime: 10 * 60_000,
    retry: 1,
    enabled: !mock,
  });
}

/** Base URL for examples: the server the document names, else the API this web build talks to. */
export function apiBaseUrl(doc: OpenApiDocument | undefined): string {
  const fromDoc = doc?.servers?.[0]?.url;
  if (fromDoc && /^https?:\/\//.test(fromDoc)) return fromDoc.replace(/\/+$/, '').replace(/\/api(\/v\d+)?$/, '');
  return API_ORIGIN;
}
