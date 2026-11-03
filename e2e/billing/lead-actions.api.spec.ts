import { test } from '@playwright/test';
import { apiGet, apiSend, apiToken, expect, noMockUse, signIn, stamp, watch } from './billing-helpers';

/**
 * Lead detail actions (change #19 wave C): Convert to deal, Schedule meeting, New quotation.
 * API mode against a `seed:demo` database. Skipped unless E2E_API_MODE=1.
 *   E2E_API_MODE=1 E2E_BASE_URL=http://localhost:3002 E2E_API_URL=http://localhost:4030 pnpm e2e billing/lead-actions --project=desktop
 */
test.skip(process.env.E2E_API_MODE !== '1', 'API-mode suite: set E2E_API_MODE=1 and point the build at the API');
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const run = stamp();
interface LeadRow {
  id: string;
  name: string;
  companyName: string | null;
  contactId: string | null;
  companyId: string | null;
}

async function newLead(page: import('@playwright/test').Page, suffix: string): Promise<LeadRow> {
  const token = await apiToken(page.request, 'company_admin');
  return apiSend<LeadRow>(page.request, token, 'POST', '/leads', {
    name: `E2E Convert ${run}${suffix}`,
    companyName: `E2E Convert Traders ${run}${suffix}`,
    phone: `97${String(Date.now()).slice(-8)}`,
    city: 'Pune',
    source: 'manual',
    valueInr: 125000,
    productInterest: 'Steel racks',
  });
}

async function openMore(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'More actions' }).first().click();
}

