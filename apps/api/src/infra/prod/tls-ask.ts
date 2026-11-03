import type { Env } from '../../config/env.js';

/** Hosts Vistar itself serves (WEB_ORIGIN entries and API_PUBLIC_URL). */
export function ownHosts(env: Pick<Env, 'WEB_ORIGIN' | 'API_PUBLIC_URL'>): Set<string> {
  const hosts = new Set<string>();
  for (const raw of [...env.WEB_ORIGIN.split(','), env.API_PUBLIC_URL]) {
    try {
      hosts.add(new URL(raw.trim()).hostname.toLowerCase());
    } catch {
      // not a URL
    }
  }
  return hosts;
}

const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Caddy on-demand TLS "ask" decision (change #20): a certificate may be issued for Vistar's own hosts and for
 * verified custom domains of live companies whose custom_domain switch is on (DomainsService.corsHosts()).
 * Anything else (random hosts pointed at the server, IPs, bad names) is refused, so nobody can make Caddy
 * request certificates for arbitrary names and hit the CA rate limits.
 */
export async function mayIssueCertificate(rawDomain: string, env: Pick<Env, 'WEB_ORIGIN' | 'API_PUBLIC_URL'>, verifiedHosts: () => Promise<Set<string>>): Promise<boolean> {
  const host = rawDomain.trim().toLowerCase().replace(/\.$/, '');
  if (!HOST.test(host) || host.endsWith('.localhost')) return false;
  if (ownHosts(env).has(host)) return true;
  return (await verifiedHosts()).has(host);
}
