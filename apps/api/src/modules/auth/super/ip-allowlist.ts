import { isIPv4 } from 'node:net';

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function normalize(ip: string): string {
  const v = ip.trim().toLowerCase();
  return v.startsWith('::ffff:') && isIPv4(v.slice(7)) ? v.slice(7) : v;
}

/** One allowlist entry: exact IP (v4 or v6) or IPv4 CIDR ("10.0.0.0/8"). */
export function ipMatches(ip: string, entry: string): boolean {
  const addr = normalize(ip);
  const rule = entry.trim().toLowerCase();
  if (!rule.includes('/')) return addr === normalize(rule);
  const [net, bitsRaw] = rule.split('/');
  const bits = Number(bitsRaw);
  if (!net || !isIPv4(net) || !isIPv4(addr) || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(addr) & mask) === (ipv4ToInt(net) & mask);
}

/** Empty allowlist = any IP. Unknown request IP never matches a non-empty list. */
export function ipAllowed(ip: string | null, allowlist: readonly string[]): boolean {
  if (!allowlist.length) return true;
  if (!ip) return false;
  return allowlist.some((entry) => ipMatches(ip, entry));
}
