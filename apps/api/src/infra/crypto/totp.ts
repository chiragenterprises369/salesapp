import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for mandatory Super Admin 2FA. No external dependency.
 * Store secrets encrypted (encryptSecret); never log them.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, atMs = Date.now(), stepSec = 30, digits = 6): string {
  const counter = Math.floor(atMs / 1000 / stepSec);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const bin = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, '0');
}

/**
 * Verify a code. Accepts the current step and +/- `window` steps for clock drift.
 * Returns the matched time step, or null. Replay protection: the caller stores the step
 * (PlatformAdmin.totpLastStep) and passes it as `lastUsedStep`; a step <= lastUsedStep is rejected.
 */
export function verifyTotp(secret: string, code: string, opts: { window?: number; atMs?: number; lastUsedStep?: number | null } = {}): number | null {
  const { window = 1, atMs = Date.now(), lastUsedStep = null } = opts;
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(atMs / 30_000);
  for (let i = -window; i <= window; i++) {
    const step = current + i;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = totpCode(secret, step * 30_000);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUrl(accountEmail: string, secret: string, issuer = 'Vistar Super Admin'): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
