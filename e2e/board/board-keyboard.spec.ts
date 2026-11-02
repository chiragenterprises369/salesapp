import { test } from '@playwright/test';
import {
  BOARD_TEST_TIMEOUT,
  expect,
  cardsIn,
  column,
  countOf,
  faceOf,
  leadIdOf,
  leadNameOf,
  liveRegion,
  openBoard,
  signIn,
  waitSettled,
} from './helpers';

test.describe.configure({ timeout: BOARD_TEST_TIMEOUT });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openBoard(page);
});

test('keyboard move: Space picks up, arrows move, Space drops, with announcements', async ({
  page,
}) => {
  const from = column(page, 'new');
  const to = column(page, 'contacted');
  const [fromCount, toCount] = [await countOf(from), await countOf(to)];
  const card = cardsIn(from).first();
  const id = await leadIdOf(card);
  const name = await leadNameOf(card);

  await faceOf(card).focus();
  await page.keyboard.press('Space');
  await expect(liveRegion(page)).toContainText(`Picked up ${name}`);
  await page.keyboard.press('ArrowRight');
  await expect(liveRegion(page)).toContainText('Contacted, position 1 of');
  await page.keyboard.press('ArrowDown');
  await expect(liveRegion(page)).toContainText('Contacted, position 2 of');
  await page.keyboard.press('Space');

  await expect(liveRegion(page)).toContainText(
    new RegExp(`Moved ${name} to Contacted, position 2 of \\d+`),
  );
  await expect(to.locator(`li[data-lead-id="${id}"]`)).toHaveCount(1);
  await expect(cardsIn(to).nth(1)).toHaveAttribute('data-lead-id', id);
  await expect(from.locator('[data-count]')).toHaveAttribute('data-count', String(fromCount - 1));
  await expect(to.locator('[data-count]')).toHaveAttribute('data-count', String(toCount + 1));
  await waitSettled(page);
  // Focus follows the card to its new place.
  await expect(faceOf(to.locator(`li[data-lead-id="${id}"]`))).toBeFocused();
});

test('keyboard move: Escape cancels and the card stays put', async ({ page }) => {
  const from = column(page, 'new');
  const card = cardsIn(from).first();
  const id = await leadIdOf(card);

  await faceOf(card).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(liveRegion(page)).toContainText('Move cancelled');
  await waitSettled(page);
  await expect(cardsIn(from).first()).toHaveAttribute('data-lead-id', id);
});

test('"Move to stage" menu moves a card without dragging', async ({ page }) => {
  const from = column(page, 'new');
  const to = column(page, 'interested');
  const card = cardsIn(from).first();
  const id = await leadIdOf(card);
  const name = await leadNameOf(card);

  await faceOf(card).focus();
  await page
    .getByRole('button', { name: `Move ${name} to stage` })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Interested' }).click();
  await expect(to.locator(`li[data-lead-id="${id}"]`)).toHaveCount(1);
  await expect(liveRegion(page)).toContainText(`Moved ${name} to Interested, position 1`);
  await waitSettled(page);
});
