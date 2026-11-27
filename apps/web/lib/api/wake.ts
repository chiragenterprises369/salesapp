import { isApiRequestError } from '../api-error';
import { API_ORIGIN } from './config';

/**
 * Cold starts. The API runs on a free Render instance that sleeps after about 15 idle minutes; the first
 * request then waits 50-100 s while it boots, longer than the 20 s request timeout, so the first sign-in
 * failed with "took too long" until the user tried again. `wakeApi()` starts the boot early (the sign-in
 * page calls it on load) and `withColdStartRetry()` waits for the API after a timeout and sends the
 * request once more.
 */

const HEALTH_URL = `${API_ORIGIN}/api/health`;
/** How long a sign-in waits for a sleeping API to boot. */
export const COLD_START_WAIT_MS = 100_000;
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_PAUSE_MS = 2_000;

/**
 * One GET /api/health. `no-cors` without credentials: CORS cannot block it, and any answer means the server
 * is up (a sleeping Render instance holds the request until it has booted).
 */
async function probe(timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(HEALTH_URL, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let warming: Promise<boolean> | null = null;

/** Start a sleeping API now (single flight). Resolves true once it answered. Browser only. */
export function wakeApi(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  warming ??= probe(PROBE_TIMEOUT_MS).finally(() => {
    warming = null;
  });
  return warming;
}

/** Wait until /api/health answers, at most `maxWaitMs`. False when it never did or the browser is offline. */
export async function waitForApi(maxWaitMs = COLD_START_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    if (await probe(Math.min(PROBE_TIMEOUT_MS, left))) return true;
    await new Promise((resolve) => setTimeout(resolve, Math.min(PROBE_PAUSE_MS, Math.max(0, deadline - Date.now()))));
  }
}

/**
 * The request timed out, or a gateway answered 502/503/504 for it: the API is asleep or still booting.
 * Immediate network failures (API not running locally, CORS, offline) are not cold starts; waiting does not
 * help them.
 */
export function isColdStartError(e: unknown): boolean {
  if (!isApiRequestError(e) || e.code !== 'SERVICE_UNAVAILABLE') return false;
  return e.timeout || (e.status !== undefined && e.status >= 502 && e.status <= 504);
}

// ---- "waking up" state for the sign-in notice (read with useSyncExternalStore)
let waking = false;
const listeners = new Set<() => void>();

function setWaking(next: boolean): void {
  if (waking === next) return;
  waking = next;
  for (const listener of listeners) listener();
}

export function subscribeApiWaking(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const isApiWaking = (): boolean => waking;

/**
 * Run `run`; when it fails with a cold start, wait for the API (`isApiWaking()` is true meanwhile) and run it
 * once more. Any other error (wrong password, rate limit...) is thrown as is, and so is the first error when
 * the API did not come up within `maxWaitMs`.
 */
export async function withColdStartRetry<T>(run: () => Promise<T>, maxWaitMs = COLD_START_WAIT_MS): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isColdStartError(e)) throw e;
    setWaking(true);
    try {
      if (!(await waitForApi(maxWaitMs))) throw e;
      return await run();
    } finally {
      setWaking(false);
    }
  }
}
