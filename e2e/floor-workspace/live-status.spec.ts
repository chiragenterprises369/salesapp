import { expect as baseExpect, request as pwRequest, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Live status on the Team Floor in API mode (D-062, SPEC 29.2 and 29.11). Two contexts: the company
 * admin's browser on /app/team-floor, and an employee driving the API like the Android app. Each change
 * must show on the admin's floor within 1 s: status, a SIM call starting and ending, a QR zone scan.
 *
 * Needs a demo database (seed:demo), the API and the web built against it:
 *   E2E_BASE_URL=http://localhost:3003 E2E_API_URL=http://localhost:4013/api/v1 E2E_API_MODE=1 \
 *     pnpm e2e e2e/floor-workspace/live-status --project=desktop
 */
const expect = baseExpect.configure({ timeout: 15_000 });
const LIVE_MS = 1_000;
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'vistar-demo-123';
const API = (process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const ADMIN = 'anil@shakti.example';
const EMPLOYEE = 'rohit@shakti.example';
const ALL_DAY = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ start: '00:00', end: '23:59' }]]));

test.skip(process.env.E2E_API_MODE !== '1', 'API-mode check: set E2E_API_MODE=1 and point the build at a demo API');
test.describe.configure({ mode: 'serial', timeout: 180_000 });

async function apiLogin(email: string): Promise<{ api: APIRequestContext; userId: string }> {
  const anon = await pwRequest.newContext();
  const res = await anon.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { accessToken: string; me: { user: { id: string } } };
  await anon.dispose();
  const api = await pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${body.accessToken}` } });
  return { api, userId: body.me.user.id };
}

async function signIn(page: Page, email: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** Time from the API answer to the floor showing the change. */
async function within(ms: number, action: () => Promise<unknown>, check: () => Promise<void>) {
  await action();
  const t0 = Date.now();
  await check();
  const took = Date.now() - t0;
  baseExpect(took, `floor updated after ${took} ms`).toBeLessThanOrEqual(ms);
}

test('employee status, SIM call and QR zone reach the admin floor within 1 s', async ({ browser }) => {
  const admin = await apiLogin(ADMIN);
  const emp = await apiLogin(EMPLOYEE);
  const original = (await (await admin.api.get(`${API}/users`)).json()) as { items: Array<{ id: string; workingHours: unknown }> };
  const hoursBefore = original.items.find((u) => u.id === emp.userId)?.workingHours ?? null;
  // Zone signals count only inside working hours (D-063): open the whole day for this run.
  expect((await admin.api.patch(`${API}/users/${emp.userId}`, { data: { workingHours: ALL_DAY } })).ok()).toBeTruthy();
  const marker = (await (await admin.api.post(`${API}/team-floor/markers`, { data: { kind: 'qr', zoneId: 'e2e-meeting', label: 'E2E meeting room' } })).json()) as { id: string; token: string };
  expect(marker.token).toBeTruthy();

  const beat = () => emp.api.post(`${API}/me/presence/heartbeat`, { data: { client: 'android', activity: 'active', appState: 'foreground', screen: 'calls' } });
  await beat();
  const heart = setInterval(() => void beat(), 10_000);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await signIn(page, ADMIN);
    await page.goto('/app/team-floor?floorMode=flat');
    await expect(page.locator('[data-floor-workspace]')).toBeVisible();
    await expect(page.locator('[data-floor-map]')).toBeVisible();
    await page.locator('h1').first().click();
    await page.keyboard.press('/');
    await page.keyboard.type('Rohit');
    await page.keyboard.press('Enter');
    const panel = page.locator(`[data-person-panel="${emp.userId}"]`);
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveAttribute('data-presence', 'offline');

    await within(LIVE_MS, () => emp.api.put(`${API}/me/status`, { data: { status: 'on_break', note: 'Tea' } }), async () => {
      await baseExpect(panel).toHaveAttribute('data-presence', 'on_break', { timeout: LIVE_MS });
    });
    await expect(panel.getByText('On a break').first()).toBeVisible();

    const clientCallId = `e2e-${Date.now()}`;
    await within(
      LIVE_MS,
      () => emp.api.post(`${API}/me/calls/active`, { data: { event: 'started', clientCallId, direction: 'outbound', phone: '+919812345678', startedAt: new Date().toISOString() } }),
      async () => baseExpect(panel).toHaveAttribute('data-presence', 'on_call', { timeout: LIVE_MS }),
    );
    await within(
      LIVE_MS,
      () => emp.api.post(`${API}/me/calls/active`, { data: { event: 'ended', clientCallId, endedAt: new Date().toISOString() } }),
      // A call ending restores the manual status.
      async () => baseExpect(panel).toHaveAttribute('data-presence', 'on_break', { timeout: LIVE_MS }),
    );

    await within(
      LIVE_MS,
      () => emp.api.post(`${API}/me/presence/zone`, { data: { source: 'qr', at: new Date().toISOString(), markerToken: marker.token } }),
      async () => baseExpect(panel).toHaveAttribute('data-zone', 'e2e-meeting', { timeout: LIVE_MS }),
    );
    await expect(panel.getByText(/QR code scan/)).toBeVisible();
    await expect(panel.getByText(/Exact confidence/)).toBeVisible();

    // The status survives a reload (snapshot), and the screen in use shows.
    await page.reload();
    await page.locator('h1').first().click();
    await page.keyboard.press('/');
    await page.keyboard.type('Rohit');
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-person-panel="${emp.userId}"]`)).toHaveAttribute('data-presence', 'on_break');
    await expect(page.locator(`[data-person-panel="${emp.userId}"]`)).toHaveAttribute('data-screen', 'calls');
  } finally {
    clearInterval(heart);
    await emp.api.put(`${API}/me/status`, { data: { status: 'available' } }).catch(() => undefined);
    await admin.api.delete(`${API}/team-floor/markers/${marker.id}`).catch(() => undefined);
    await admin.api.patch(`${API}/users/${emp.userId}`, { data: { workingHours: hoursBefore } }).catch(() => undefined);
    await ctx.close();
    await emp.api.dispose();
    await admin.api.dispose();
  }
});
