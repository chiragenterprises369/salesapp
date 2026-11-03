import { createHmac } from 'node:crypto';
import { test } from '@playwright/test';
import { API, apiGet, apiSend, apiToken, expect, noMockUse, sendSigned, signIn, stamp, startReceiver, takeShownOnce, watch } from './hub-helpers';

/**
 * HUB-WEB against the real API with the hub module (change #19 wave C) on a `seed:demo` database.
 * Skipped unless E2E_API_MODE=1. The API must allow outbound webhooks to localhost (dev allowlist,
 * see hub-api.md) and run the mock providers (NODE_ENV not production).
 *   E2E_API_MODE=1 E2E_BASE_URL=http://localhost:3001 E2E_API_URL=http://localhost:4001 E2E_WORKERS=1 pnpm e2e hub/hub.api --project=desktop
 * Serial: the inbound source made in test 2 is reused by the delivery log checks.
 */
test.skip(process.env.E2E_API_MODE !== '1', 'API-mode hub suite: set E2E_API_MODE=1 and point the build at an API with the hub module');
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const run = stamp();
const SAMPLE = {
  CODE: 200,
  STATUS: 'SUCCESS',
  RESPONSE: { UNIQUE_QUERY_ID: `E2E${run}`, SENDER_NAME: ' Asha Patil ', SENDER_MOBILE: '+91-98200' + String(Date.now()).slice(-5), SENDER_EMAIL: `ASHA.${run}@EXAMPLE.IN`, SENDER_CITY: 'Pune', QUERY_PRODUCT_NAME: 'Steel racks', QUERY_MESSAGE: 'Need 40 racks for a warehouse' },
};

interface Endpoint {
  id: string;
  name: string;
  sourceKey: string | null;
  inboundUrl: string | null;
  direction: 'inbound' | 'outbound';
}

