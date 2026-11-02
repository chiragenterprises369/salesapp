import { expect as baseExpect, test, type Page, type Response } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * API-mode check (web-api, SPEC 29.8): the web against a real API and a `seed:demo` database, no
 * mock layer. Each persona signs in through the sign-in pages, sees its data scope, and the main
 * writes survive a reload: a board move, a completed task, a personal setting; then signs out.
 * Every test fails if the page used the mock data layer (window.__vistarMockUse).
 *
 * Run (web built with NEXT_PUBLIC_API_URL pointing at the API):
 *   E2E_BASE_URL=http://localhost:3002 pnpm e2e e2e/api --project=desktop
 * Not part of the mock suites: skipped unless E2E_API_MODE=1.
 */
const expect = baseExpect.configure({ timeout: 20_000 });
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'vistar-demo-123';
const IGNORED = [/Download the React DevTools/i, /favicon/i];

test.skip(
  process.env.E2E_API_MODE !== '1',
  'API-mode check: set E2E_API_MODE=1 and point the build at a demo API',
);
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const ACCOUNTS = {
  company_admin: 'anil@shakti.example',
  manager: 'priya@shakti.example',
  employee: 'rohit@shakti.example',
  viewer: 'deepa@shakti.example',
  super_admin: 'owner@vistar.example',
} as const;

function watch(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text())))
      errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  return errors;
}

async function noMockUse(page: Page) {
  expect(
    await page.evaluate(
      () => (window as unknown as { __vistarMockUse?: string[] }).__vistarMockUse ?? [],
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('vistar.mock.persona'))).toBeNull();
}

async function signIn(page: Page, email: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  const login = page.waitForResponse((r) => r.url().includes('/api/v1/auth/login'));
  await page.locator('form button[type="submit"]').click();
  expect((await login).status()).toBe(200);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

const isJson = (method: string, path: RegExp) => (r: Response) =>
  r.request().method() === method && path.test(new URL(r.url()).pathname);

/** Total of the first lead list page the page asks for (the API applies the data scope). */
async function leadTotal(page: Page, path: string): Promise<number> {
  const res = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      /\/api\/v1\/leads$/.test(new URL(r.url()).pathname) &&
      r.status() === 200,
  );
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const body = (await (await res).json()) as { items: unknown[]; total?: number };
  return body.total ?? body.items.length;
}

// ---------------------------------------------------------------- TOTP for the Super Admin

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
/** Shared with scripts/smoke-web.mjs: secret captured at enrolment and the last used time step. */
const TOTP_FILE = join(tmpdir(), 'vistar-smoke', 'totp.json');

