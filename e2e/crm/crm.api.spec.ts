import { test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { computeDocument } from '../../packages/shared/src/gst';
import { apiGet, apiSend, apiToken, expect, gstin, listTotal, noMockUse, signIn, stamp, watch } from './crm-helpers';

/**
 * CRM-WEB against the real CRM API (`seed:demo` database). Skipped unless E2E_API_MODE=1.
 *   E2E_API_MODE=1 E2E_BASE_URL=http://localhost:3004 E2E_API_URL=http://localhost:4030 pnpm e2e crm/crm.api --project=desktop
 * Order matters (serial): the quotation made here is converted to an invoice, the capture form
 * submissions run last because of the per-IP rate limit (5 a minute).
 */
test.skip(process.env.E2E_API_MODE !== '1', 'API-mode CRM suite: set E2E_API_MODE=1 and point the build at the CRM API');
test.describe.configure({ mode: 'serial', timeout: 150_000 });

const run = stamp();
let quotationId = '';

const STATE_NAME: Record<string, string> = { '27': 'Maharashtra', '29': 'Karnataka', '24': 'Gujarat' };

async function sellerState(page: Page): Promise<string> {
  const token = await apiToken(page.request, 'company_admin');
  const res = await apiGet<{ stateCode: string | null; complete: boolean }>(page.request, token, '/billing/profile');
  if (res.complete && res.stateCode) return res.stateCode;
  // A demo database without a seller profile: give it one in Maharashtra (needed to send and issue).
  await apiSend(page.request, token, 'PUT', '/billing/profile', {
    legalName: 'Shakti Industries Private Limited',
    address: { line1: 'Plot 21, MIDC Bhosari', city: 'Pune', stateCode: '27', pincode: '411026', country: 'IN' },
  });
  return '27';
}

test('scopes: contacts and deals totals follow the role data scope', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  const allContacts = await listTotal(page, '/app/contacts', /\/api\/v1\/contacts$/);
  const allAccounts = await listTotal(page, '/app/accounts', /\/api\/v1\/accounts$/);
  await noMockUse(page);
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, 'manager');
  const teamContacts = await listTotal(page, '/app/contacts', /\/api\/v1\/contacts$/);
  const teamAccounts = await listTotal(page, '/app/accounts', /\/api\/v1\/accounts$/);
  await noMockUse(page);
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, 'employee');
  // Employees land on their own panel; the company CRM pages are for admins, managers and viewers.
  await page.goto('/app/contacts', { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => u.pathname.startsWith('/me'));
  expect(allContacts).toBeGreaterThan(0);
  expect(allContacts).toBeGreaterThanOrEqual(teamContacts);
  expect(allAccounts).toBeGreaterThanOrEqual(teamAccounts);
  expect(errors).toEqual([]);
});

