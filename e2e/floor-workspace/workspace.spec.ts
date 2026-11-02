import { expect, test, type Page } from '@playwright/test';

/**
 * Floor workspace (SPEC 29.11), mock data layer (build with NEXT_PUBLIC_ALLOW_MOCK_DATA=1):
 * module panels over the floor by keyboard, resize, dock/float, the command bar, the person panel,
 * links that stay on the floor, and full screen (F, Esc) with panels still usable.
 *
 * Run against a running app: E2E_BASE_URL=http://localhost:3003 pnpm e2e e2e/floor-workspace/workspace --project=desktop
 */

async function signIn(page: Page, persona: 'manager' | 'company_admin' | 'employee' = 'manager') {
  await page.goto('/kit');
  await page.evaluate((p) => {
    localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: p }));
    localStorage.setItem('vistar.floor.qa', '1');
    localStorage.removeItem('vistar.floor.workspace');
  }, persona);
}

async function openFloor(page: Page, path = '/app/team-floor?floorMode=flat') {
  await page.goto(path);
  await expect(page.locator('[data-floor-workspace]')).toBeVisible();
  await expect(page.locator('[data-floor-map]')).toBeVisible();
  // Focus the page body so single-key shortcuts reach the workspace.
  await page.locator('h1').first().click();
}

test.describe('floor workspace', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop keyboard checks');

  test('module panels open over the floor by keyboard, Esc closes and returns focus', async ({ page }) => {
    await signIn(page);
    await openFloor(page);
    await page.keyboard.press('3');
    const dock = page.locator('[data-floor-dock]');
    await expect(dock).toBeVisible();
    await expect(dock.getByRole('tab', { name: 'Tasks', selected: true })).toBeVisible();
    // The floor keeps running underneath.
    await expect(page.locator('[data-floor-map]')).toBeVisible();
    await expect(dock.getByRole('tabpanel')).toBeFocused();

    await page.keyboard.press('4');
    await expect(dock.getByRole('tab', { name: 'Calls', selected: true })).toBeVisible();
    await expect(dock.getByRole('tab')).toHaveCount(2);

    // Arrow keys move between tabs, Delete closes the focused tab.
    await dock.getByRole('tab', { name: 'Calls' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(dock.getByRole('tab', { name: 'Tasks', selected: true })).toBeFocused();

    await dock.getByRole('tabpanel').focus();
    await page.keyboard.press('Escape');
    await expect(dock.getByRole('tab')).toHaveCount(1);
    await dock.getByRole('tabpanel').focus();
    await page.keyboard.press('Escape');
    await expect(dock).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Calls', pressed: false })).toBeFocused();
  });

  test('panels resize from the keyboard and switch between float and dock', async ({ page }) => {
    await signIn(page);
    await openFloor(page);
    await page.keyboard.press('1');
    const handle = page.getByRole('separator', { name: 'Resize the panel' });
    await expect(handle).toBeVisible();
    const before = Number(await handle.getAttribute('aria-valuenow'));
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', await handle.getAttribute('aria-valuemin') ?? '360');

    const dock = page.locator('[data-floor-dock]');
    await expect(dock).toHaveAttribute('data-floor-dock', 'float');
    const toggle = page.getByRole('button', { name: /Dock the panel beside the floor/ });
    if (await toggle.count()) {
      await toggle.click();
      await expect(dock).toHaveAttribute('data-floor-dock', 'dock');
    }
  });

  test('command bar finds a person and opens the person panel; links stay on the floor', async ({ page }) => {
    await signIn(page);
    await openFloor(page);
    const first = page.locator('section[aria-label="Sales floor"] ul button').first();
    const name = ((await first.locator('span.truncate').first().textContent()) ?? '').trim();
    expect(name.length).toBeGreaterThan(1);

    await page.keyboard.press('/');
    const bar = page.getByRole('dialog', { name: 'Floor commands' });
    await expect(bar).toBeVisible();
    await page.keyboard.type(name.split(' ')[0]!);
    await page.keyboard.press('Enter');
    await expect(bar).toHaveCount(0);
    const panel = page.locator('[data-person-panel]');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { level: 3 })).toContainText(name.split(' ')[0]!);
    for (const label of ['Status', 'Where', 'Doing now']) await expect(panel.getByText(label, { exact: true })).toBeVisible();

    // "Their leads" opens the Leads panel filtered to them, on the floor.
    const theirLeads = panel.getByRole('button', { name: 'Their leads' });
    if (await theirLeads.count()) {
      await theirLeads.click();
      await expect(page.locator('[data-floor-dock]').getByRole('tab', { selected: true })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/app/team-floor');
      expect(new URL(page.url()).searchParams.get('ownerId')).toBeTruthy();
    }

    await panel.getByRole('button', { name: 'Close employee details' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('a lead link inside a panel opens the lead drawer without leaving the floor', async ({ page }) => {
    await signIn(page);
    await openFloor(page);
    await page.keyboard.press('3');
    const dock = page.locator('[data-floor-dock]');
    const leadLink = dock.locator('a[href*="?lead="]').first();
    await expect(leadLink).toBeVisible({ timeout: 15_000 });
    await leadLink.click();
    await expect(page).toHaveURL(/\/app\/team-floor\?.*lead=/);
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('full screen with F; panels and dialogs still work; F again leaves', async ({ page }) => {
    await signIn(page);
    await openFloor(page);
    await page.keyboard.press('f');
    const ws = page.locator('[data-floor-workspace]');
    await expect(ws).toHaveAttribute('data-fullscreen', /native|immersive/);
    const box = await ws.boundingBox();
    const vp = page.viewportSize()!;
    expect(Math.round(box!.width)).toBe(vp.width);
    expect(Math.round(box!.height)).toBe(vp.height);

    await page.keyboard.press('2');
    await expect(page.locator('[data-floor-dock]')).toBeVisible();
    await page.locator('h1').first().click();
    await page.keyboard.press('/');
    const bar = page.getByRole('dialog', { name: 'Floor commands' });
    await expect(bar).toBeVisible();
    // No Esc here: in real full screen the browser takes Esc to leave full screen.
    await page.keyboard.type('Close all panels');
    await page.keyboard.press('Enter');
    await expect(bar).toHaveCount(0);
    await expect(page.locator('[data-floor-dock]')).toHaveCount(0);
    await expect(ws).toHaveAttribute('data-fullscreen', /native|immersive/);

    await page.locator('h1').first().click();
    await page.keyboard.press('f');
    await expect(ws).not.toHaveAttribute('data-fullscreen', /.+/);
  });

  test('without the Fullscreen API the immersive mode is left with Esc', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => false });
    });
    await signIn(page);
    await openFloor(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    const ws = page.locator('[data-floor-workspace]');
    await expect(ws).toHaveAttribute('data-fullscreen', 'immersive');
    await page.locator('h1').first().click();
    await page.keyboard.press('Escape');
    await expect(ws).not.toHaveAttribute('data-fullscreen', /.+/);
  });

  test('keyboard shortcut list and the status note are reachable', async ({ page }) => {
    await signIn(page);
    await openFloor(page);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /How status works/ }).click();
    await expect(page.getByText('Vistar cannot tell whether someone is physically at their desk', { exact: false })).toBeVisible();
  });

  test('employee floor: read-only person panel and the employee panels', async ({ page }) => {
    await signIn(page, 'employee');
    await openFloor(page, '/me/team-floor?floorMode=flat');
    await page.keyboard.press('1');
    await expect(page.locator('[data-floor-dock]').getByRole('tab', { selected: true })).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
