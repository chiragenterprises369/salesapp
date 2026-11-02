// Web smoke check for wave reports (orchestrator). Needs a running web app (next start or dev).
// Usage: node scripts/smoke-web.mjs [baseUrl] [--mock]   (default http://localhost:3000)
//
// API mode (default, SPEC 29.8): every persona signs in through the real sign-in pages against the
// API the web build points at, with the demo accounts of a `seed:demo` database (Shakti Industries,
// password vistar-demo-123; Super Admin owner@vistar.example with TOTP). The Super Admin's TOTP
// secret is captured at first enrolment and kept in %TEMP%/vistar-smoke/totp.json (per API origin);
// SMOKE_TOTP_SECRET overrides it. Fails when the page used the mock data layer.
// --mock: the test-only mock data layer (needs a build with NEXT_PUBLIC_ALLOW_MOCK_DATA=1).
//
// Visits key routes per persona in light and dark at desktop and mobile widths, and fails on page
// errors, console errors, failed redirects or blank pages. Screenshots: %TEMP%/vistar-smoke.
import { chromium } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const MOCK = args.includes('--mock');
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const outDir = join(tmpdir(), 'vistar-smoke');
mkdirSync(outDir, { recursive: true });

const PASSWORD = process.env.SMOKE_PASSWORD ?? 'vistar-demo-123';
/** Demo accounts per persona (seed:demo, Shakti Industries). */
const ACCOUNTS = {
  company_admin: 'anil@shakti.example',
  manager: 'priya@shakti.example',
  employee: 'rohit@shakti.example',
  viewer: 'deepa@shakti.example',
  super_admin: 'owner@vistar.example',
};

/** [persona, path, expected final path prefix] */
const ROUTES = [
  ['company_admin', '/app', '/app'],
  ['company_admin', '/app/leads', '/app/leads'],
  ['company_admin', '/app/leads?view=table', '/app/leads'],
  ['company_admin', '/app/team-floor', '/app/team-floor'],
  ['company_admin', '/app/workflows/indiamart_nurturing', '/app/workflows'],
  ['company_admin', '/app/settings/roles', '/app/settings'],
  ['manager', '/app/leads', '/app/leads'],
  ['viewer', '/app', '/app'],
  ['employee', '/me', '/me'],
  ['employee', '/me/leads', '/me/leads'],
  ['employee', '/app/leads', '/me'], // guard: employee cannot use the company panel
  ['company_admin', '/super-admin', '/app'], // guard: company admin cannot use the Super Admin panel
  ['super_admin', '/super-admin', '/super-admin'],
  [null, '/app', '/login'], // signed out
];

const IGNORED_CONSOLE = [/Download the React DevTools/i, /\[Fast Refresh\]/i, /favicon/i];
const THEMES = [
  ['light', 1440],
  ['dark', 375],
];

// ------------------------------------------------------------------ TOTP (RFC 6238, SHA-1, 6 digits)

function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

const TOTP_FILE = join(outDir, 'totp.json');
const readTotpStore = () => (existsSync(TOTP_FILE) ? JSON.parse(readFileSync(TOTP_FILE, 'utf8')) : {});
const writeTotpStore = (s) => writeFileSync(TOTP_FILE, JSON.stringify(s, null, 2));

/** A code for a time step the API has not accepted yet (it rejects a reused step). */
async function freshCode(key, secret) {
  const store = readTotpStore();
  let step = Math.floor(Date.now() / 30_000);
  const last = store[key]?.lastStep ?? 0;
  if (step <= last) {
    await new Promise((r) => setTimeout(r, (last + 1) * 30_000 - Date.now() + 500));
    step = Math.floor(Date.now() / 30_000);
  }
  store[key] = { ...(store[key] ?? {}), secret, lastStep: step };
  writeTotpStore(store);
  return totp(secret, step);
}

// ------------------------------------------------------------------ sign-in (API mode)

async function signInWorkspace(page, email) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

