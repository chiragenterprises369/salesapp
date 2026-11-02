import { test, type Page } from '@playwright/test';
import { expect, mockAs, watch, type Persona } from './crm-helpers';

/**
 * CRM pages on the test-only mock data layer (no API). Every module opens for the personas that may
 * use it with no console errors; permissions hide create buttons and settings; the live GST math in the
 * quotation editor switches between CGST + SGST and IGST with the place of supply.
 * Needs a web build with NEXT_PUBLIC_ALLOW_MOCK_DATA=1.
 */
const noAccess = (page: Page) => page.getByRole('heading', { name: 'You do not have access to this page' });

const PAGES = [
  { path: '/app/contacts', title: 'Contacts', create: 'New contact', perm: ['company_admin', 'manager', 'employee', 'viewer'] },
  { path: '/app/accounts', title: 'Accounts', create: 'New account', perm: ['company_admin', 'manager', 'employee', 'viewer'] },
  { path: '/app/deals', title: 'Deals', create: 'New deal', perm: ['company_admin', 'manager', 'employee', 'viewer'] },
  { path: '/app/products', title: 'Products', create: 'New product', perm: ['company_admin', 'manager', 'employee', 'viewer'] },
  { path: '/app/quotations', title: 'Quotations', create: 'New quotation', perm: ['company_admin', 'manager', 'employee', 'viewer'] },
  { path: '/app/invoices', title: 'Invoices', create: 'New invoice', perm: ['company_admin', 'manager', 'employee', 'viewer'] },
  { path: '/app/calendar', title: 'Calendar', create: 'New meeting', perm: ['company_admin', 'manager', 'employee', 'viewer'] },
] as const;

/** Who may create what (DEFAULT_ROLE_PERMISSIONS in packages/shared/src/rbac.ts). */
const CAN_CREATE: Record<string, readonly Persona[]> = {
  'New contact': ['company_admin', 'manager', 'employee'],
  'New account': ['company_admin', 'manager', 'employee'],
  'New deal': ['company_admin', 'manager', 'employee'],
  'New product': ['company_admin'],
  'New quotation': ['company_admin', 'manager', 'employee'],
  'New invoice': ['company_admin', 'manager'],
  'New meeting': ['company_admin', 'manager', 'employee'],
};

