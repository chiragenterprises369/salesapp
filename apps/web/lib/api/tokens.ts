/**
 * Access tokens, in memory only (never localStorage or cookies readable by JS). One slot per
 * audience: `workspace` (Company and Employee panels, /api/v1) and `platform` (Super Admin,
 * /api/super). Refresh tokens are httpOnly cookies the API sets; the browser sends them.
 *
 * A workspace token minted for impersonation ("View as company") has no refresh cookie, so it is
 * stored as not refreshable: when it expires the support session is over.
 */
export type Audience = 'workspace' | 'platform';

export interface StoredToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
  refreshable: boolean;
}

const STORAGE_PREFIX = 'vistar.token.';

function readStorageToken(audience: Audience): StoredToken | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${audience}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed || typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    if (parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${audience}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStorageToken(audience: Audience, token: StoredToken | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!token) {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${audience}`);
    } else {
      window.localStorage.setItem(`${STORAGE_PREFIX}${audience}`, JSON.stringify(token));
    }
  } catch {
    /* ignore */
  }
}

const slots: Record<Audience, StoredToken | null> = {
  workspace: readStorageToken('workspace'),
  platform: readStorageToken('platform'),
};
const listeners = new Set<(audience: Audience) => void>();

export function setAccessToken(audience: Audience, token: string, expiresInSec: number, opts: { refreshable?: boolean } = {}): void {
  const stored: StoredToken = { token, expiresAt: Date.now() + Math.max(0, expiresInSec) * 1000, refreshable: opts.refreshable ?? true };
  slots[audience] = stored;
  writeStorageToken(audience, stored);
  for (const l of listeners) l(audience);
}

export function getStoredToken(audience: Audience): StoredToken | null {
  if (!slots[audience]) {
    slots[audience] = readStorageToken(audience);
  }
  return slots[audience];
}

export function getAccessTokenFor(audience: Audience): string | null {
  return getStoredToken(audience)?.token ?? null;
}

export function clearAccessToken(audience: Audience): void {
  slots[audience] = null;
  writeStorageToken(audience, null);
  for (const l of listeners) l(audience);
}

/** True when the token exists and is valid for at least `skewMs` more. */
export function isTokenFresh(audience: Audience, skewMs: number, now = Date.now()): boolean {
  const t = getStoredToken(audience);
  return !!t && t.expiresAt - skewMs > now;
}

/** Called whenever a token is set or cleared (the realtime client reconnects with the new one). */
export function onTokenChange(listener: (audience: Audience) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Payload of a JWT without verifying it (the API verifies). Used to notice role changes. */
export function decodeTokenClaims(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