async function signInSuper(page, email) {
  await page.goto(`${base}/super-admin/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  const challengeRes = page.waitForResponse((r) => r.url().includes('/api/super/auth/login') && r.request().method() === 'POST');
  await page.locator('form button[type="submit"]').click();
  const res = await challengeRes;
  const challenge = await res.json().catch(() => null);
  if (!res.ok() || !challenge?.challengeToken) throw new Error(`super login ${res.status()}: ${JSON.stringify(challenge)?.slice(0, 200)}`);
  const apiOrigin = new URL(res.url()).origin;
  const key = `${apiOrigin}|${email}`;
  let secret = process.env.SMOKE_TOTP_SECRET ?? null;
  if (challenge.enrollmentRequired && challenge.otpauthUrl) secret = new URL(challenge.otpauthUrl).searchParams.get('secret');
  secret ??= readTotpStore()[key]?.secret ?? null;
  if (!secret) throw new Error(`Super Admin ${email} is enrolled but its TOTP secret is unknown: set SMOKE_TOTP_SECRET or reset the enrolment on this database`);
  const code = await freshCode(key, secret);
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/super-admin/login'), { timeout: 30_000 });
}

// ------------------------------------------------------------------ run

const results = [];
const browser = await chromium.launch();
const personas = [...new Set(ROUTES.map((r) => r[0]))];

for (const persona of personas) {
  const routes = ROUTES.filter((r) => r[0] === persona);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const host = new URL(base).hostname;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED_CONSOLE.some((r) => r.test(m.text()))) errors.push(`console: ${m.text().slice(0, 160)}`);
  });

  let signInError = null;
  if (MOCK) {
    await page.goto(`${base}/kit`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((p) => {
      localStorage.setItem('vistar.dataSource', 'mock');
      if (p) localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: p }));
      else localStorage.removeItem('vistar.mock.persona');
    }, persona);
  } else if (persona) {
    try {
      if (persona === 'super_admin') await signInSuper(page, ACCOUNTS[persona]);
      else await signInWorkspace(page, ACCOUNTS[persona]);
    } catch (e) {
      signInError = `sign-in failed: ${e.message.split('\n')[0]}`;
    }
    errors.length = 0;
  }

  for (const [, path, expect] of routes) {
    for (const [theme, width] of THEMES) {
      errors.length = 0;
      await context.addCookies([
        {
          name: 'vistar_theme',
          value: encodeURIComponent(JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' })),
          domain: host,
          path: '/',
        },
      ]);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const problems = [];
      if (signInError) problems.push(signInError);
      else {
        await page.goto(`${base}${path}`, { waitUntil: 'networkidle' }).catch((e) => problems.push(`goto: ${e.message.split('\n')[0]}`));
        await page.waitForTimeout(800);
        const finalPath = new URL(page.url()).pathname;
        const textLen = (await page.locator('body').innerText()).trim().length;
        const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        const mockUse = MOCK ? [] : await page.evaluate(() => window.__vistarMockUse ?? []);
        const slug = `${MOCK ? 'mock-' : ''}${persona ?? 'anon'}${path.replace(/[^a-z0-9]+/gi, '-')}-${theme}-${width}`;
        await page.screenshot({ path: join(outDir, `${slug}.png`) });
        const onLogin = /\/login$/.test(finalPath);
        if (!finalPath.startsWith(expect) || (onLogin && !expect.endsWith('/login'))) problems.push(`landed on ${finalPath}, expected ${expect}`);
        if (textLen < 20) problems.push('blank page');
        if (dataTheme !== theme) problems.push(`data-theme=${dataTheme}`);
        if (hScroll && width < 400 && !path.includes('leads')) problems.push('horizontal scroll at mobile width');
        if (mockUse.length) problems.push(`mock data layer used: ${mockUse.join(', ')}`);
        problems.push(...errors);
      }
      results.push({ name: `${persona ?? 'signed-out'} ${path} [${theme} ${width}]`, ok: problems.length === 0, detail: problems.join(' | ') });
    }
  }
  await context.close();
}
await browser.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.info(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  (${r.detail})`}`);
console.info(`\n${results.length - failed.length}/${results.length} web checks passed (${MOCK ? 'mock data' : 'API'} mode). Screenshots: ${outDir}`);
process.exit(failed.length ? 1 : 0);
