import type { APIRequestContext, Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API, expect, PASSWORD } from '../crm/crm-helpers';

/**
 * Helpers of the billing suites (change #19 wave C, BILLING-WEB). API mode only: the web built against
 * the billing API (E2E_API_URL, default http://localhost:4030) on a `seed:demo` database.
 * Workspace personas come from ../crm/crm-helpers; the Super Admin signs in with TOTP (the secret is
 * shared with scripts/smoke-web.mjs in %TEMP%\vistar-smoke\totp.json, or SMOKE_TOTP_SECRET).
 */
export * from '../crm/crm-helpers';

export const SUPER_ADMIN = process.env.SMOKE_SUPER_EMAIL ?? 'owner@vistar.example';

function base32(s: string): Buffer {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let v = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = a.indexOf(ch);
    if (i < 0) continue;
    v = (v << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32(secret)).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

const TOTP_FILE = join(tmpdir(), 'vistar-smoke', 'totp.json');

/** Next unused TOTP code (a code is accepted once, so wait for the next 30 s step when needed). */
async function superCode(apiOrigin: string, otpauthUrl: string | null): Promise<string> {
  mkdirSync(join(tmpdir(), 'vistar-smoke'), { recursive: true });
  const store = (existsSync(TOTP_FILE) ? JSON.parse(readFileSync(TOTP_FILE, 'utf8')) : {}) as Record<string, { secret: string; lastStep?: number }>;
  const key = `${apiOrigin}|${SUPER_ADMIN}`;
  const secret = (otpauthUrl ? new URL(otpauthUrl).searchParams.get('secret') : null) ?? process.env.SMOKE_TOTP_SECRET ?? store[key]?.secret;
  if (!secret) throw new Error('Super Admin TOTP secret unknown (run scripts/smoke-web.mjs first or set SMOKE_TOTP_SECRET)');
  let step = Math.floor(Date.now() / 30_000);
  const last = store[key]?.lastStep ?? 0;
  if (step <= last) {
    await new Promise((r) => setTimeout(r, (last + 1) * 30_000 - Date.now() + 500));
    step = Math.floor(Date.now() / 30_000);
  }
  store[key] = { secret, lastStep: step };
  writeFileSync(TOTP_FILE, JSON.stringify(store, null, 2));
  return totp(secret, step);
}

/** Super Admin sign-in through /super-admin/login (password, then the TOTP code). */
export async function superSignIn(page: Page) {
  await page.goto('/super-admin/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill(SUPER_ADMIN);
  await page.locator('input[name="password"]').fill(PASSWORD);
  const challenge = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/super\/auth\/login$/.test(new URL(r.url()).pathname));
  await page.locator('form button[type="submit"]').click();
  const res = await challenge;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { enrollmentRequired?: boolean; otpauthUrl?: string | null };
  const code = await superCode(new URL(res.url()).origin, body.enrollmentRequired ? (body.otpauthUrl ?? null) : null);
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => u.pathname.startsWith('/super-admin') && !u.pathname.startsWith('/super-admin/login'));
}

/** Platform access token for direct Super Admin API calls (password + TOTP through the API). */
export async function superToken(request: APIRequestContext): Promise<string> {
  const first = await request.post(`${API}/api/super/auth/login`, { data: { email: SUPER_ADMIN, password: PASSWORD } });
  expect(first.status(), 'Super Admin login').toBe(200);
  const challenge = (await first.json()) as { challengeToken?: string; enrollmentRequired?: boolean; otpauthUrl?: string | null };
  const code = await superCode(API, challenge.enrollmentRequired ? (challenge.otpauthUrl ?? null) : null);
  const second = await request.post(`${API}/api/super/auth/verify`, { data: { challengeToken: challenge.challengeToken, code } });
  expect(second.status(), 'Super Admin TOTP').toBe(200);
  return ((await second.json()) as { accessToken: string }).accessToken;
}

export async function superGet<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const res = await request.get(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.ok(), `GET ${path} -> ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}
