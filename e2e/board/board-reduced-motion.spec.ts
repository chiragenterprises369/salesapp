import { test } from '@playwright/test';
import {
  BOARD_TEST_TIMEOUT,
  expect,
  boardRoot,
  cardsIn,
  column,
  countOf,
  ghost,
  leadIdOf,
  mouseOverColumn,
  mousePickUp,
  openBoard,
  runningTransformAnimations,
  signIn,
  waitSettled,
} from './helpers';

test.describe.configure({ timeout: BOARD_TEST_TIMEOUT });

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openBoard(page);
});

test('reduced motion: moves still work and no transform animations run', async ({ page }) => {
  await expect(boardRoot(page)).toHaveAttribute('data-motion', 'reduced');
  const from = column(page, 'new');
  const to = column(page, 'contacted');
  const toCount = await countOf(to);
  const card = cardsIn(from).first();
  const id = await leadIdOf(card);

  await mousePickUp(page, card);
  // No tilt on the lifted card.
  await expect(ghost(page).locator('.vb-ghost')).toHaveAttribute(
    'style',
    /rotateX\(0deg\) rotateY\(0deg\) rotateZ\(0deg\)/,
  );
  await mouseOverColumn(page, to);
  expect(await runningTransformAnimations(page)).toEqual([]);
  await page.mouse.up();

  // Instant move: no landing ghost, no arc flight, no transform animation.
  await expect(ghost(page)).toHaveCount(0);
  await expect(page.locator('[data-flight]')).toHaveCount(0);
  expect(await runningTransformAnimations(page)).toEqual([]);
  await expect(to.locator(`li[data-lead-id="${id}"]`)).toHaveCount(1);
  await expect(to.locator('[data-count]')).toHaveAttribute('data-count', String(toCount + 1));
  // Neighbours are not translated (gap closed instantly).
  const moved = await to
    .locator('li[data-lead-id] > div')
    .evaluateAll((els) =>
      els.map((e) => getComputedStyle(e).transform).filter((t) => t !== 'none'),
    );
  expect(moved).toEqual([]);
  await waitSettled(page);
  expect(await runningTransformAnimations(page)).toEqual([]);
});
