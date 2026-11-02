import { expect as baseExpect, test, type Page, type Response } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

/**
 * Custom Team Floor end to end in API mode (SPEC 29.5, 29.11; D-061), the user's flow:
 *  1. the company admin sends office photos from the Live Team Floor tab (FloorRequestPanel),
 *  2. the Super Admin opens the request, copies FLOOR_PLAN_PROMPT, pastes the JSON an AI chat returned
 *     (here the sample plan), sees validation errors for a broken plan, uploads, edits a seat in the
 *     seat tool, previews Day and Evening, publishes,
 *  3. the company's Team Floor shows the published office (flat zones; 3D office built from the kit),
 *  4. office markers: a QR marker (code shown once) and a BLE beacon on a zone of the published floor.
 *
 * Needs: web built with NEXT_PUBLIC_API_URL -> a `seed:demo` API (wave B), FLOOR-WORKSPACE's Team Floor
 * page (it mounts FloorRequestPanel and loads the floor with loadWorkspaceFloor), and the Super Admin
 * TOTP secret (scripts/smoke-web.mjs stores it, or SMOKE_TOTP_SECRET).
 * Run: E2E_BASE_URL=http://localhost:3005 E2E_API_MODE=1 pnpm e2e team-floor/published-floor --project=desktop
 */
const expect = baseExpect.configure({ timeout: 20_000 });
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'vistar-demo-123';
const ADMIN = process.env.FLOOR_ADMIN_EMAIL ?? 'anil@shakti.example';
const SUPER = process.env.FLOOR_SUPER_EMAIL ?? 'owner@vistar.example';
const COMPANY = process.env.FLOOR_COMPANY ?? 'Shakti Industries';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = readFileSync(join(repo, 'apps/web/public/team-floor/samples/sample-office.json'), 'utf8');
// Small valid PNG made at run time (the API checks the type and the content of reference images).
function png(w = 4, h = 3): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x9a)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = png();

test.skip(process.env.E2E_API_MODE !== '1', 'API-mode flow: set E2E_API_MODE=1 and point the build at a demo API');
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const isJson = (method: string, path: RegExp) => (r: Response) => r.request().method() === method && path.test(new URL(r.url()).pathname);

