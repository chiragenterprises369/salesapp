import { expect, test, type Page } from '@playwright/test';

/**
 * SPEC 12.1 item 7: the Flat view draws the current template as a 2D plan and stays fully usable by
 * keyboard (one tab stop for the list, arrow keys move between people, Enter opens the details).
 * Mobile (Pixel 7) gets Flat by default.
 * Run against a running app: E2E_BASE_URL=http://localhost:3005 pnpm e2e e2e/team-floor
 */

const TEMPLATES = [
  { id: 'small', query: '' },
  { id: 'medium', query: '&floorTemplate=medium&floorStress=14' },
  { id: 'large', query: '&floorStress=36' },
];

async function signIn(page: Page) {
  await page.goto('/kit');
  await page.evaluate(() => {
    localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'manager' }));
    localStorage.setItem('vistar.floor.qa', '1');
  });
}

for (const t of TEMPLATES) {
  test(`flat plan and keyboard path: ${t.id}`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop check');
    await signIn(page);
    await page.goto(`/app/team-floor?floorMode=flat${t.query}`);
    const map = page.locator('[data-floor-map]');
    await expect(map).toHaveAttribute('data-floor-map', t.id);
    // The plan is decorative for assistive tech; the list carries the information.
    await expect(map).toHaveAttribute('aria-hidden', 'true');
    const people = Number(await map.getAttribute('data-people'));
    expect(people).toBeGreaterThan(0);
    const buttons = page.locator('section[aria-label="Sales floor"] ul button');
    await expect(buttons).toHaveCount(people);
    // Exactly one tab stop in the list (roving tabindex).
    await expect(page.locator('section[aria-label="Sales floor"] ul button[tabindex="0"]')).toHaveCount(1);
    await buttons.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(buttons.nth(1)).toBeFocused();
    const name = ((await buttons.nth(1).locator('span.truncate').first().textContent()) ?? '').trim();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
    await page.getByRole('button', { name: 'Close employee details' }).click();
    await expect(buttons.nth(1)).toBeFocused();
  });
}

test('mobile gets the flat plan by default', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile check');
  await signIn(page);
  await page.goto('/app/team-floor?floorTemplate=medium');
  await expect(page.locator('[data-floor-map]')).toHaveAttribute('data-floor-map', 'medium');
  await expect(page.locator('[data-floor-canvas]')).toHaveCount(0);
});
