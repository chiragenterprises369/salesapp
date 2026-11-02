import type { Env } from '../../config/env.js';

type OriginCallback = (err: Error | null, allow?: boolean) => void;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** WEB_ORIGIN entries without trailing slashes. */
export function fixedOrigins(env: Pick<Env, 'WEB_ORIGIN'>): Set<string> {
  return new Set(
    env.WEB_ORIGIN.split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  );
}

/**
 * Development origins (never in production): http://localhost, http://127.0.0.1 and http://<name>.localhost
 * (custom-domain testing, D-060) on a port inside DEV_CORS_PORTS (default 3000-3010: the web streams and the
 * Flutter web preview on 3010).
 */
export function isDevOrigin(origin: string, env: Pick<Env, 'NODE_ENV' | 'DEV_CORS_PORTS'>): boolean {
  if (env.NODE_ENV === 'production') return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' || url.pathname !== '/' || url.username || url.password) return false;
  const [lo, hi] = env.DEV_CORS_PORTS.split('-').map(Number) as [number, number];
  const port = Number(url.port);
  if (!url.port || port < lo || port > hi) return false;
  return LOCAL_HOSTS.has(url.hostname) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.localhost$/.test(url.hostname);
}

/** Hostname of an origin served from a custom domain (https; http only outside production), else null. */
export function customDomainHost(origin: string, env: Pick<Env, 'NODE_ENV'>): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:' || (env.NODE_ENV !== 'production' && url.protocol === 'http:')) return url.hostname.toLowerCase();
  } catch {
    // not a URL
  }
  return null;
}

/**
 * CORS origin check for `app.enableCors({ origin })`: WEB_ORIGIN, the dev origins, and verified custom domains of
 * companies whose `custom_domain` switch is on (looked up through `verifiedHosts`, cached by the caller).
 * Requests without an Origin header (same origin, curl, the Android app) are allowed; auth still applies.
 */
export function corsOriginCheck(env: Pick<Env, 'WEB_ORIGIN' | 'NODE_ENV' | 'DEV_CORS_PORTS'>, verifiedHosts: () => Promise<Set<string>>) {
  const fixed = fixedOrigins(env);
  return (origin: string | undefined, cb: OriginCallback): void => {
    if (!origin || fixed.has(origin) || isDevOrigin(origin, env)) return cb(null, true);
    const host = customDomainHost(origin, env);
    if (!host) return cb(null, false);
    verifiedHosts()
      .then((hosts) => cb(null, hosts.has(host)))
      .catch(() => cb(null, false));
  };
}

/** Small TTL cache around an async loader (custom domain host list for CORS). */
export function cached<T>(load: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let value: { at: number; data: Promise<T> } | null = null;
  return () => {
    if (!value || Date.now() - value.at > ttlMs) {
      const data = load();
      value = { at: Date.now(), data };
      data.catch(() => {
        value = null;
      });
    }
    return value.data;
  };
}
