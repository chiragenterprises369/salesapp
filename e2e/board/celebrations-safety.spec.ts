import { test, type Page } from '@playwright/test';
import { BOARD_TEST_TIMEOUT, expect } from './helpers';
import { chooseIntensity, fire, layer, openLab, recordLayer, recordLayerAnimations, setTabHidden, trigger, valuesOf, WIDE } from './celebrations.helpers';

/**
 * Celebrations safety (SPEC 28.1): intensity Off and reduced motion replace every effect with a
 * simple fade (no canvas, no particles, opacity only); a hidden tab stops the animation loop and
 * drops what was waiting.
 */

test.describe.configure({ timeout: BOARD_TEST_TIMEOUT });
test.use({ viewport: WIDE });

test.skip(({ isMobile }) => isMobile, 'canvas effects are checked on the wide desktop board');

/** Fire events and check that each one only faded (no canvas, no particles, opacity animations only). */
async function expectFadesOnly(page: Page) {
  await expect(layer(page)).toHaveAttribute('data-celebrations', 'off');
  await expect(layer(page).locator('canvas')).toHaveCount(0);
  const read = await recordLayer(page, ['data-last-effect', 'data-active-particles', 'data-running']);
  const anims = await recordLayerAnimations(page);
  for (const [label, kind] of [
    ['New lead', 'new-lead'],
    ['Stage move', 'stage-move'],
    ['Won', 'won'],
  ] as const) {
    await fire(page, label, kind);
    await expect.poll(async () => valuesOf(await read(), 'data-last-effect')).toContain(`${kind}:fade`);
  }
  await expect.poll(async () => (await anims()).length).toBeGreaterThan(0);
  const changes = await read();
  expect(valuesOf(changes, 'data-last-effect').every((e) => e.endsWith(':fade'))).toBe(true);
  expect(valuesOf(changes, 'data-running').filter((v) => v === 'true')).toEqual([]);
  expect(valuesOf(changes, 'data-active-particles').filter((v) => v !== '0')).toEqual([]);
  // Fades and the Won total chip animate opacity only.
  expect([...new Set((await anims()).flat())]).toEqual(['opacity']);
}

test('intensity Off: simple fades, no canvas animation', async ({ page }) => {
  await openLab(page);
  await chooseIntensity(page, 'Off');
  await expect(layer(page)).toHaveAttribute('data-celebrations-setting', 'off');
  await expectFadesOnly(page);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('reduced motion: simple fades whatever the intensity', async ({ page }) => {
    await openLab(page);
    await chooseIntensity(page, 'Full');
    await expectFadesOnly(page);
  });
});

test('a hidden tab stops the animation loop and drops waiting wins', async ({ page }) => {
  await openLab(page);
  await trigger(page, 'Won x5');
  await expect(layer(page)).toHaveAttribute('data-running', 'true', { timeout: 15_000 });
  await expect.poll(async () => Number(await layer(page).getAttribute('data-active-particles')), { timeout: 15_000 }).toBeGreaterThan(0);

  await setTabHidden(page, true);
  await expect(layer(page)).toHaveAttribute('data-running', 'false');
  await expect(layer(page)).toHaveAttribute('data-won-queued', '0');
  const frozen = await layer(page).evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  // Nothing advances while hidden (a fixed wait is the point of this check).
  await page.waitForTimeout(2500);
  const later = await layer(page).evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  expect(later.activeParticles).toBe(frozen.activeParticles);
  expect(later.wonBursts).toBe(frozen.wonBursts);
  expect(later.running).toBe('false');

  // An event while hidden is counted but not played.
  await fire(page, 'New lead', 'new-lead');
  await expect(layer(page)).toHaveAttribute('data-last-effect', 'new-lead:hidden');
  await expect(layer(page)).toHaveAttribute('data-running', 'false');

  // Visible again: leftover particles finish, then the loop stops; no queued win replays.
  await setTabHidden(page, false);
  await expect(layer(page)).toHaveAttribute('data-active-particles', '0', { timeout: 15_000 });
  await expect(layer(page)).toHaveAttribute('data-running', 'false');
  expect(await layer(page).getAttribute('data-won-bursts')).toBe(frozen.wonBursts);
});