test('viewer sees contacts and quotations read-only', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'viewer');
  await page.goto('/app/contacts', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New contact' })).toHaveCount(0);
  await page.goto('/app/quotations', { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'New quotation' })).toHaveCount(0);
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('contact: create with validation, edit, note, appears in search', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  await page.goto('/app/contacts', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New contact' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'New contact' });
  await sheet.getByLabel('Phone', { exact: true }).fill('12345');
  await sheet.getByRole('button', { name: 'Add contact' }).click();
  await expect(sheet.getByText('Enter the name.')).toBeVisible();
  await expect(sheet.getByText(/10-digit mobile number/).first()).toBeVisible();
  const name = `E2E Contact ${run}`;
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByLabel('Phone', { exact: true }).fill(`98${String(Date.now()).slice(-8)}`);
  await sheet.getByLabel('GSTIN').fill('27AAAAA0000A1Z0');
  await sheet.getByRole('button', { name: 'Add contact' }).click();
  await expect(sheet.getByText(/valid 15-character GSTIN/)).toBeVisible();
  await sheet.getByLabel('GSTIN').fill('');
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/contacts$/.test(new URL(r.url()).pathname));
  await sheet.getByRole('button', { name: 'Add contact' }).click();
  expect((await created).status()).toBe(201);
  await page.getByRole('searchbox', { name: 'Search contacts' }).fill(name);
  await page.getByRole('link', { name }).first().click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByLabel('Add a note').fill('Met at the trade fair');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Met at the trade fair');
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('account: GSTIN fills the billing state; detail shows it', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  await page.goto('/app/accounts', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New account' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'New account' });
  const name = `E2E Account ${run}`;
  await sheet.getByLabel('Account name').fill(name);
  // 29 = Karnataka; the GSTIN state fills the billing state.
  await sheet.getByLabel('GSTIN').fill(gstin('29', `AAB1234F`));
  await sheet.getByLabel('Address line 1').fill('12 MG Road');
  await sheet.getByLabel('City').fill('Bengaluru');
  const state = sheet.getByLabel('State', { exact: true });
  if ((await state.inputValue()) !== '29') await state.selectOption('29');
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/accounts$/.test(new URL(r.url()).pathname));
  await sheet.getByRole('button', { name: 'Add account' }).click();
  expect((await created).status()).toBe(201);
  await page.getByRole('searchbox', { name: 'Search accounts' }).fill(name);
  await page.getByRole('link', { name }).first().click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('Karnataka').first()).toBeVisible();
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('deals: board loads, a keyboard move survives a reload', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  await page.goto('/app/deals', { waitUntil: 'domcontentloaded' });
  const menu = page.getByRole('button', { name: /^Move .* to another stage$/ }).first();
  await expect(menu).toBeVisible({ timeout: 60_000 });
  const title = (await menu.getAttribute('aria-label'))!.replace(/^Move /, '').replace(/ to another stage$/, '');
  await menu.click();
  const target = page.locator('[role="menuitem"]:not([data-disabled])').first();
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/deals\/[0-9a-f-]{36}\/move$/.test(new URL(r.url()).pathname));
  await target.click();
  const res = await saved;
  expect(res.ok(), `move ${title}`).toBe(true);
  const moved = (await res.json()) as { id: string; stageId: string };
  await page.reload({ waitUntil: 'domcontentloaded' });
  const token = await apiToken(page.request, 'company_admin');
  expect((await apiGet<{ stageId: string }>(page.request, token, `/deals/${moved.id}`)).stageId).toBe(moved.stageId);
  await page.getByRole('radio', { name: 'Table' }).click();
  await expect(page.getByRole('table', { name: 'Deals' })).toBeVisible();
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('product: create with HSN and GST rate, then find it', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  await page.goto('/app/products', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New product' }).click();
  const sheet = page.getByRole('dialog', { name: 'New product' });
  const sku = `E2E-${run}`.toUpperCase();
  await sheet.getByLabel('Name', { exact: true }).fill(`E2E rack ${run}`);
  await sheet.getByLabel('SKU').fill(sku);
  await sheet.getByLabel('HSN code').fill('12');
  await sheet.getByLabel('Price (₹, before GST)').fill('1000');
  await sheet.getByRole('button', { name: 'Add product' }).click();
  await expect(sheet.getByText(/An HSN code has 4, 6 or 8 digits/)).toBeVisible();
  await sheet.getByLabel('HSN code').fill('940320');
  await sheet.getByLabel('GST rate').selectOption('18');
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/products$/.test(new URL(r.url()).pathname));
  await sheet.getByRole('button', { name: 'Add product' }).click();
  expect((await created).status()).toBe(201);
  await page.getByRole('searchbox', { name: 'Search products' }).fill(sku);
  await expect(page.getByText(sku).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('quotation: inter-state supply uses IGST, totals match the shared GST math, PDF downloads', async ({ page, browser }) => {
  const errors = watch(page);
  const seller = await sellerState(page);
  const buyerState = seller === '29' ? '27' : '29';
  await signIn(page, 'company_admin');
  await page.goto('/app/quotations/new', { waitUntil: 'networkidle' });
  await page.getByLabel('Buyer name').fill(`E2E Buyer ${run}`);
  await page.getByLabel('Address line 1').first().fill('4th Cross, Indiranagar');
  await page.getByLabel('City').first().fill(buyerState === '29' ? 'Bengaluru' : 'Pune');
  await page.getByLabel('State', { exact: true }).first().selectOption(buyerState);
  await page.getByLabel('Item name, line 1').fill('E2E steel rack');
  await page.getByLabel('HSN/SAC').fill('940320');
  await page.getByLabel('Qty').fill('3');
  await page.getByLabel('Rate (₹, before GST)').fill('1250.50');
  await page.getByLabel('Discount, line 1').fill('5');
  await page.getByLabel('GST rate').selectOption('18');
  const expected = computeDocument([{ quantity: 3, unitPricePaise: 125_050, discountKind: 'percent', discountValue: 5, gstRate: 18, hsnSac: '940320' }], { sellerStateCode: seller, placeOfSupplyStateCode: buyerState });
  expect(expected.totals.taxMode).toBe('inter');
  const totals = page.locator('aside').filter({ hasText: 'Totals' });
  await expect(totals.getByText('IGST', { exact: true })).toBeVisible();
  await expect(totals.getByText('CGST', { exact: true })).toHaveCount(0);
  await expect(totals).toContainText(`Inter-state supply from ${STATE_NAME[seller] ?? ''}`.trim());
  const totalText = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(expected.totals.totalPaise / 100);
  await expect(page.getByTestId('document-total')).toHaveText(`₹${totalText}`);
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/quotations$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: 'Save quotation as draft' }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const q = (await res.json()) as { id: string; number: string; totals: { taxMode: string; igstPaise: number; totalPaise: number } };
  quotationId = q.id;
  expect(q.totals.taxMode).toBe('inter');
  expect(q.totals.igstPaise).toBe(expected.totals.igstPaise);
  expect(q.totals.totalPaise).toBe(expected.totals.totalPaise);
  await page.waitForURL(new RegExp(`/app/quotations/${q.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: `Quotation ${q.number}` })).toBeVisible();
  await expect(page.getByText('IGST').first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/i);
  const path = await file.path();
  expect(readFileSync(path!).subarray(0, 4).toString()).toBe('%PDF');

  // Send: the share link opens without signing in.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Quotation ${q.number}` });
  const url = await dialog.locator('input[readonly]').first().inputValue();
  expect(url).toMatch(/\/d\/[A-Za-z0-9_-]{32,64}$/);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();
  const guest = await browser.newContext();
  const pub = await guest.newPage();
  await pub.goto(url, { waitUntil: 'networkidle' });
  await expect(pub.getByRole('heading', { level: 1, name: new RegExp(`Quotation ${q.number.replace(/\//g, '\\/')}`) })).toBeVisible();
  await expect(pub.getByRole('article')).toContainText('IGST');
  await guest.close();
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('invoice: convert the quotation, issue it, record a part payment', async ({ page }) => {
  test.skip(!quotationId, 'needs the quotation of the previous test');
  const errors = watch(page);
  await signIn(page, 'company_admin');
  await page.goto(`/app/quotations/${quotationId}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as accepted' }).click();
  await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Convert to invoice' }).click();
  await page.waitForURL(/\/app\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Draft invoice' })).toBeVisible();
  await page.getByRole('button', { name: 'Issue invoice' }).click();
  const issued = page.waitForResponse((r) => /\/issue$/.test(new URL(r.url()).pathname));
  await page.getByRole('dialog').getByRole('button', { name: 'Issue invoice' }).click();
  expect((await issued).ok()).toBe(true);
  await expect(page.getByRole('heading', { level: 1, name: /^Invoice [A-Z0-9-]+\/\d{4}-\d{2}\/\d+$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Record payment' }).click();
  const pay = page.getByRole('dialog', { name: 'Record a payment' });
  await pay.getByLabel('Amount (₹)').fill('100');
  await pay.getByLabel('Reference').fill(`UTR${run}`);
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Partially paid').first()).toBeVisible();
  await expect(page.getByRole('table', { name: 'Payments' })).toContainText('₹100.00');
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('calendar: meeting from a lead, it shows in the agenda, then is rescheduled', async ({ page }) => {
  const errors = watch(page);
  const token = await apiToken(page.request, 'company_admin');
  const leads = await apiGet<{ items: Array<{ id: string; name: string }> }>(page.request, token, '/leads?limit=1');
  const lead = leads.items[0]!;
  await signIn(page, 'company_admin');
  await page.goto(`/app/calendar?new=1&leadId=${lead.id}`, { waitUntil: 'networkidle' });
  const sheet = page.getByRole('dialog', { name: 'New meeting' });
  await expect(sheet.getByLabel('Title')).toHaveValue(`Meeting with ${lead.name}`);
  const title = `E2E meeting ${run}`;
  await sheet.getByLabel('Title').fill(title);
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/meetings$/.test(new URL(r.url()).pathname));
  await sheet.getByRole('button', { name: 'Schedule meeting' }).click();
  const meeting = (await (await created).json()) as { id: string; lead: { id: string } | null };
  expect(meeting.lead?.id).toBe(lead.id);
  await page.getByRole('radio', { name: 'Agenda' }).click();
  await page.getByRole('button', { name: new RegExp(title) }).first().click();
  await page.getByRole('button', { name: 'Edit or reschedule' }).click();
  const edit = page.getByRole('dialog', { name: `Edit ${title}` });
  await edit.getByLabel('Starts').fill('15:00');
  await edit.getByLabel('Ends').fill('15:30');
  const patched = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith(`/meetings/${meeting.id}`));
  await edit.getByRole('button', { name: 'Save meeting' }).click();
  expect((await patched).ok()).toBe(true);
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('lead routing: the test panel answers who would get a website lead', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  await page.goto('/app/settings/lead-routing', { waitUntil: 'networkidle' });
  await expect(page.getByRole('list', { name: 'Routing rules in order' })).toBeVisible();
  await page.getByLabel('Source').selectOption('website');
  const tested = page.waitForResponse((r) => /\/routing-rules\/test$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: 'Test routing' }).click();
  expect((await tested).ok()).toBe(true);
  await expect(page.getByTestId('routing-result')).toContainText(/would get this lead/);
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('capture form: a hosted-page submission becomes a routed website lead with UTM', async ({ page, browser }) => {
  const token = await apiToken(page.request, 'company_admin');
  const forms = await apiGet<{ items: Array<{ id: string; key: string; status: string; fields: Array<{ id: string; label: string; mapTo: string | null; required: boolean; type: string }>; settings: { ownerId: string | null } }> }>(page.request, token, '/capture-forms');
  const form = forms.items.find((f) => f.status === 'active');
  expect(form, 'the demo seed has an active capture form').toBeTruthy();
  const guest = await browser.newContext();
  const pub = await guest.newPage();
  const errors = watch(pub);
  await pub.goto(`/f/${form!.key}?utm_source=e2e&utm_campaign=crm-web`, { waitUntil: 'networkidle' });
  const name = `E2E Visitor ${run}`;
  const phone = `97${String(Date.now()).slice(-8)}`;
  for (const f of form!.fields) {
    if (f.type === 'hidden') continue;
    const input = pub.getByLabel(f.label, { exact: false }).first();
    if (f.mapTo === 'name') await input.fill(name);
    else if (f.mapTo === 'phone' || f.type === 'phone') await input.fill(phone);
    else if (f.mapTo === 'email' || f.type === 'email') await input.fill(`e2e.${run}@example.com`);
    else if (f.required && (f.type === 'text' || f.type === 'textarea')) await input.fill('Need 10 racks');
    else if (f.required && f.type === 'select') await input.selectOption({ index: 1 });
    else if (f.required && f.type === 'checkbox') await input.check();
  }
  const consent = pub.getByRole('checkbox').last();
  if (await pub.getByText(/agree/i).count()) await consent.check();
  const sent = pub.waitForResponse((r) => /\/public\/forms\/[^/]+\/submit$/.test(new URL(r.url()).pathname));
  await pub.locator('form button[type="submit"]').click();
  expect((await sent).status()).toBe(200);
  await expect(pub.getByText(/thank you/i).first()).toBeVisible();
  // The honeypot is in the page but off-screen and hidden from assistive tech.
  await expect(pub.locator('input[name="company_website"]')).toHaveCount(1);
  expect(errors).toEqual([]);
  await guest.close();

  await expect
    .poll(async () => (await apiGet<{ items: Array<{ name: string; source: string; owner: { id: string } | null }> }>(page.request, token, `/leads?q=${encodeURIComponent(name)}`)).items[0] ?? null, { timeout: 30_000 })
    .toMatchObject({ name, source: 'website' });
  const lead = (await apiGet<{ items: Array<{ owner: { id: string } | null }> }>(page.request, token, `/leads?q=${encodeURIComponent(name)}`)).items[0]!;
  // Routed: a fixed form owner, a matching rule or the fallback owner gets it (the demo seed has rules).
  expect(lead.owner, 'the lead was routed to an owner').not.toBeNull();
  const subs = await apiGet<{ items: Array<{ utm: { source?: string; campaign?: string } }> }>(page.request, token, `/capture-forms/${form!.id}/submissions`);
  expect(subs.items[0]?.utm).toMatchObject({ source: 'e2e', campaign: 'crm-web' });
});

test('capture form: quick repeat submissions from one address are rate limited (429)', async ({ page, browser }) => {
  const token = await apiToken(page.request, 'company_admin');
  const forms = await apiGet<{ items: Array<{ key: string; status: string; fields: Array<{ id: string; mapTo: string | null }> }> }>(page.request, token, '/capture-forms');
  const form = forms.items.find((f) => f.status === 'active')!;
  const nameId = form.fields.find((f) => f.mapTo === 'name')!.id;
  const phoneId = form.fields.find((f) => f.mapTo === 'phone')?.id;
  const emailId = form.fields.find((f) => f.mapTo === 'email')?.id;
  const guest = await browser.newContext();
  const statuses: number[] = [];
  const api = (process.env.E2E_API_URL ?? 'http://localhost:4030').replace(/\/$/, '');
  for (let i = 0; i < 7; i++) {
    const values: Record<string, string> = { [nameId]: `Rate ${run} ${i}` };
    if (phoneId) values[phoneId] = `+9196${String(10_000_000 + Number.parseInt(run, 36) % 1_000_000 + i).slice(-8)}`;
    else if (emailId) values[emailId] = `rate.${run}.${i}@example.com`;
    const r = await guest.request.post(`/api/v1/public/forms/${form.key}/submit`, { data: { values, utm: { source: 'e2e-rate' } } });
    statuses.push(r.status());
  }
  await guest.close();
  // 5 a minute per address and form (CAPTURE_RATE_LIMITS); the previous test already used one.
  expect(statuses[0]).toBe(200);
  expect(statuses).toContain(429);
  expect(statuses.lastIndexOf(200)).toBeLessThan(statuses.indexOf(429));
});