test('integrations: connect SMTP in test mode, test it, then disconnect', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  await page.goto('/app/integrations', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
  // Every provider has a card, connected or not.
  for (const p of ['indiamart', 'whatsapp_cloud', 'telephony', 'smtp', 'google_calendar']) await expect(page.locator(`[data-provider="${p}"]`)).toBeVisible();

  const card = page.locator('[data-provider="smtp"]');
  if ((await card.getAttribute('data-status')) !== 'not_connected') {
    await card.getByRole('button', { name: /^Disconnect/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
    await expect(card).toHaveAttribute('data-status', 'not_connected');
  }
  await card.getByRole('button', { name: /^Connect / }).click();
  const sheet = page.getByRole('dialog', { name: /Connect Email/ });
  await expect(sheet.getByText('How to set it up')).toBeVisible();
  await sheet.getByRole('radio', { name: 'Test mode' }).click();
  await sheet.getByLabel('SMTP host').fill('localhost');
  await sheet.getByLabel('From address').fill(`sales.${run}@shakti.example`);
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/integrations/smtp/connect'));
  await sheet.getByRole('button', { name: 'Save and connect' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText(/Email \(SMTP\) connected in test mode/)).toBeVisible();
  await expect(card).toHaveAttribute('data-status', 'connected');
  await expect(card.getByText('Test mode')).toBeVisible();

  const tested = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/integrations/smtp/test'));
  await card.getByRole('button', { name: 'Test', exact: true }).click();
  expect((await tested).status()).toBe(200);

  await card.getByRole('button', { name: /^Disconnect/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(card).toHaveAttribute('data-status', 'not_connected');
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('integrations: IndiaMART test mode syncs from the mock and shows the push URL', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  await page.goto('/app/integrations', { waitUntil: 'networkidle' });
  const card = page.locator('[data-provider="indiamart"]');
  await card.getByRole('button', { name: /^(Connect|Settings of) / }).click();
  const sheet = page.getByRole('dialog', { name: /IndiaMART/ });
  await sheet.getByRole('radio', { name: 'Test mode' }).click();
  // Push on, so the push URL (with its key) is part of the endpoints.
  const push = sheet.getByRole('checkbox', { name: /Accept push/ });
  if ((await push.getAttribute('aria-checked')) !== 'true') await push.click();
  await sheet.getByRole('button', { name: /Save and (connect|test)/ }).click();
  await expect(card).toHaveAttribute('data-status', 'connected');
  const synced = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/integrations/indiamart/sync'));
  await card.getByRole('button', { name: 'Sync now' }).click();
  const res = await synced;
  // 429 when a pull ran less than 5 minutes ago (IndiaMART's own limit) is a valid answer too.
  expect([200, 429]).toContain(res.status());
  await card.getByRole('button', { name: /^Settings of / }).click();
  await expect(page.getByTestId('copy-pushUrl')).toHaveValue(/\/api\/hooks\/[0-9a-f-]{36}\/indiamart\?key=/);
  await page.keyboard.press('Escape');
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('inbound: create a source, capture a sample, map it and see the lead arrive', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  await page.goto('/app/webhooks', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New inbound source' }).click();
  const create = page.getByRole('dialog', { name: 'New inbound source' });
  const name = `E2E Source ${run}`;
  await create.getByLabel('Name', { exact: true }).fill(name);
  await expect(create.getByLabel('URL key')).toHaveValue(`e2e-source-${run}`);
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/webhooks/endpoints/inbound'));
  await create.getByRole('button', { name: 'Create source' }).click();
  expect((await created).status()).toBe(201);
  const secret = await takeShownOnce(page);

  // The edit sheet opens after the secret dialog; arm capture there.
  const edit = page.getByRole('dialog', { name: `Edit ${name}` });
  await expect(edit).toBeVisible();
  const token = await apiToken(page.request, 'company_admin');
  const { items } = await apiGet<{ items: Endpoint[] }>(page.request, token, '/webhooks/endpoints?direction=inbound');
  const source = items.find((e) => e.name === name)!;
  expect(source.inboundUrl).toMatch(new RegExp(`/api/hooks/[0-9a-f-]{36}/e2e-source-${run}$`));
  await edit.getByRole('button', { name: 'Capture the next request' }).click();
  await expect(edit.getByRole('button', { name: /Waiting for a request/ })).toBeVisible();

  // Bad signature and an old timestamp are refused; a signed request is captured, not turned into a lead.
  const bad = await page.request.post(source.inboundUrl!, { data: JSON.stringify(SAMPLE), headers: { 'content-type': 'application/json', 'x-vistar-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` } });
  expect(bad.status()).toBe(401);
  const stale = await sendSigned(page.request, source.inboundUrl!, secret, SAMPLE, { t: Math.floor(Date.now() / 1000) - 600 });
  expect(stale.status()).toBe(401);
  const captured = await sendSigned(page.request, source.inboundUrl!, secret, SAMPLE);
  expect(captured.status()).toBe(202);
  expect((await captured.json()) as { captured: boolean }).toMatchObject({ captured: true });

  await edit.getByRole('button', { name: 'Use it as the sample' }).click({ timeout: 20_000 });
  await expect(edit.getByRole('tree', { name: /Sample payload fields/ })).toBeVisible();
  await edit.getByRole('button', { name: 'Suggest mapping' }).click();
  const preview = edit.getByTestId('mapping-preview');
  await expect(preview).toContainText('Asha Patil');
  await expect(preview).toContainText('Pune');
  // Pick one more value by keyboard from the tree: the message becomes the requirement.
  await edit.getByRole('treeitem', { name: /QUERY_MESSAGE/ }).focus();
  await page.keyboard.press('Enter');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/webhooks/endpoints/${source.id}`));
  await edit.getByRole('button', { name: 'Save changes' }).click();
  expect((await saved).status()).toBe(200);

  // A real request now creates a routed lead; the same Idempotency-Key again is a duplicate.
  const phone = '98' + String(Date.now()).slice(-8);
  const payload = { ...SAMPLE, RESPONSE: { ...SAMPLE.RESPONSE, UNIQUE_QUERY_ID: `E2E${run}b`, SENDER_MOBILE: phone, SENDER_NAME: `Ravi ${run}` } };
  const key = `e2e-${run}`;
  const ok = await sendSigned(page.request, source.inboundUrl!, secret, payload, { idempotencyKey: key });
  expect(ok.status()).toBe(202);
  const body = (await ok.json()) as { leadId: string | null; duplicate: boolean };
  expect(body.leadId).toBeTruthy();
  const again = await sendSigned(page.request, source.inboundUrl!, secret, payload, { idempotencyKey: key });
  expect([200, 202]).toContain(again.status());
  expect(((await again.json()) as { duplicate: boolean }).duplicate).toBe(true);
  const lead = await apiGet<{ name: string; phone: string; city: string | null }>(page.request, token, `/leads/${body.leadId}`);
  expect(lead.name).toBe(`Ravi ${run}`);
  expect(lead.city).toBe('Pune');

  // The delivery log shows the request with a link to the lead.
  await page.goto('/app/webhooks?tab=log', { waitUntil: 'networkidle' });
  await page.getByLabel('Endpoint').selectOption({ label: `${name} (in)` });
  await page.locator('[data-delivery]').first().click();
  const drawer = page.getByTestId('delivery-detail');
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId('delivery-lead-link')).toHaveAttribute('href', `/app/leads/${body.leadId}`);
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('outbound: a failing receiver shows retries, and replay delivers once it works', async ({ page }) => {
  const errors = watch(page);
  const receiver = await startReceiver(500);
  try {
    await signIn(page, 'company_admin');
    await page.goto('/app/webhooks?tab=outbound', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'New subscription' }).click();
    const sheet = page.getByRole('dialog', { name: 'New subscription' });
    const name = `E2E Receiver ${run}`;
    await sheet.getByLabel('Name', { exact: true }).fill(name);
    await sheet.getByLabel('URL', { exact: true }).fill('http://10.0.0.5/hook');
    await sheet.getByRole('button', { name: 'Create subscription' }).click();
    await expect(sheet.getByText(/Use an https URL/)).toBeVisible();
    await sheet.getByLabel('URL', { exact: true }).fill(receiver.url);
    await expect(sheet.getByRole('checkbox', { name: /Lead created/ })).toBeChecked();
    const created = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/webhooks/endpoints/outbound'));
    await sheet.getByRole('button', { name: 'Create subscription' }).click();
    expect((await created).status()).toBe(201);
    const secret = await takeShownOnce(page);

    // Make an event: a new lead through the API.
    const token = await apiToken(page.request, 'company_admin');
    await apiSend(page.request, token, 'POST', '/leads', { name: `Outbound ${run}`, phone: '97' + String(Date.now()).slice(-8), source: 'api' });
    await expect.poll(() => receiver.hits.length, { timeout: 30_000 }).toBeGreaterThan(0);
    const hit = receiver.hits[0]!;
    const sig = String(hit.headers['x-vistar-signature'] ?? '');
    const t = /t=(\d+)/.exec(sig)?.[1];
    const v1s = [...sig.matchAll(/v1=([0-9a-f]{64})/g)].map((m) => m[1]);
    expect(v1s).toContain(createHmac('sha256', secret).update(`${t}.${hit.body}`).digest('hex'));
    expect(hit.headers['x-vistar-event']).toBe('lead.created');

    // The log shows the failed first attempt and the retry schedule.
    await page.goto('/app/webhooks?tab=log', { waitUntil: 'networkidle' });
    await page.getByLabel('Endpoint').selectOption({ label: `${name} (out)` });
    const row = page.locator('[data-delivery][data-status="pending"]').first();
    await expect(row).toBeVisible();
    await row.click();
    const detail = page.getByTestId('delivery-detail');
    await expect(detail.getByRole('list', { name: 'Attempt timeline' })).toContainText('Attempt 1');
    await expect(detail.getByRole('list', { name: 'Attempt timeline' })).toContainText('HTTP 500');
    await expect(detail.getByRole('list', { name: 'Attempt timeline' })).toContainText(/Attempt 2 in \d+/);

    // Receiver fixed: replay goes through as a new delivery and turns Delivered live.
    receiver.respondWith(200);
    await detail.getByRole('button', { name: 'Replay' }).click();
    const replayed = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/replay'));
    await page.getByRole('dialog', { name: 'Replay this delivery?' }).getByRole('button', { name: 'Replay' }).click();
    expect((await replayed).status()).toBe(201);
    await expect(page.getByTestId('delivery-detail')).toHaveAttribute('data-status', 'success', { timeout: 30_000 });
    await expect(page.getByTestId('delivery-status')).toHaveText(/Delivered/);
    expect(receiver.hits.length).toBeGreaterThanOrEqual(2);

    // Test send from the subscription card.
    await page.goto('/app/webhooks?tab=outbound', { waitUntil: 'networkidle' });
    const card = page.locator('li').filter({ has: page.getByRole('heading', { name: new RegExp(name) }) });
    await card.getByRole('button', { name: 'Send test' }).click();
    await expect(page.getByText(/Test delivered: HTTP 200/)).toBeVisible();
    await noMockUse(page);
    expect(errors).toEqual([]);
  } finally {
    await receiver.close();
  }
});

test('API keys: created once, works with a Bearer header, scopes enforced, revoke ends it', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  await page.goto('/app/settings/api-keys', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'API keys' })).toBeVisible();
  await page.getByRole('button', { name: 'New API key' }).click();
  const sheet = page.getByRole('dialog', { name: 'New API key' });
  const name = `E2E Key ${run}`;
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByRole('checkbox', { name: /leads\.read/ }).click();
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/api-keys$/.test(new URL(r.url()).pathname));
  await sheet.getByRole('button', { name: 'Create key' }).click();
  expect((await created).status()).toBe(201);
  const key = await takeShownOnce(page);
  expect(key.startsWith('vst_live_')).toBe(true);
  // Shown once: the page keeps only the prefix.
  await expect(page.getByText(key)).toHaveCount(0);
  const row = page.locator(`[data-api-key="${key.slice(0, 13)}"]`);
  await expect(row).toBeVisible();

  const list = await page.request.get(`${API}/api/v1/leads?limit=1`, { headers: { authorization: `Bearer ${key}` } });
  expect(list.status()).toBe(200);
  const write = await page.request.post(`${API}/api/v1/leads`, { headers: { authorization: `Bearer ${key}` }, data: { name: 'Should not be created', phone: '9000000000' } });
  expect(write.status()).toBe(403);

  await row.getByRole('button', { name: `Revoke ${name}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke key' }).click();
  await expect(page.getByText(`${name} revoked`)).toBeVisible();
  await expect.poll(async () => (await page.request.get(`${API}/api/v1/leads?limit=1`, { headers: { authorization: `Bearer ${key}` } })).status()).toBe(401);
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('API docs: the reference lists the lead routes with a curl example', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  await page.goto('/app/settings/api-docs', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'API docs' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search endpoints' }).fill('leads');
  const nav = page.getByRole('navigation', { name: 'Endpoints' });
  await expect(nav.locator('[data-op="leadList"]')).toBeVisible();
  await expect(nav.locator('[data-op="leadCreate"]')).toBeVisible();
  await nav.locator('[data-op="leadCreate"]').click();
  const op = page.getByTestId('api-operation');
  await expect(op).toContainText('/api/v1/leads');
  await expect(op).toContainText('Request body');
  await expect(op).toContainText('Authorization: Bearer $VISTAR_API_KEY');
  await expect(page).toHaveURL(/#op-leadCreate$/);
  // Internal routes are not in the public reference.
  await page.getByRole('searchbox', { name: 'Search endpoints' }).fill('super');
  await expect(nav.locator('[data-op]')).toHaveCount(0);
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('manager: sees the hub and the log read-only; employee is sent to the employee panel', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'manager');
  await page.goto('/app/integrations', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-provider="indiamart"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Connect / })).toHaveCount(0);
  await page.goto('/app/webhooks?tab=log', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Webhooks and logs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New inbound source' })).toHaveCount(0);
  await page.goto('/app/settings/api-keys', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, 'employee');
  await page.goto('/app/integrations', { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => u.pathname.startsWith('/me'));
  expect(errors).toEqual([]);
});
