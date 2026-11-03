import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { getEnv } from '../../config/env.js';

/**
 * The one outbound HTTP client for webhooks and integrations (change #19 wave C, SPEC 20.2). SSRF guard:
 * - https only; plain http only for hosts on the dev allowlist (OUTBOUND_ALLOW_PRIVATE_HOSTS, never in production);
 * - every resolved address is checked against private, loopback, link-local, CGNAT, multicast and reserved
 *   ranges (IPv4 and IPv6, IPv4-mapped included) inside the socket `lookup`, so DNS rebinding cannot swap the
 *   address after the check; IP literals are checked before connecting;
 * - no redirects, a hard timeout, request and response size limits.
 * Never log URLs with credentials (IndiaMART keys go in the query): callers log the host only.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

export class HttpTimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${Math.round(ms / 1000)} s`);
    this.name = 'HttpTimeoutError';
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** IPv4 inside an IPv4-mapped (::ffff:a.b.c.d) or NAT64 address, else null. */
function embeddedV4(ip: string): string | null {
  const m = /^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return m ? m[1]! : null;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    const v4 = embeddedV4(ip);
    if (v4) return blocked.check(v4, 'ipv4');
    if (/^::ffff:/i.test(ip)) return true;
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

/** Hosts (names or IPs) allowed to be private: dev only. Default in development and test: localhost, 127.0.0.1, ::1. */
export function devAllowlist(): Set<string> {
  const env = getEnv();
  if (env.NODE_ENV === 'production') return new Set();
  const raw = env.OUTBOUND_ALLOW_PRIVATE_HOSTS ?? 'localhost,127.0.0.1,::1';
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/^\[|\]$/g, ''))
      .filter(Boolean),
  );
}

const hostOf = (url: URL) => url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

/** Parse and check scheme and literal IPs (no DNS). Throws BlockedUrlError. */
export function checkUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('Not a valid URL');
  }
  if (url.username || url.password) throw new BlockedUrlError('URLs with credentials are not allowed');
  const host = hostOf(url);
  const allowed = devAllowlist().has(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowed)) throw new BlockedUrlError('Only https URLs are allowed');
  if (isIP(host) && !allowed && isBlockedAddress(host)) throw new BlockedUrlError('This address is private or reserved');
  return url;
}

function resolveAll(host: string): Promise<Array<{ address: string; family: number }>> {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
  });
}

/** Full check including DNS: every address of the host must be public (unless allowlisted). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = checkUrlShape(raw);
  const host = hostOf(url);
  if (devAllowlist().has(host) || isIP(host)) return url;
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolveAll(host);
  } catch {
    throw new BlockedUrlError(`Could not resolve ${host}`);
  }
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) throw new BlockedUrlError('This host resolves to a private or reserved address');
  return url;
}

/** Same rule for a bare host (SMTP). */
export async function assertPublicHost(host: string): Promise<void> {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (devAllowlist().has(h)) return;
  if (isIP(h)) {
    if (isBlockedAddress(h)) throw new BlockedUrlError('This address is private or reserved');
    return;
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolveAll(h);
  } catch {
    throw new BlockedUrlError(`Could not resolve ${h}`);
  }
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) throw new BlockedUrlError('This host resolves to a private or reserved address');
}

/** Socket lookup that refuses blocked addresses (checked at connect time: no rebinding window). */
function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: { all?: boolean; family?: number }, callback: (...args: unknown[]) => void) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      const ok = allowPrivate ? addresses : addresses.filter((a) => !isBlockedAddress(a.address));
      if (!ok.length || (!allowPrivate && ok.length !== addresses.length)) {
        return callback(new BlockedUrlError('This host resolves to a private or reserved address'));
      }
      if (options?.all) return callback(null, ok);
      return callback(null, ok[0]!.address, ok[0]!.family);
    });
  };
}

export interface SafeRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  /** Bytes kept from the response body (rest dropped; `truncated` true). Default 4 KB. */
  maxResponseBytes?: number;
  /** Request bodies above this are refused. Default 1 MB. */
  maxRequestBytes?: number;
}

export interface SafeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  latencyMs: number;
}

/** One HTTP request through the SSRF guard. Network errors, timeouts and blocked targets throw; HTTP statuses do not. */
export async function safeFetch(req: SafeRequest): Promise<SafeResponse> {
  const url = checkUrlShape(req.url);
  const host = hostOf(url);
  const allowPrivate = devAllowlist().has(host);
  const timeoutMs = req.timeoutMs ?? 10_000;
  const maxBytes = req.maxResponseBytes ?? 4096;
  const body = req.body === undefined ? undefined : Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body, 'utf8');
  if (body && body.length > (req.maxRequestBytes ?? 1_048_576)) throw new BlockedUrlError('Request body is too large');
  const started = Date.now();
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise<SafeResponse>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const request = lib.request(
      url,
      {
        method: req.method ?? 'GET',
        headers: { ...(req.headers ?? {}), ...(body ? { 'content-length': String(body.length) } : {}) },
        lookup: guardedLookup(allowPrivate) as never,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on('data', (chunk: Buffer) => {
          if (size >= maxBytes) {
            truncated = true;
            return;
          }
          const room = maxBytes - size;
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, room));
            size = maxBytes;
            truncated = true;
            // Enough read: stop downloading the rest.
            res.destroy();
            done(() => resolve(finish()));
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        const finish = (): SafeResponse => ({
          status: res.statusCode ?? 0,
          headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')])),
          body: Buffer.concat(chunks).toString('utf8'),
          truncated,
          latencyMs: Date.now() - started,
        });
        res.on('end', () => done(() => resolve(finish())));
        res.on('error', (err) => done(() => reject(err)));
      },
    );
    const timer = setTimeout(() => {
      request.destroy(new HttpTimeoutError(timeoutMs));
    }, timeoutMs);
    request.on('error', (err) => done(() => reject(err)));
    if (body) request.write(body);
    request.end();
  });
}

/** Readable, secret-free error text for delivery logs and integration status. */
export function describeHttpError(err: unknown): string {
  if (err instanceof BlockedUrlError || err instanceof HttpTimeoutError) return err.message;
  const e = err as NodeJS.ErrnoException;
  switch (e?.code) {
    case 'ECONNREFUSED':
      return 'Connection refused';
    case 'ECONNRESET':
      return 'Connection reset';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Host not found';
    case 'ETIMEDOUT':
      return 'Connection timed out';
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'TLS certificate problem';
    default:
      return e?.code ? `Network error (${e.code})` : 'Network error';
  }
}
