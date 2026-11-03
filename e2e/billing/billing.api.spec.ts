import { test, type Page } from '@playwright/test';
import { API, apiGet, apiToken, expect, noMockUse, signIn, stamp, superSignIn, superToken, watch } from './billing-helpers';

/**
 * Billing and usage (change #19 wave C, BILLING-WEB) against the billing API on a `seed:demo` database.
 * Skipped unless E2E_API_MODE=1.
 *   E2E_API_MODE=1 E2E_BASE_URL=http://localhost:3002 E2E_API_URL=http://localhost:4030 pnpm e2e billing/billing.api --project=desktop
 * The API runs with BILLING_PROVIDER=auto (no Razorpay config: the dev `mock` provider) for every test
 * except "request change", which needs BILLING_PROVIDER=none (it skips itself otherwise).
 * Order matters (serial). The 402 test moves Shakti to the Free plan and afterAll puts the original plan back.
 */
test.skip(process.env.E2E_API_MODE !== '1', 'API-mode billing suite: set E2E_API_MODE=1 and point the build at the billing API');
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const run = stamp();
interface Meter {
  metric: string;
  label: string;
  used: number;
  limit: number | null;
  unit: 'count' | 'mb';
  state: 'ok' | 'warning' | 'reached';
}
interface Overview {
  subscription: { workspaceId: string; plan: string; cycle: string; extraSeats: number; planName: string; status: string };
  usage: { meters: Meter[] };
  checkout: { available: boolean; provider: 'razorpay' | 'mock' | null };
}
interface InvoiceRow {
  id: string;
  number: string | null;
  status: string;
  balancePaise: number;
  totalPaise: number;
}

let original: Overview['subscription'] | null = null;
let dueInvoiceNumber: string | null = null;

const fmt = (n: number, unit: Meter['unit']) => (unit === 'mb' ? (n >= 1024 ? `${(n / 1024).toFixed(n >= 10_240 ? 0 : 1)} GB` : `${n} MB`) : new Intl.NumberFormat('en-IN').format(n));

async function overview(page: Page): Promise<Overview> {
  const token = await apiToken(page.request, 'company_admin');
  return apiGet<Overview>(page.request, token, '/billing');
}

test.afterAll(async ({ request }) => {
  if (!original) return;
  // Put Shakti back on its original plan (the 402 test moved it to Free).
  const token = await superToken(request);
  const res = await request.post(`${API}/api/super/billing/companies/${original.workspaceId}/plan`, {
    headers: { authorization: `Bearer ${token}` },
    data: { plan: original.plan, cycle: original.cycle, extraSeats: original.extraSeats, effective: 'now', invoice: false, reason: `E2E ${run}: restore after the plan limit test` },
  });
  expect(res.ok(), `restore plan -> ${res.status()}`).toBe(true);
});

