import { test, type Page } from '@playwright/test';
import { expect, mockAs, watch } from './billing-helpers';

/**
 * Billing pages on the test-only mock data layer (web build with NEXT_PUBLIC_ALLOW_MOCK_DATA=1, no API).
 *   E2E_BASE_URL=http://localhost:3002 pnpm e2e billing/billing-mock --project=desktop
 * The mock checkout provider is always on in this layer.
 */
async function mockSuperAdmin(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('vistar.dataSource', 'mock');
    window.localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'super_admin' }));
  });
}

test('company admin: plan, usage meters, plans and invoices render; an upgrade pays through the test checkout', async ({ page }) => {
  const errors = watch(page);
  await mockAs(page, 'company_admin');
  await page.goto('/app/billing', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Billing and usage' })).toBeVisible();
  await expect(page.locator('[data-metric]')).toHaveCount(7);
  await expect(page.getByRole('meter').first()).toHaveAttribute('aria-valuetext', /\d/);
  await expect(page.locator('[data-plan]')).toHaveCount(4);
  await expect(page.getByRole('table', { name: 'Invoices from Vistar' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Payments' })).toBeVisible();

  const upgrade = page.getByRole('button', { name: /^Upgrade to / }).first();
  test.skip((await upgrade.count()) === 0, 'the mock company is already on the top plan');
  const label = (await upgrade.textContent())!.trim();
  const target = label.replace('Upgrade to ', '');
  await upgrade.click();
  const dialog = page.getByRole('dialog', { name: label });
  await dialog.getByRole('button', { name: 'Continue to payment' }).click();
  const pay = page.getByRole('dialog', { name: 'Test payment' });
  await pay.getByRole('button', { name: 'Decline payment' }).click();
  await expect(pay.getByRole('alert')).toContainText(/declined/i);
  await pay.getByRole('button', { name: /^Pay / }).click();
  await expect(page.getByText(/Payment received/)).toBeVisible();
  await expect(page.locator('#current-plan-title')).toHaveText(target);
  expect(errors).toEqual([]);
});

test('company admin: billing details validate GSTIN and state', async ({ page }) => {
  const errors = watch(page);
  await mockAs(page, 'company_admin');
  await page.goto('/app/billing', { waitUntil: 'networkidle' });
  const card = page.locator('[aria-labelledby="billing-contact-title"]');
  await card.getByRole('button', { name: /Edit|Add details/ }).click();
  await card.getByLabel('GSTIN').fill('27ABCDE');
  await card.getByRole('button', { name: 'Save billing details' }).click();
  await expect(card.getByText(/valid 15-character GSTIN/)).toBeVisible();
  await card.getByLabel('GSTIN').fill('');
  await card.getByRole('button', { name: 'Save billing details' }).click();
  await expect(page.getByText('Billing details saved')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const persona of ['manager', 'viewer', 'employee'] as const) {
  test(`${persona}: no billing page and no Billing nav item`, async ({ page }) => {
    const errors = watch(page);
    await mockAs(page, persona);
    await page.goto('/app/billing', { waitUntil: 'networkidle' });
    if (persona === 'employee') {
      await page.waitForURL((u) => u.pathname.startsWith('/me'));
    } else {
      await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Billing and usage' })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test('Super Admin: subscriptions with totals and filters, company billing tab, manual invoice and mark paid', async ({ page }) => {
  const errors = watch(page);
  await mockSuperAdmin(page);
  await page.goto('/super-admin/billing', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  await expect(page.getByText('Monthly recurring revenue')).toBeVisible();
  const table = page.getByRole('table', { name: 'Subscriptions' });
  await expect(table.getByRole('row')).not.toHaveCount(1);
  await page.getByRole('combobox', { name: 'Status' }).selectOption('trialing');
  await expect(table.getByText('Trial').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('');
  await page.getByRole('searchbox', { name: 'Search companies' }).fill('Shakti');
  await table.getByRole('link', { name: /Shakti/ }).first().click();
  await page.waitForURL(/\/super-admin\/billing\/companies\//);
  await expect(page.getByRole('heading', { level: 1, name: /Shakti.*billing/ })).toBeVisible();

  await page.getByRole('button', { name: 'New invoice' }).click();
  const dialog = page.getByRole('dialog', { name: /New invoice for/ });
  await dialog.getByLabel('Line 1').fill('Onboarding (mock)');
  await dialog.getByLabel('Price (₹)').fill('2500');
  await dialog.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(page.getByText(/Invoice VST\/.* issued to/)).toBeVisible();
  const row = page.getByRole('row', { name: /Onboarding|VST\// }).filter({ has: page.getByRole('button', { name: 'Mark paid' }) }).first();
  await row.getByRole('button', { name: 'Mark paid' }).click();
  await page.getByRole('dialog', { name: /^Mark .* paid$/ }).getByRole('button', { name: /^Record/ }).click();
  await expect(page.getByText(/marked paid/)).toBeVisible();

  await page.getByRole('button', { name: 'Extend trial' }).click();
  const trial = page.getByRole('dialog', { name: /Extend the trial/ });
  await trial.getByLabel('Reason').fill('Pilot with the sales team');
  await trial.getByRole('button', { name: 'Extend trial' }).click();
  await expect(page.getByText(/Trial of .* extended/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('Super Admin: Razorpay card in Config saves test mode and shows the webhook URL', async ({ page }) => {
  const errors = watch(page);
  await mockSuperAdmin(page);
  await page.goto('/super-admin/config', { waitUntil: 'networkidle' });
  const card = page.locator('[aria-labelledby="razorpay-title"]');
  await expect(card).toContainText('/api/hooks/razorpay');
  await card.getByRole('button', { name: 'Set up Razorpay' }).click();
  await card.getByLabel('Key id').fill('rzp_live_abc123');
  await card.getByRole('button', { name: 'Save Razorpay' }).click();
  await expect(card.getByText(/does not match the mode|Enter the key secret/).first()).toBeVisible();
  await card.getByLabel('Key id').fill('rzp_test_abc123XYZ');
  await card.getByLabel('Key secret').fill('secret-key-1234');
  await card.getByLabel('Webhook secret').fill('webhook-secret-99');
  await card.getByRole('button', { name: 'Save Razorpay' }).click();
  await expect(page.getByText('Razorpay saved (test mode)')).toBeVisible();
  await expect(card).toContainText('ending 1234');
  await expect(card).not.toContainText('secret-key-1234');
  expect(errors).toEqual([]);
});
