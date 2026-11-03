/** Pure rules of the hub pages (unit-tested in __tests__/hub-logic.test.ts). */

/** Event type -> hub cache scopes (first query-key segment). */
export function scopesForHubEvent(type: string): readonly string[] {
  const [head] = type.split('.');
  if (head === 'webhook') return ['webhooks'];
  if (head === 'integration') return ['integrations'];
  if (head === 'api_key' || head === 'apikey') return ['api-keys'];
  // Inbound sources create leads: the delivery log shows the result.
  if (type === 'lead.created') return ['webhooks'];
  return [];
}

/** Outbound URL check before the API's own SSRF guard: https, or plain http only for localhost. */
export function urlProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Enter the URL that should receive the events.';
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return 'Enter a full URL, for example https://example.in/hooks/vistar.';
  }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
  return 'Use an https URL. Plain http works only for localhost while testing.';
}

/** URL key from a name: "Website form (Pune)" -> "website-form-pune". */
export function sourceKeyFrom(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/**
 * Retries still to come for an outbound delivery: attempt n+1 runs `delays[n - 1]` seconds after
 * attempt n, up to `maxAttempts`. Empty when nothing is pending.
 */
export function upcomingRetryDelays(delays: readonly number[], attempt: number, maxAttempts: number, pending: boolean): number[] {
  if (!pending || attempt < 1 || attempt >= maxAttempts) return [];
  return delays.slice(attempt - 1, Math.max(0, maxAttempts - 1));
}