test('convert a lead to a deal: contact and account created, the deal opens', async ({ page }) => {
  const errors = watch(page);
  const lead = await newLead(page, 'a');
  await signIn(page, 'company_admin');
  await page.goto(`/app/leads/${lead.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: lead.name })).toBeVisible();

  await openMore(page);
  await page.getByRole('menuitem', { name: 'Convert to deal…' }).click();
  const dialog = page.getByRole('dialog', { name: `Convert ${lead.name} to a deal` });
  await expect(dialog).toBeVisible();
  // Defaults: contact from the lead, account from the company name, a deal with the lead's value.
  await expect(dialog.getByRole('radio', { name: /Create a contact from this lead/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: `Create an account for ${lead.companyName}` })).toBeChecked();
  await expect(dialog.getByRole('switch')).toBeChecked();
  await expect(dialog.getByLabel('Deal title')).toHaveValue(`${lead.companyName} - Steel racks`);
  await expect(dialog.getByLabel('Value (₹, before GST)')).toHaveValue('125000');

  // Validation: a bad GSTIN and a bad value are caught before the request.
  await dialog.getByLabel('GSTIN').fill('27ABCDE1234');
  await dialog.getByLabel('Value (₹, before GST)').fill('12.5');
  await dialog.getByRole('button', { name: 'Convert to deal' }).click();
  await expect(dialog.getByText(/valid 15-character GSTIN/)).toBeVisible();
  await expect(dialog.getByText('Enter the value in whole rupees.')).toBeVisible();
  await dialog.getByLabel('GSTIN').fill('');
  await dialog.getByLabel('Value (₹, before GST)').fill('150000');

  const converted = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/leads/${lead.id}/convert`));
  await dialog.getByRole('button', { name: 'Convert to deal' }).click();
  const res = await converted;
  expect(res.status()).toBeLessThan(300);
  const body = (await res.json()) as { contact: { id: string; name: string }; account: { id: string; name: string } | null; deal: { id: string; title: string; valueInr: number } | null };
  expect(body.contact.name).toBe(lead.name);
  expect(body.account?.name).toBe(lead.companyName);
  expect(body.deal?.valueInr).toBe(150000);

  const result = page.getByRole('dialog', { name: `${lead.name} converted` });
  await expect(result.getByRole('link', { name: lead.name })).toHaveAttribute('href', `/app/contacts/${body.contact.id}`);
  await expect(result.getByRole('link', { name: lead.companyName! })).toHaveAttribute('href', `/app/accounts/${body.account!.id}`);
  await result.getByRole('link', { name: 'Open the deal' }).click();
  await page.waitForURL(`**/app/deals/${body.deal!.id}`);
  await expect(page.getByRole('heading', { level: 1, name: body.deal!.title })).toBeVisible();

  // The lead now links to the contact and the account; the deal links back to the lead.
  const token = await apiToken(page.request, 'company_admin');
  const after = await apiGet<LeadRow>(page.request, token, `/leads/${lead.id}`);
  expect(after.contactId).toBe(body.contact.id);
  expect(after.companyId).toBe(body.account!.id);
  const deal = await apiGet<{ lead: { id: string } | null }>(page.request, token, `/deals/${body.deal!.id}`);
  expect(deal.lead?.id).toBe(lead.id);
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('convert without a deal links an existing account and keeps the contact', async ({ page }) => {
  const errors = watch(page);
  const lead = await newLead(page, 'b');
  const token = await apiToken(page.request, 'company_admin');
  const account = await apiSend<{ id: string; name: string }>(page.request, token, 'POST', '/accounts', { name: `E2E Existing Account ${run}` });
  await signIn(page, 'company_admin');
  await page.goto(`/app/leads/${lead.id}`, { waitUntil: 'networkidle' });
  await openMore(page);
  await page.getByRole('menuitem', { name: 'Convert to deal…' }).click();
  const dialog = page.getByRole('dialog', { name: `Convert ${lead.name} to a deal` });
  await dialog.getByRole('radio', { name: 'Link an existing account' }).click();
  // Without a picked account the form asks for one (the deal switch is still on, so the label is "Convert to deal").
  await dialog.getByRole('button', { name: 'Convert to deal' }).click();
  await expect(dialog.getByText('Pick the account to link.')).toBeVisible();
  await dialog.getByRole('button', { name: /Account to link|Pick an account/ }).click();
  await page.getByRole('combobox', { name: 'Pick an account' }).fill(account.name);
  await page.getByRole('option', { name: new RegExp(account.name) }).click();
  await dialog.getByRole('switch').click();
  const converted = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/leads/${lead.id}/convert`));
  await dialog.getByRole('button', { name: 'Link contact and account' }).click();
  const body = (await (await converted).json()) as { account: { id: string } | null; deal: unknown };
  expect(body.account?.id).toBe(account.id);
  expect(body.deal).toBeNull();
  await expect(page.getByRole('dialog', { name: `${lead.name} converted` })).toBeVisible();
  expect(errors).toEqual([]);
});

test('schedule meeting opens the meeting form linked to the lead; new quotation is linked too', async ({ page }) => {
  const errors = watch(page);
  const lead = await newLead(page, 'c');
  await signIn(page, 'company_admin');
  await page.goto(`/app/leads/${lead.id}`, { waitUntil: 'networkidle' });
  await openMore(page);
  await expect(page.getByRole('menuitem', { name: 'New quotation' })).toHaveAttribute('href', `/app/quotations/new?leadId=${lead.id}`);
  await page.getByRole('menuitem', { name: 'Schedule meeting' }).click();
  await page.waitForURL((u) => u.pathname === '/app/calendar' && u.searchParams.get('leadId') === lead.id);
  const sheet = page.getByRole('dialog', { name: 'New meeting' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Title')).toHaveValue(`Meeting with ${lead.name}`);
  await expect(sheet.getByText(lead.name).first()).toBeVisible();
  await noMockUse(page);
  expect(errors).toEqual([]);
});

test('employee panel: convert is offered, calendar and quotation links are hidden (no /me calendar)', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'employee');
  const token = await apiToken(page.request, 'employee');
  const mine = await apiGet<{ items: LeadRow[] }>(page.request, token, '/leads?limit=1&ownerId=me');
  test.skip(!mine.items.length, 'the employee owns no lead in this database');
  await page.goto(`/me/leads/${mine.items[0]!.id}`, { waitUntil: 'networkidle' });
  await openMore(page);
  await expect(page.getByRole('menuitem', { name: 'Convert to deal…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Schedule meeting' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'New quotation' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('viewer: no sales actions on a lead', async ({ page }) => {
  const errors = watch(page);
  await signIn(page, 'viewer');
  const token = await apiToken(page.request, 'viewer');
  const any = await apiGet<{ items: LeadRow[] }>(page.request, token, '/leads?limit=1');
  await page.goto(`/app/leads/${any.items[0]!.id}`, { waitUntil: 'networkidle' });
  await openMore(page);
  for (const name of ['Convert to deal…', 'Schedule meeting', 'New quotation']) await expect(page.getByRole('menuitem', { name })).toHaveCount(0);
  expect(errors).toEqual([]);
});