async function superCode(
  apiOrigin: string,
  email: string,
  otpauthUrl: string | null,
): Promise<string> {
  mkdirSync(join(tmpdir(), 'vistar-smoke'), { recursive: true });
  const store = (
    existsSync(TOTP_FILE) ? JSON.parse(readFileSync(TOTP_FILE, 'utf8')) : {}
  ) as Record<string, { secret: string; lastStep?: number }>;
  const key = `${apiOrigin}|${email}`;
  const secret =
    (otpauthUrl ? new URL(otpauthUrl).searchParams.get('secret') : null) ??
    process.env.SMOKE_TOTP_SECRET ??
    store[key]?.secret;
  if (!secret)
    throw new Error(
      'Super Admin TOTP secret unknown (run scripts/smoke-web.mjs first or set SMOKE_TOTP_SECRET)',
    );
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

// ---------------------------------------------------------------- tests

test('scopes: admin sees every lead, a manager their team, an employee their own', async ({
  page,
}) => {
  const errors = watch(page);
  await signIn(page, ACCOUNTS.company_admin);
  const all = await leadTotal(page, '/app/leads?view=table');
  await expect(page.locator('main')).toContainText(/lead/i);
  await noMockUse(page);

  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, ACCOUNTS.manager);
  const team = await leadTotal(page, '/app/leads?view=table');
  await noMockUse(page);

  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, ACCOUNTS.employee);
  await expect(page).toHaveURL(/\/me/);
  const own = await leadTotal(page, '/me/leads');
  await noMockUse(page);

  expect(all).toBeGreaterThan(team);
  expect(team).toBeGreaterThan(own);
  expect(own).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('viewer is read-only and cannot open the Super Admin panel', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, ACCOUNTS.viewer);
  await page.goto('/app/leads?view=table', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /^New lead$/ })).toHaveCount(0);
  await page.goto('/super-admin', { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => !u.pathname.startsWith('/super-admin'));
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('board move survives a reload (admin)', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, ACCOUNTS.company_admin);
  await page.goto('/app/leads', { waitUntil: 'domcontentloaded' });
  const from = page.locator('section[data-stage-key="new"]');
  const to = page.locator('section[data-stage-key="contacted"]');
  await expect(from.locator('li[data-lead-id]').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-board-phase="idle"]').first()).toBeVisible();
  const card = from.locator('li[data-lead-id]').first();
  const id = (await card.getAttribute('data-lead-id'))!;
  const face = card.locator('[aria-roledescription="draggable card"], [role="checkbox"]').first();
  await face.focus();
  const name = (await face.getAttribute('aria-label'))?.split(',')[0] ?? '';
  const saved = page.waitForResponse(
    (r) =>
      ['POST', 'PATCH'].includes(r.request().method()) &&
      new URL(r.url()).pathname.includes(`/api/v1/leads/${id}`),
  );
  await page
    .getByRole('button', { name: new RegExp(`^Move .* to stage$`) })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Contacted' }).click();
  expect((await saved).ok(), `move ${name} saved`).toBe(true);
  await expect(to.locator(`li[data-lead-id="${id}"]`)).toHaveCount(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(to.locator('li[data-lead-id]').first()).toBeVisible({ timeout: 60_000 });
  await expect(to.locator(`li[data-lead-id="${id}"]`)).toHaveCount(1);
  await expect(from.locator(`li[data-lead-id="${id}"]`)).toHaveCount(0);
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('completing a task survives a reload (manager)', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, ACCOUNTS.manager);
  await page.goto('/app/tasks', { waitUntil: 'domcontentloaded' });
  const box = page
    .locator('[data-task-row] input[type="checkbox"]:not(:checked):not(:disabled)')
    .first();
  await expect(box).toBeVisible();
  const label = (await box.getAttribute('aria-label'))!;
  const saved = page.waitForResponse(isJson('PATCH', /\/api\/v1\/tasks\/[0-9a-f-]{36}$/));
  await page.getByRole('checkbox', { name: label, exact: true }).first().click();
  const res = await saved;
  expect(res.ok()).toBe(true);
  const task = (await res.json()) as { id: string; status: string };
  expect(task.status).toBe('done');

  const reloaded = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      /\/api\/v1\/tasks$/.test(new URL(r.url()).pathname) &&
      r.status() === 200,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  const list = (await (await reloaded).json()) as { items: Array<{ id: string; status: string }> };
  // The server copy is done: either listed as done or no longer in the open list.
  const after = list.items.find((t) => t.id === task.id);
  expect(after === undefined || after.status === 'done').toBe(true);
  await expect(page.locator('[data-task-row]').first()).toBeVisible();
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('a personal setting survives a reload, then the employee signs out', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, ACCOUNTS.employee);
  await page.goto('/me/preferences', { waitUntil: 'domcontentloaded' });
  const group = page.getByRole('radiogroup', { name: 'Reduce motion' });
  await expect(group).toBeVisible();
  const radios = group.getByRole('radio');
  const count = await radios.count();
  let target = -1;
  let before = -1;
  for (let i = 0; i < count; i++) {
    const checked = (await radios.nth(i).getAttribute('aria-checked')) === 'true';
    if (checked) before = i;
    else if (target < 0) target = i;
  }
  expect(target).toBeGreaterThanOrEqual(0);
  const saved = page.waitForResponse(isJson('PATCH', /\/api\/v1\/me\/settings$/));
  await radios.nth(target).click();
  expect((await saved).ok()).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('radiogroup', { name: 'Reduce motion' }).getByRole('radio').nth(target),
  ).toHaveAttribute('aria-checked', 'true');

  // Put it back (keeps the demo database as it was).
  if (before >= 0) {
    const restored = page.waitForResponse(isJson('PATCH', /\/api\/v1\/me\/settings$/));
    await page
      .getByRole('radiogroup', { name: 'Reduce motion' })
      .getByRole('radio')
      .nth(before)
      .click();
    await restored;
  }
  await noMockUse(page);

  await page.goto('/me/more', { waitUntil: 'domcontentloaded' });
  const logout = page.waitForResponse(isJson('POST', /\/api\/v1\/auth\/logout$/));
  await page.getByRole('button', { name: 'Sign out' }).click();
  await logout;
  await page.waitForURL(/\/login/);
  await page.goto('/me', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/login/);
  expect(errors).toEqual([]);
});

test('Super Admin signs in with TOTP and lists the companies', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/super-admin/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill(ACCOUNTS.super_admin);
  await page.locator('input[name="password"]').fill(PASSWORD);
  const challenge = page.waitForResponse(isJson('POST', /\/api\/super\/auth\/login$/));
  await page.locator('form button[type="submit"]').click();
  const res = await challenge;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { enrollmentRequired: boolean; otpauthUrl?: string | null };
  const code = await superCode(
    new URL(res.url()).origin,
    ACCOUNTS.super_admin,
    body.enrollmentRequired ? (body.otpauthUrl ?? null) : null,
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(
    (u) => u.pathname.startsWith('/super-admin') && !u.pathname.startsWith('/super-admin/login'),
  );
  await page.goto('/super-admin/companies', { waitUntil: 'networkidle' });
  await expect(page.getByText('Shakti Industries').first()).toBeVisible();
  await noMockUse(page);
  expect(errors).toEqual([]);
});
