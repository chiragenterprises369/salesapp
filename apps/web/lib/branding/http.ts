'use client';

import { ApiErrorSchema, type ErrorCode } from '@vistar/shared';
import { ApiRequestError } from '@/lib/api-error';
import { getAccessToken } from '@/lib/session/session';

/**
 * Small HTTP helper for the branding, domain and platform-config routes (change #19 contracts).
 * TODO(merge with WEB-API): replace with the shared client in lib/api (token refresh, request ids);
 * the call sites only use `api()` and `apiMode()`.
 *
 * API mode = a real session (an access token) and not the automated-test mock layer
 * (NEXT_PUBLIC_DATA_SOURCE=mock). Mock sessions keep the browser adapters in this folder.
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
export const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE).origin;
  } catch {
    return 'http://localhost:4000';
  }
})();

export function apiMode(): boolean {
  return process.env.NEXT_PUBLIC_DATA_SOURCE !== 'mock' && !!getAccessToken();
}

/** Absolute URL: `/api/...` paths are absolute routes (super, files); others are relative to /api/v1. */
export function apiUrl(path: string): string {
  return path.startsWith('/api/') ? `${API_ORIGIN}${path}` : `${API_BASE}${path}`;
}

export async function api<T>(path: string, init: { method?: string; json?: unknown; form?: FormData; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = init.auth === false ? null : getAccessToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'include' });
  } catch {
    throw new ApiRequestError('INTERNAL' as ErrorCode, 'Vistar could not be reached. Check your connection and try again.');
  }
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(data);
    if (parsed.success) throw new ApiRequestError(parsed.data.error.code, parsed.data.error.message, parsed.data.error.details ?? []);
    throw new ApiRequestError((res.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL') as ErrorCode, res.status === 401 ? 'Your session ended. Sign in again.' : `Request failed (${res.status}).`);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