async function signIn(page: Page, email: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  const login = page.waitForResponse((r) => r.url().includes('/api/v1/auth/login'));
  await page.locator('form button[type="submit"]').click();
  expect((await login).status()).toBe(200);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.evaluate(() => localStorage.setItem('vistar.floor.qa', '1'));
}

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
async function superCode(apiOrigin: string, email: string, otpauthUrl: string | null): Promise<string> {
  mkdirSync(join(tmpdir(), 'vistar-smoke'), { recursive: true });
  const store = (existsSync(TOTP_FILE) ? JSON.parse(readFileSync(TOTP_FILE, 'utf8')) : {}) as Record<string, { secret: string; lastStep?: number }>;
  const key = `${apiOrigin}|${email}`;
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
async function superSignIn(page: Page) {
  await page.goto('/super-admin/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill(SUPER);
  await page.locator('input[name="password"]').fill(PASSWORD);
  const challenge = page.waitForResponse(isJson('POST', /\/api\/super\/auth\/login$/));
  await page.locator('form button[type="submit"]').click();
  const res = await challenge;
  const body = (await res.json()) as { enrollmentRequired: boolean; otpauthUrl?: string | null };
  await page.locator('input[name="code"]').fill(await superCode(new URL(res.url()).origin, SUPER, body.enrollmentRequired ? (body.otpauthUrl ?? null) : null));
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => u.pathname.startsWith('/super-admin') && !u.pathname.startsWith('/super-admin/login'));
}

/** The request panel on the Team Floor page (FLOOR-WORKSPACE mounts it; maybe behind a "Your office" tab). */
async function requestPanel(page: Page) {
  await page.goto('/app/team-floor', { waitUntil: 'domcontentloaded' });
  const panel = page.locator('[data-floor-request]').first();
  if (!(await panel.isVisible().catch(() => false))) {
    const tab = page.getByRole('tab', { name: /your office/i }).or(page.getByRole('button', { name: /your office/i }));
    if (await tab.first().isVisible().catch(() => false)) await tab.first().click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

let versionUrl = '';

test('1. company admin sends office photos (minimum rules shown, then submitted)', async ({ page }) => {
  await signIn(page, ADMIN);
  const panel = await requestPanel(page);
  if ((await panel.getAttribute('data-floor-request')) !== 'form') {
    // A request exists already (re-run): start a new one.
    await panel.getByRole('button', { name: /send (new|more) photos/i }).click();
  }
  const form = page.locator('[data-floor-request="form"]');
  await expect(form.getByText('A photo of the work area')).toBeVisible();
  await form.locator('[data-category="work_area"] input[type="file"]').setInputFiles([
    { name: 'work-1.png', mimeType: 'image/png', buffer: PNG },
    { name: 'work-2.png', mimeType: 'image/png', buffer: PNG },
  ]);
  // Two photos are not enough: the rule list still shows the missing cabin / meeting room.
  await form.getByRole('textbox', { name: /people who need a seat/i }).fill('22');
  await form.getByRole('button', { name: 'Send photos' }).click();
  await expect(form.getByRole('alert').first()).toContainText(/cabin or a meeting room|at least 3/i);
  await form.locator('[data-category="meeting_room"] input[type="file"]').setInputFiles([{ name: 'conference.png', mimeType: 'image/png', buffer: PNG }]);
  await form.locator('[data-category="cabin"] input[type="file"]').setInputFiles([{ name: 'cabin.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(form.locator('img')).toHaveCount(4);
  await form.getByRole('textbox', { name: /notes for vistar/i }).fill('One floor, 24 x 16 m. Calling team near the reception.');
  const created = page.waitForResponse(isJson('POST', /\/api\/v1\/floor-requests$/));
  await form.getByRole('button', { name: 'Send photos' }).click();
  expect((await created).status()).toBe(201);
  await expect(page.locator('[data-floor-request="submitted"]')).toBeVisible();
  await expect(page.getByText('Your photos reached Vistar')).toBeVisible();
});

test('2. Super Admin: prompt, validation errors, upload, seat tool, preview, publish', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await superSignIn(page);
  await page.goto('/super-admin/floors', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const row = page.getByRole('link', { name: COMPANY }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { level: 1, name: COMPANY })).toBeVisible();
  await expect(page.getByRole('region', { name: /work area/i }).or(page.locator('section[aria-label="Work area"]'))).toBeVisible();

  // Prompt with the head count and notes; copy button fills the clipboard.
  const prompt = page.locator('#floor-prompt');
  await expect(prompt).toHaveValue(/head count: 22/);
  await expect(prompt).toHaveValue(/Calling team near the reception/);
  await page.getByRole('button', { name: 'Copy prompt' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('vistar.floor-plan');

  // Broken plan: clear errors, no upload.
  await page.getByRole('button', { name: 'Paste JSON' }).click();
  const paste = page.getByRole('textbox', { name: 'Floor plan JSON' });
  const broken = JSON.parse(SAMPLE) as { seats: { position: number[] }[] };
  broken.seats[0]!.position = [99, 99];
  await paste.fill(JSON.stringify(broken));
  await expect(page.getByText('This file cannot be used yet')).toBeVisible();
  await expect(page.getByText(/seats\.0\.position: Seat is outside the floor size/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload as a new version' })).toBeDisabled();

  // The sample plan (as an AI chat would answer, in a code fence).
  await paste.fill('```json\n' + SAMPLE + '\n```');
  await expect(page.getByText(/7 rooms, 32 seats/)).toBeVisible();
  const uploaded = page.waitForResponse(isJson('POST', /\/api\/super\/companies\/[^/]+\/floors$/));
  await page.getByRole('button', { name: 'Upload as a new version' }).click();
  expect((await uploaded).status()).toBe(201);
  await page.waitForURL(/\/super-admin\/floors\/versions\//);
  versionUrl = page.url();

  // Seat tool: 32 seats and 7 zones from the plan; move a seat by keyboard.
  const tool = page.locator('[data-seat-tool]');
  await expect(tool.locator('[data-seat]')).toHaveCount(32);
  await expect(tool.locator('[data-zone]')).toHaveCount(7);
  await page.getByText('Pick a seat from the list').click();
  await page.getByRole('button', { name: 'Desk 1', exact: true }).click();
  await expect(page.locator('[data-inspector="seat"]')).toBeVisible();
  await tool.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(']');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  const saved = page.waitForResponse(isJson('PUT', /\/api\/super\/floors\/[^/]+\/seat-map$/));
  await page.getByRole('button', { name: 'Save seats' }).click();
  expect((await saved).status()).toBe(200);

  // Preview: Day and Evening, 3D and flat.
  const preview = page.locator('[data-floor-preview]');
  await expect(preview).toHaveAttribute('data-look', 'light');
  await page.getByRole('button', { name: 'Evening' }).click();
  await expect(preview).toHaveAttribute('data-look', 'dark');
  await page.getByRole('button', { name: 'Flat plan' }).click();
  await expect(preview.locator('[data-floor-map] [data-zone]')).toHaveCount(7);

  const published = page.waitForResponse(isJson('POST', /\/api\/super\/floors\/[^/]+\/publish$/));
  await page.getByRole('button', { name: /^Publish$|Save and publish/ }).click();
  expect((await published).status()).toBe(200);
  await expect(page.getByText('Live', { exact: true }).first()).toBeVisible();
});

test('3. the company Team Floor shows the published office', async ({ page }) => {
  await signIn(page, ADMIN);
  const layout = page.waitForResponse(isJson('GET', /\/api\/v1\/team-floor\/layout$/));
  await page.goto('/app/team-floor?floorMode=flat', { waitUntil: 'domcontentloaded' });
  const body = (await (await layout).json()) as { source: string; floor: { format: string } | null };
  expect(body.source).toBe('custom');
  expect(body.floor?.format).toBe('layout_json');
  await expect(page.locator('[data-floor-map] [data-zone="conference"]')).toBeVisible();
  await page.goto('/app/team-floor?floorMode=3d', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as unknown as { __vistarFloor?: { ready(): boolean } }).__vistarFloor?.ready() === true, null, { timeout: 60_000 });
  const info = await page.evaluate(() => (window as unknown as { __vistarFloor: { info(): { office: string } } }).__vistarFloor.info());
  expect(info.office).toBe('kit');
});

test('4. office markers on the published zones', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/app/settings/office-markers', { waitUntil: 'networkidle' });
  const room = page.getByRole('combobox', { name: 'Room' });
  await expect(room.locator('option', { hasText: 'Conference room' })).toHaveCount(1);

  // QR: the code is shown once, with the printable sheet.
  await page.getByRole('radio', { name: 'QR code' }).click();
  await room.selectOption({ label: 'Conference room' });
  await page.getByRole('textbox', { name: 'Name' }).fill('Conference room door');
  await page.getByRole('button', { name: 'Add marker' }).click();
  const token = page.locator('[data-marker-token]');
  await expect(token).toHaveText(/^vz1\./);
  await expect(page.getByRole('button', { name: 'Print QR sheet' })).toBeVisible();
  await page.getByRole('button', { name: 'I saved it' }).click();
  await expect(page.getByRole('cell', { name: /Conference room door/ })).toBeVisible();

  // BLE beacon: field errors, then saved.
  await page.getByRole('radio', { name: 'BLE beacon' }).click();
  await room.selectOption({ label: 'Pantry' });
  await page.getByRole('textbox', { name: 'Name' }).fill('Pantry beacon');
  await page.getByRole('textbox', { name: 'Beacon UUID' }).fill('not-a-uuid');
  await page.getByRole('textbox', { name: 'Major' }).fill('1');
  await page.getByRole('textbox', { name: 'Minor' }).fill('70000');
  await page.getByRole('button', { name: 'Add marker' }).click();
  await expect(page.getByText(/32 hex digits/)).toBeVisible();
  await expect(page.getByText(/0 to 65535/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Beacon UUID' }).fill('f7826da6-4fa2-4e98-8024-bc5b71e0893e');
  await page.getByRole('textbox', { name: 'Minor' }).fill('12');
  await page.getByRole('button', { name: 'Add marker' }).click();
  await expect(page.getByRole('cell', { name: /Pantry beacon/ })).toBeVisible();

  // Delete the beacon again.
  await page.getByRole('button', { name: 'Delete Pantry beacon' }).click();
  await page.getByRole('button', { name: 'Delete marker' }).click();
  await expect(page.getByRole('cell', { name: /Pantry beacon/ })).toHaveCount(0);
  expect(versionUrl).toContain('/super-admin/floors/versions/');
});
