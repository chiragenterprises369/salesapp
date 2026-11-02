import { expect, test, type Page } from '@playwright/test';

/**
 * Web attendance (D-063): register, live field map, routes.
 * - Mock data layer (default; build with NEXT_PUBLIC_ALLOW_MOCK_DATA=1): the test-only attendance mock.
 * - API mode (E2E_API_MODE=1, demo database with field data, requests-19b #14): signs in as the company
 *   admin and checks the same pages against real data.
 *
 *   E2E_BASE_URL=http://localhost:3003 pnpm e2e e2e/floor-workspace/attendance --project=desktop
 */
const API_MODE = process.env.E2E_API_MODE === '1';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'vistar-demo-123';

async function signIn(page: Page) {
  if (API_MODE) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').fill('anil@shakti.example');
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    return;
  }
  await page.goto('/kit');
  await page.evaluate(() => localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'manager' })));
}

test.describe('attendance pages', () => {
  test('register: present, checked out, absent, hours and places, late flag rules shown', async ({ page }) => {
    await signIn(page);
    await page.goto('/app/attendance');
    await expect(page.getByRole('heading', { level: 1, name: 'Attendance' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Attendance' }).getByRole('link', { name: 'Register' })).toHaveAttribute('aria-current', 'page');
    const rows = page.locator('[data-attendance-row]');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Summary' })).toBeVisible();
    if (!API_MODE) {
      await expect(page.locator('[data-attendance-row="present"]')).toHaveCount(2);
      await expect(page.locator('[data-attendance-row="checked_out"]')).toHaveCount(1);
      await expect(page.locator('[data-attendance-row="absent"]')).toHaveCount(1);
    }
    await expect(page.getByText(/Late means a check-in more than 15 minutes/)).toBeVisible();
    // Previous day moves the date in the URL.
    await page.getByRole('button', { name: 'Previous day' }).click();
    await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}/);
  });

  test('live map: pins with staleness and a text list', async ({ page }) => {
    await signIn(page);
    await page.goto('/app/attendance/live');
    await expect(page.getByRole('region', { name: 'Map of field staff positions' })).toBeVisible();
    const people = page.locator('[data-field-person]');
    await expect(people.first()).toBeVisible();
    if (!API_MODE) {
      await expect(people).toHaveCount(2);
      await expect(page.locator('[data-field-person][data-stale]')).toHaveCount(1);
      await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2);
    }
    await expect(page.getByText(/OpenStreetMap/)).toBeVisible();
  });

  test('routes: polyline, check-in pin and stops for a person and a date', async ({ page }) => {
    await signIn(page);
    await page.goto('/app/attendance');
    const route = page.getByRole('link', { name: /^Route of / }).first();
    await expect(route).toBeVisible();
    await route.click();
    await expect(page).toHaveURL(/\/app\/attendance\/routes\?user=.+&date=/);
    await expect(page.getByRole('list', { name: 'Route summary' })).toBeVisible();
    await expect(page.locator('path.stroke-accent').first()).toBeVisible();
    if (!API_MODE) await expect(page.getByRole('button', { name: /^Show stop 1 on the map/ })).toBeVisible();
  });
});
