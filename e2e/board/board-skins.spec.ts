import { test, type Page } from '@playwright/test';
import { BOARD_TEST_TIMEOUT, boardRoot, expect, openBoard, setTheme, signIn } from './helpers';

test.describe.configure({ timeout: BOARD_TEST_TIMEOUT });

/**
 * Board skins (SPEC 28.1, D-052): Flat, Depth (default) and Neon Space, picked in the board toolbar
 * and saved per person (mock: the session settings in localStorage). The board root exposes the
 * requested skin (data-board-skin-requested), the painted one (data-board-skin), the Neon variant
 * (data-board-variant: neon in Dark, aurora in Light) and the fallback reason.
 */

const picker = (page: Page) => page.locator('[data-board-skin-picker]');

async function pickSkin(page: Page, label: RegExp) {
  await picker(page).click();
  const item = page.getByRole('menuitemradio', { name: label });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

test.describe('desktop', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop skin picker');
    await signIn(page);
  });

  test('switching skins applies at once and persists across reloads', async ({ page, baseURL }) => {
    // The default theme follows the clock (dark from 19:00), so pin Light for the Aurora check.
    await setTheme(page, baseURL!, 'light');
    await openBoard(page);
    const root = boardRoot(page);
    await expect(root).toHaveAttribute('data-board-skin', 'depth');
    await expect(picker(page)).toHaveAccessibleName('Board skin: Depth');

    await pickSkin(page, /^Neon Space/);
    await expect(root).toHaveAttribute('data-board-skin', 'neon');
    await expect(root).toHaveAttribute('data-board-variant', 'aurora'); // Light theme
    await expect(page.locator('.vn-backdrop[data-variant="aurora"]')).toHaveCount(1);
    await expect(picker(page)).toHaveAccessibleName('Board skin: Neon Space');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(boardRoot(page)).toHaveAttribute('data-board-skin', 'neon');
    await expect(picker(page)).toHaveAccessibleName('Board skin: Neon Space');

    await pickSkin(page, /^Flat/);
    await expect(root).toHaveAttribute('data-board-skin', 'flat');
    await expect(root).toHaveAttribute('data-motion', 'flat');
    await expect(page.locator('.vn-backdrop')).toHaveCount(0);

    // Back to the workspace default (Depth); the personal choice is cleared.
    await picker(page).click();
    await page.getByRole('menuitem', { name: /Use the workspace default \(Depth\)/ }).click();
    await expect(root).toHaveAttribute('data-board-skin', 'depth');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(boardRoot(page)).toHaveAttribute('data-board-skin', 'depth');
    await expect(picker(page)).toHaveAccessibleName('Board skin: Depth');
  });

  test('Neon Space in Dark: neon variant, overdue edge and hot-lead pulses', async ({ page, baseURL }) => {
    await setTheme(page, baseURL!, 'dark');
    await openBoard(page);
    await pickSkin(page, /^Neon Space/);
    const root = boardRoot(page);
    await expect(root).toHaveAttribute('data-board-skin', 'neon');
    await expect(root).toHaveAttribute('data-board-variant', 'neon');
    await expect(root).toHaveAttribute('data-board-glow', 'on');

    const overdue = root.locator('[data-overdue]').first();
    await expect(overdue).toBeVisible();
    await expect(overdue).toHaveCSS('animation-name', 'vn-overdue');
    const hot = root.locator('[data-hot]').first();
    await expect(hot).toBeVisible();
    await expect(hot).toHaveCSS('animation-name', 'vn-breathe');

    // Depth paints neither.
    await pickSkin(page, /^Depth/);
    await expect(root).toHaveAttribute('data-board-skin', 'depth');
    await expect(root.locator('[data-overdue]').first()).toBeHidden();
    await expect(root.locator('[data-hot]').first()).toBeHidden();
  });
});

test.describe('mobile', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'device fallback runs in the mobile project');
    await signIn(page);
  });

  test('Neon Space falls back to Flat on a phone and says why', async ({ page }) => {
    await openBoard(page);
    await pickSkin(page, /^Neon Space/);
    const root = boardRoot(page);
    await expect(root).toHaveAttribute('data-board-skin-requested', 'neon');
    await expect(root).toHaveAttribute('data-board-skin', 'flat');
    await expect(root).toHaveAttribute('data-board-skin-fallback', /^(small-screen|touch)$/);
    await expect(root).not.toHaveAttribute('data-board-variant', /.+/);
    await expect(page.locator('.vn-backdrop')).toHaveCount(0);
    await expect(page.locator('[data-board-skin-note]')).toContainText('Neon Space is off on this device');
    await expect(page.locator('[data-board-skin-note]')).toContainText('Showing Flat.');

    // The choice is kept: it still says Neon Space after a reload, and still paints Flat.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(boardRoot(page)).toHaveAttribute('data-board-skin-requested', 'neon');
    await expect(boardRoot(page)).toHaveAttribute('data-board-skin', 'flat');
    await expect(picker(page)).toHaveAccessibleName('Board skin: Neon Space');
  });
});
