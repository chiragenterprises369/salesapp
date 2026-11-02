import { test } from '@playwright/test';
import { BOARD_TEST_TIMEOUT, expect } from './helpers';
import { fire, layer, openLab, recordLayer, trigger, valuesOf, WIDE } from './celebrations.helpers';

/**
 * Board event celebrations (SPEC 28.1): each real board event gets its own effect on the one
 * capped canvas, and Won is throttled. Triggers come from the lab's mock realtime sim, which patches
 * the same query cache that realtime events and the Leads page live feed patch.
 */

test.describe.configure({ timeout: BOARD_TEST_TIMEOUT });
test.use({ viewport: WIDE });

test.skip(({ isMobile }) => isMobile, 'canvas effects are checked on the wide desktop board');

test.beforeEach(async ({ page }) => {
  await openLab(page);
});

const CASES = [
  { label: 'New lead', kind: 'new-lead', effect: 'new-lead:stream' },
  { label: 'Stage move', kind: 'stage-move', effect: 'stage-move:ring' },
  { label: 'Quote sent', kind: 'quote-sent', effect: 'quote-sent:envelope' },
  { label: 'Won', kind: 'won', effect: 'won:burst' },
  { label: 'Lost', kind: 'lost', effect: 'lost:shards' },
] as const;

test('each board event plays its own effect on one capped canvas', async ({ page }) => {
  await expect(layer(page)).toHaveAttribute('data-celebrations', 'full');
  await expect(layer(page).locator('canvas')).toHaveCount(1);
  await expect(layer(page)).toHaveAttribute('data-running', 'false');
  const read = await recordLayer(page, ['data-last-effect', 'data-active-particles', 'data-running']);

  for (const c of CASES) {
    await fire(page, c.label, c.kind);
    await expect.poll(async () => valuesOf(await read(), 'data-last-effect'), { message: `${c.kind} effect` }).toContain(c.effect);
    if (c.kind === 'won') await expect(page.locator('[data-won-total]')).toBeAttached();
    // Let it finish: the loop stops when nothing is alive.
    await expect(layer(page)).toHaveAttribute('data-running', 'false', { timeout: 15_000 });
    await expect(layer(page)).toHaveAttribute('data-active-particles', '0');
  }

  const changes = await read();
  const particles = valuesOf(changes, 'data-active-particles').map(Number);
  expect(Math.max(...particles)).toBeGreaterThan(0);
  expect(Math.max(...particles)).toBeLessThanOrEqual(300);
  expect(Number(await layer(page).getAttribute('data-peak-particles'))).toBeLessThanOrEqual(300);
  // The loop ran only while effects were alive, and stopped after each one.
  expect(valuesOf(changes, 'data-running')).toContain('true');
  // No fades in Full: every event got its animated effect.
  expect(valuesOf(changes, 'data-last-effect').filter((e) => e.endsWith(':fade'))).toEqual([]);
});

test('Won: at most one burst per 2 s, more than 3 waiting are skipped', async ({ page }) => {
  const read = await recordLayer(page, ['data-won-bursts', 'data-won-queued', 'data-won-skipped']);
  await trigger(page, 'Won x5');

  // Five wins land within about a second: one plays, three wait, the fifth finds the queue full.
  await expect(layer(page)).toHaveAttribute('data-won-skipped', '1', { timeout: 15_000 });
  await expect(layer(page)).toHaveAttribute('data-won-bursts', '4', { timeout: 15_000 });
  await expect(layer(page)).toHaveAttribute('data-won-queued', '0');

  const changes = await read();
  expect(Math.max(...valuesOf(changes, 'data-won-queued').map(Number))).toBeLessThanOrEqual(3);
  const bursts = changes.filter((c) => c.attr === 'data-won-bursts').map((c) => c.t);
  expect(bursts).toHaveLength(4);
  for (let i = 1; i < bursts.length; i++) expect(bursts[i]! - bursts[i - 1]!).toBeGreaterThanOrEqual(1990);
  expect(Number(await layer(page).getAttribute('data-peak-particles'))).toBeLessThanOrEqual(300);
});
