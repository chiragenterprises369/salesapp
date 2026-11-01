/** Formatting helpers shared by web, API (emails, exports) and workers. Locale: en-IN. */

const inrFull = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numIn = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

/**
 * Format whole rupees. Indian grouping: ₹1,23,456.
 * compact: ₹950, ₹12.5K, ₹4.2L, ₹1.3Cr.
 */
export function formatInr(value: number, opts: { compact?: boolean } = {}): string {
  if (!opts.compact) return inrFull.format(value);
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${numIn.format(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${numIn.format(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${numIn.format(abs / 1e3)}K`;
  return inrFull.format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

/** Initials for avatar circles: "Priya Sharma" -> "PS", "anil" -> "AN". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

/**
 * Normalise an Indian mobile number to E.164 (+91XXXXXXXXXX).
 * Returns null when it is not a valid Indian mobile (10 digits starting 6-9).
 */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let local = digits;
  if (local.length === 12 && local.startsWith('91')) local = local.slice(2);
  else if (local.length === 11 && local.startsWith('0')) local = local.slice(1);
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

/** Mask a phone for PII-safe logs: +91XXXXXX3210. */
export function maskPhone(e164: string): string {
  return e164.length <= 4 ? '****' : `${e164.slice(0, 3)}${'X'.repeat(Math.max(0, e164.length - 7))}${e164.slice(-4)}`;
}

/** Seconds to m:ss or h:mm:ss. */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
