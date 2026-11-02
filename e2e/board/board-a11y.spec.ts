import AxeBuilder from '@axe-core/playwright';
import { test, type Page } from '@playwright/test';
import { BOARD_TEST_TIMEOUT, expect, openBoard, setTheme, signIn, waitSettled } from './helpers';

test.describe.configure({ timeout: BOARD_TEST_TIMEOUT });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Serious and critical axe violations, as "rule: target" lines (readable in the failure diff). */
async function seriousViolations(page: Page, include?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(WCAG);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .flatMap((v) => v.nodes.map((n) => `${v.id} (${v.impact}): ${n.target.join(' ')}`));
}

for (const theme of ['light', 'dark'] as const) {
  test(`axe: Leads board has no serious or critical issues (${theme})`, async ({ page, baseURL }) => {
    await setTheme(page, baseURL!, theme);
    await signIn(page);
    await openBoard(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test(`axe: board physics demo has no serious or critical issues (${theme})`, async ({ page, baseURL }) => {
    await setTheme(page, baseURL!, theme);
    await signIn(page);
    await page.goto('/dev/board-physics', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('section[data-stage-key="new"] li[data-lead-id]').first()).toBeVisible({ timeout: 60_000 });
    await waitSettled(page);
    expect(await seriousViolations(page)).toEqual([]);
  });
}
