import { test, type Page } from '@playwright/test';
import { BOARD_TEST_TIMEOUT, expect } from './helpers';
import { layer, liveState, openLeads, setTabHidden } from './celebrations.helpers';

/**
 * Mock live feed on the Leads Board (lib/leads/mock-realtime): off under automation unless
 * localStorage `vistar.mock.live=1`; `vistar.mock.live=0` is the user's opt-out; paused while the
 * tab is hidden. `vistar.mock.live.fast=1` runs it 20x faster (a new lead every 1-2 s).
 */

test.describe.configure({ timeout: BOARD_TEST_TIMEOUT });
test.skip(({ isMobile }) => isMobile, 'the feed does not depend on the device; checked once on desktop');

async function setFlags(page: Page, flags: Record<string, string>) {
  await page.addInitScript((f) => {
    for (const [k, v] of Object.entries(f)) window.localStorage.setItem(k, v);
  }, flags);
}

test('live feed is off under automation by default', async ({ page }) => {
  await openLeads(page);
  await expect.poll(() => liveState(page)).toEqual({ active: false, reason: 'webdriver', events: 0 });
  // Nothing arrives by itself (the board stays exactly as loaded).
  await page.waitForTimeout(3000);
  await expect(layer(page)).toHaveAttribute('data-event-count', '0');
});

test('the opt-out wins over everything', async ({ page }) => {
  await setFlags(page, { 'vistar.mock.live': '0', 'vistar.mock.live.fast': '1' });
  await openLeads(page);
  await expect.poll(() => liveState(page)).toEqual({ active: false, reason: 'opted-out', events: 0 });
});

test('with the opt-in the feed brings events and pauses while the tab is hidden', async ({ page }) => {
  await setFlags(page, { 'vistar.mock.live': '1', 'vistar.mock.live.fast': '1' });
  await openLeads(page);
  await expect.poll(async () => (await liveState(page))?.reason).toBe('on');
  expect((await liveState(page))?.active).toBe(true);

  // Events reach the board and its celebrations layer.
  await expect.poll(async () => (await liveState(page))?.events ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(async () => Number(await layer(page).getAttribute('data-event-count')), { timeout: 20_000 }).toBeGreaterThan(0);

  await setTabHidden(page, true);
  const paused = (await liveState(page))?.events ?? 0;
  // Fast mode would fire 2 to 4 events in this window if it were running.
  await page.waitForTimeout(4500);
  expect((await liveState(page))?.events).toBe(paused);

  await setTabHidden(page, false);
  await expect.poll(async () => (await liveState(page))?.events ?? 0, { timeout: 20_000 }).toBeGreaterThan(paused);
});