for (const p of PAGES) {
  for (const persona of ['company_admin', 'manager', 'viewer'] as const) {
    test(`${p.title} opens for ${persona} (mock)`, async ({ page }) => {
      const errors = watch(page);
      await mockAs(page, persona);
      await page.goto(p.path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1, name: p.title })).toBeVisible();
      const button = page.getByRole('button', { name: p.create }).or(page.getByRole('link', { name: p.create }));
      if (CAN_CREATE[p.create]!.includes(persona)) await expect(button.first()).toBeVisible();
      else await expect(button).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}

test('contacts list shows seeded people and filters by search (mock)', async ({ page }) => {
  const errors = watch(page);
  await mockAs(page, 'company_admin');
  await page.goto('/app/contacts', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Rahul Mehta' }).first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search contacts' }).fill('Priya');
  await expect(page.getByRole('link', { name: 'Rahul Mehta' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Priya Shah' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('column sets: hide a column, save the set, reload keeps it (mock)', async ({ page }) => {
  await mockAs(page, 'company_admin');
  await page.goto('/app/accounts', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('columnheader', { name: 'Industry' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose columns' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Industry' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: 'Industry' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose columns' }).click();
  await page.getByRole('menuitem', { name: 'Save as column set…' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Compact');
  await page.getByRole('button', { name: 'Save set' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Columns: Compact' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Industry' })).toHaveCount(0);
});

test('employee cannot open lead routing or capture settings (mock)', async ({ page }) => {
  await mockAs(page, 'employee');
  await page.goto('/app/settings/lead-routing', { waitUntil: 'domcontentloaded' });
  // Employees either get the No access state or are sent to their own panel (/me).
  await expect.poll(async () => new URL(page.url()).pathname.startsWith('/me') || (await noAccess(page).count()) > 0, { timeout: 20_000 }).toBe(true);
  await expect(page.getByRole('button', { name: 'New rule' })).toHaveCount(0);
});

test('admin settings: GST and billing, lead routing, lead capture open (mock)', async ({ page }) => {
  const errors = watch(page);
  await mockAs(page, 'company_admin');
  await page.goto('/app/settings/billing-profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'GST and billing' })).toBeVisible();
  await expect(page.getByLabel('Legal name')).toHaveValue(/Shakti/);
  await page.goto('/app/settings/lead-routing', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Website leads round robin')).toBeVisible();
  await page.getByRole('button', { name: 'Test routing' }).click();
  await expect(page.getByTestId('routing-result')).toContainText(/would get this lead/);
  await page.goto('/app/settings/lead-capture', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Website enquiry' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('quotation editor: CGST + SGST inside the seller state, IGST across states (mock)', async ({ page }) => {
  const errors = watch(page);
  await mockAs(page, 'company_admin');
  await page.goto('/app/quotations/new', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Buyer name').fill('Mock Buyer');
  await page.getByLabel('Item name, line 1').fill('Steel rack');
  await page.getByLabel('HSN/SAC').fill('940320');
  await page.getByLabel('Qty').fill('2');
  await page.getByLabel('Rate (₹, before GST)').fill('1000');
  // Seller state in the mock profile is Maharashtra (27): same state = CGST + SGST.
  await page.getByLabel('Place of supply').selectOption('27');
  const totals = page.locator('aside').filter({ hasText: 'Totals' });
  await expect(totals.getByText('CGST', { exact: true })).toBeVisible();
  await expect(page.getByTestId('document-total')).toHaveText('₹2,360.00');
  await page.getByLabel('Place of supply').selectOption('29');
  await expect(totals.getByText('IGST', { exact: true })).toBeVisible();
  await expect(totals.getByText('CGST', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('document-total')).toHaveText('₹2,360.00');
  await expect(totals).toContainText('Rupees Two Thousand Three Hundred Sixty Only');
  await page.getByRole('radio', { name: 'Preview' }).click();
  await expect(page.getByRole('article', { name: /Tax invoice preview|Quotation preview/ })).toContainText('Mock Buyer');
  expect(errors).toEqual([]);
});

test('deals board: move a card with the keyboard menu (mock)', async ({ page }) => {
  const errors = watch(page);
  await mockAs(page, 'company_admin');
  await page.goto('/app/deals', { waitUntil: 'domcontentloaded' });
  const firstMenu = page.getByRole('button', { name: /^Move .* to another stage$/ }).first();
  await expect(firstMenu).toBeVisible();
  const title = (await firstMenu.getAttribute('aria-label'))!.replace(/^Move /, '').replace(/ to another stage$/, '');
  await firstMenu.click();
  await page.getByRole('menuitem', { name: 'Negotiation' }).click();
  await expect(page.getByRole('listitem', { name: /^Negotiation,/ }).getByRole('link', { name: title })).toBeVisible();
  expect(errors).toEqual([]);
});

test('calendar: week view, create a meeting, it shows in the agenda (mock)', async ({ page }) => {
  const errors = watch(page);
  await mockAs(page, 'company_admin');
  await page.goto('/app/calendar', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New meeting' }).first().click();
  await page.getByLabel('Title').fill('Mock e2e meeting');
  await page.getByRole('button', { name: 'Schedule meeting' }).click();
  await page.getByRole('radio', { name: 'Agenda' }).click();
  await expect(page.getByText('Mock e2e meeting').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('hosted capture form submits and shows the thank-you message (mock)', async ({ page }) => {
  const errors = watch(page);
  await mockAs(page, 'company_admin');
  await page.goto('/f/mockform000001?utm_source=e2e', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Your name').fill('Mock Visitor');
  await page.getByLabel('Mobile number').fill('9876500011');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(/Thank you/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile: contacts render as cards with no sideways scroll (mock)', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile project only');
  await mockAs(page, 'manager');
  await page.goto('/app/contacts', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('list', { name: 'Contacts' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