test('usage meters show the same numbers as GET /billing', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'company_admin');
  const res = page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/v1\/billing$/.test(new URL(r.url()).pathname) && r.status() === 200);
  await page.goto('/app/billing', { waitUntil: 'domcontentloaded' });
  const body = (await (await res).json()) as Overview;
  await expect(page.getByRole('heading', { level: 1, name: 'Billing and usage' })).toBeVisible();
  await expect(page.locator('#current-plan-title')).toHaveText(body.subscription.planName);
  expect(body.usage.meters.length).toBeGreaterThanOrEqual(6);
  for (const m of body.usage.meters) {
    const card = page.locator(`[data-metric="${m.metric}"]`);
    await expect(card).toContainText(m.label);
    await expect(card).toContainText(m.limit === null ? `${fmt(m.used, m.unit)}` : `${fmt(m.used, m.unit)} of ${fmt(m.limit, m.unit)}`);
    if (m.state === 'reached') await expect(card).toContainText('Limit reached');
    if (m.state === 'warning') await expect(card).toContainText('Almost at the limit');
    const meter = card.getByRole('meter');
    await expect(meter).toHaveAttribute('aria-valuetext', new RegExp(fmt(m.used, m.unit).replace(/[.]/g, '\\.')));
  }
  // The same numbers as the usage route on its own.
  const token = await apiToken(page.request, 'company_admin');
  const usage = await apiGet<{ meters: Meter[] }>(page.request, token, '/billing/usage');
  expect(usage.meters.map((m) => [m.metric, m.used, m.limit])).toEqual(body.usage.meters.map((m) => [m.metric, m.used, m.limit]));
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('Super Admin: manual invoice with GST, then mark it paid; a second one stays due', async ({ page }) => {
  const errors = watch(page);
  const ov = await overview(page);
  await superSignIn(page);
  await page.goto('/super-admin/billing', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search companies' }).fill('Shakti');
  await page.getByRole('link', { name: /Shakti/ }).first().click();
  await page.waitForURL(`**/super-admin/billing/companies/${ov.subscription.workspaceId}`);

  const create = async (name: string, rupees: string) => {
    await page.getByRole('button', { name: 'New invoice' }).click();
    const dialog = page.getByRole('dialog', { name: /New invoice for/ });
    await dialog.getByRole('button', { name: 'Issue invoice' }).click();
    await expect(dialog.getByText('Enter what the line is for.')).toBeVisible();
    await dialog.getByLabel('Line 1').fill(name);
    await dialog.getByLabel('Price (₹)').fill(rupees);
    await expect(dialog.getByText(/GST/).last()).toContainText('₹');
    const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/super\/billing\/companies\/[^/]+\/invoices$/.test(new URL(r.url()).pathname));
    await dialog.getByRole('button', { name: 'Issue invoice' }).click();
    const res = await created;
    expect(res.status()).toBe(201);
    const inv = (await res.json()) as InvoiceRow & { totals: { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number } };
    expect(inv.number).toMatch(/^VST\/\d{4}-\d{2}\/\d{4,}$/);
    // 18 % GST on the taxable value, split CGST + SGST or all IGST.
    const tax = inv.totals.cgstPaise + inv.totals.sgstPaise + inv.totals.igstPaise;
    expect(Math.abs(tax - Math.round(inv.totals.taxablePaise * 0.18))).toBeLessThanOrEqual(2);
    expect(inv.totals.igstPaise === 0 || inv.totals.cgstPaise === 0).toBe(true);
    await expect(page.getByRole('row', { name: new RegExp(inv.number!.replace(/\//g, '\\/')) })).toBeVisible();
    return inv;
  };

  const a = await create(`E2E onboarding ${run}`, '4999');
  const row = page.getByRole('row', { name: new RegExp(a.number!.replace(/\//g, '\\/')) });
  await row.getByRole('button', { name: 'Mark paid' }).click();
  const paid = page.getByRole('dialog', { name: `Mark ${a.number} paid` });
  await paid.getByLabel('Reference').fill(`UTR${run}`);
  const marked = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/invoices/${a.id}/mark-paid`));
  await paid.getByRole('button', { name: /^Record/ }).click();
  expect((await marked).status()).toBe(200);
  await expect(row.getByText('Paid', { exact: true })).toBeVisible();

  const b = await create(`E2E data import ${run}`, '1500');
  dueInvoiceNumber = b.number;
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('company pays a due invoice through the mock checkout', async ({ page }) => {
  const errors = watch(page);
  const ov = await overview(page);
  test.skip(ov.checkout.provider !== 'mock', 'needs the dev mock provider (API without a Razorpay config, BILLING_PROVIDER=auto or mock)');
  const token = await apiToken(page.request, 'company_admin');
  const due = await apiGet<{ items: InvoiceRow[] }>(page.request, token, '/billing/invoices?status=issued&limit=50');
  const target = due.items.find((i) => i.number === dueInvoiceNumber) ?? due.items.find((i) => i.balancePaise > 0);
  test.skip(!target, 'no issued invoice to pay (run the Super Admin test first)');
  await signIn(page, 'company_admin');
  await page.goto('/app/billing', { waitUntil: 'networkidle' });
  const row = page.getByRole('row', { name: new RegExp((target!.number ?? '').replace(/\//g, '\\/')) });
  await row.getByRole('button', { name: /^Pay / }).click();
  const dialog = page.getByRole('dialog', { name: 'Test payment' });
  await expect(dialog).toContainText('No money moves');
  const verified = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/billing/checkout/verify'));
  await dialog.getByRole('button', { name: /^Pay / }).click();
  expect((await verified).status()).toBe(200);
  await expect(page.getByText(/Payment received/)).toBeVisible();
  await expect(row.getByText('Paid', { exact: true })).toBeVisible();
  const after = await apiGet<InvoiceRow>(page.request, token, `/billing/invoices/${target!.id}`);
  expect(after.status).toBe('paid');
  expect(after.balancePaise).toBe(0);
  await expect(page.getByRole('table', { name: 'Payments' })).toContainText(after.number ?? '');
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('without a payment provider, a plan change becomes a request the Super Admin sees', async ({ page }) => {
  const errors = watch(page);
  const ov = await overview(page);
  test.skip(ov.checkout.available, 'needs the API started with BILLING_PROVIDER=none (no Razorpay, no mock)');
  await signIn(page, 'company_admin');
  await page.goto('/app/billing#plans', { waitUntil: 'networkidle' });
  const card = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Request / }) }).first();
  const label = (await card.getByRole('button', { name: /^Request / }).textContent())!.trim();
  await card.getByRole('button', { name: /^Request / }).click();
  const dialog = page.getByRole('dialog', { name: label });
  await dialog.getByLabel('Note for Vistar').fill(`E2E ${run}: 12 users`);
  const sent = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/billing/plan-change'));
  await dialog.getByRole('button', { name: 'Send request' }).click();
  const body = (await (await sent).json()) as { outcome: string; request: { id: string; toPlan: string } | null };
  expect(body.outcome).toBe('requested');
  await expect(page.getByText(/Request for the .* plan sent/)).toBeVisible();

  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await superSignIn(page);
  await page.goto('/super-admin/billing', { waitUntil: 'networkidle' });
  const pending = page.getByRole('region', { name: /Plan requests waiting/ });
  await expect(pending).toContainText(`E2E ${run}: 12 users`);
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('402 PLAN_LIMIT_REACHED shows one toast with the upgrade link', async ({ page, request }) => {
  const errors = watch(page);
  const ov = await overview(page);
  original = ov.subscription;
  // Move Shakti to the Free plan (500 leads) so creating a lead hits the limit; afterAll restores it.
  const token = await superToken(request);
  const moved = await request.post(`${API}/api/super/billing/companies/${ov.subscription.workspaceId}/plan`, {
    headers: { authorization: `Bearer ${token}` },
    data: { plan: 'free', effective: 'now', invoice: false, reason: `E2E ${run}: plan limit toast` },
  });
  expect(moved.ok(), `move to free -> ${moved.status()}`).toBe(true);
  const after = await overview(page);
  const leads = after.usage.meters.find((m) => m.metric === 'leads')!;
  test.skip(leads.limit === null || leads.used < leads.limit, `Free plan lead limit not reached in this database (${leads.used} of ${leads.limit})`);

  await signIn(page, 'company_admin');
  await page.goto('/app/leads', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /New lead/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /New lead/ });
  await dialog.getByLabel('Name', { exact: true }).fill(`E2E over limit ${run}`);
  const blocked = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/leads$/.test(new URL(r.url()).pathname));
  await dialog.getByRole('button', { name: /Create lead/ }).click();
  const res = await blocked;
  expect(res.status()).toBe(402);
  const err = (await res.json()) as { error: { code: string; planLimit?: { metric: string; upgradeUrl: string } } };
  expect(err.error.code).toBe('PLAN_LIMIT_REACHED');
  expect(err.error.planLimit?.metric).toBe('leads');

  // One toast (fixed id), with the upgrade link to the plan cards.
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: /Leads: .* on the Free plan/ });
  await expect(toast).toHaveCount(1);
  const link = toast.getByRole('link', { name: /^See / });
  await expect(link).toHaveAttribute('href', /^\/app\/billing(\?upgrade=\w+)?#plans$/);
  await link.click();
  await page.waitForURL((u) => u.pathname === '/app/billing');
  await expect(page.locator('#plans')).toBeInViewport();
  const suggested = new URL(page.url()).searchParams.get('upgrade');
  if (suggested) await expect(page.locator(`[data-plan="${suggested}"]`)).toContainText('Suggested');
  // The meter shows the reached state.
  await expect(page.locator('[data-metric="leads"]')).toContainText('Limit reached');
  await noMockUse(page);
  expect(errors.filter((e) => !/402/.test(e))).toEqual([]);
});
