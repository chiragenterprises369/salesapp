'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiRequestError } from '../api-error';
import { api } from '../api/client';
import { API_ORIGIN } from '../api/config';
import { isMockData } from '../api/data-source';
import { hubKeys } from './keys';
import { isOpenApiDocument, type OpenApiDocument } from './openapi';

/**
 * Public API reference (`GET /api/v1/openapi.json`, no sign-in; only the routes an API key can call
 * plus the inbound webhook). Cached for 10 minutes: it changes only with an API release.
 */
async function fetchReference(signal: AbortSignal): Promise<OpenApiDocument> {
  const json: unknown = await api.call('publicOpenApi', { signal });
  if (!isOpenApiDocument(json)) throw new ApiRequestError('INTERNAL_ERROR', 'The API reference could not be read. Reload the page.', [], { status: 200 });
  return json;
}

export function useApiReference() {
  return useQuery({
    queryKey: hubKeys.docs.reference(),
    queryFn: ({ signal }) => fetchReference(signal),
    staleTime: 10 * 60_000,
    retry: 1,
    enabled: !isMockData(),
  });
}

/** Base URL for examples: the server the document names (API_PUBLIC_URL), else the API this web build talks to. */
export function apiBaseUrl(doc: OpenApiDocument | undefined): string {
  const fromDoc = doc?.servers?.[0]?.url;
  if (fromDoc && /^https?:\/\//.test(fromDoc)) return fromDoc.replace(/\/+$/, '').replace(/\/api(\/v\d+)?$/, '');
  return API_ORIGIN;
}
