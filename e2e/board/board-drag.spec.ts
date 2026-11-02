import { test } from '@playwright/test';
import {
  BOARD_TEST_TIMEOUT,
  expect,
  boardRoot,
  cardById,
  cardsIn,
  column,
  countOf,
  ghost,
  leadIdOf,
  leadNameOf,
  liveRegion,
  mouseOverColumn,
  mousePickUp,
  openBoard,
  signIn,
  waitSettled,
} from './helpers';

test.describe.configure({ timeout: BOARD_TEST_TIMEOUT });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openBoard(page);
});

test('drag a card to another column: counts update and the move is saved', async ({ page }) => {
  const from = column(page, 'new');
  const to = column(page, 'contacted');
  const [fromCount, toCount] = [await countOf(from), await countOf(to)];
  const card = cardsIn(from).first();
  const id = await leadIdOf(card);
  const name = await leadNameOf(card);

  await mousePickUp(page, card);
  await mouseOverColumn(page, to);
  await page.mouse.up();

  await expect(to.locator(`li[data-lead-id="${id}"]`)).toHaveCount(1);
  await expect(from.locator(`li[data-lead-id="${id}"]`)).toHaveCount(0);
  await expect(from.locator('[data-count]')).toHaveAttribute('data-count', String(fromCount - 1));
  await expect(to.locator('[data-count]')).toHaveAttribute('data-count', String(toCount + 1));
  await expect(liveRegion(page)).toContainText(`Moved ${name} to Contacted, position 1`);
  await waitSettled(page);

  // Saved: a fresh read from the data source (new query for this search) has it in Contacted.
  await page.getByPlaceholder('Search name, company, phone').fill(name);
  await expect(boardRoot(page)).toHaveAttribute('aria-busy', 'false');
  await expect(column(page, 'contacted').locator(`li[data-lead-id="${id}"]`)).toHaveCount(1);
  await expect(column(page, 'new').locator(`li[data-lead-id="${id}"]`)).toHaveCount(0);
});

test('drop outside any column: the card springs back and nothing changes', async ({ page }) => {
  const from = column(page, 'new');
  const fromCount = await countOf(from);
  const card = cardsIn(from).first();
  const id = await leadIdOf(card);

  const start = await mousePickUp(page, card);
  await page.mouse.move(start.x, 12, { steps: 10 });
  await expect(page.locator('section[data-over="true"]')).toHaveCount(0);
  await page.mouse.up();

  await expect(ghost(page)).toHaveCount(0);
  await waitSettled(page);
  await expect(cardsIn(from).first()).toHaveAttribute('data-lead-id', id);
  await expect(from.locator('[data-count]')).toHaveAttribute('data-count', String(fromCount));
  await expect(liveRegion(page)).toContainText('Move cancelled');
  await expect(boardRoot(page)).toHaveAttribute('data-pending', '0');
});

test('failed save: the card returns to its column and an error toast shows', async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { __vistarMockFailRate: number }).__vistarMockFailRate = 1;
  });
  const from = column(page, 'new');
  const to = column(page, 'contacted');
  const [fromCount, toCount] = [await countOf(from), await countOf(to)];
  const card = cardsIn(from).first();
  const id = await leadIdOf(card);
  const name = await leadNameOf(card);

  await mousePickUp(page, card);
  await mouseOverColumn(page, to);
  await page.mouse.up();

  // Rollback animation (arc back to the origin), then the card sits in New again.
  await expect(page.locator('[data-flight="rollback"]')).toBeAttached();
  await expect(page.getByText(`Could not move ${name}`)).toBeVisible();
  await waitSettled(page);
  await expect(from.locator(`li[data-lead-id="${id}"]`)).toHaveCount(1);
  await expect(cardById(page, id)).toHaveCount(1);
  await expect(to.locator(`li[data-lead-id="${id}"]`)).toHaveCount(0);
  await expect(from.locator('[data-count]')).toHaveAttribute('data-count', String(fromCount));
  await expect(to.locator('[data-count]')).toHaveAttribute('data-count', String(toCount));
  // The toast stays after the animation.
  await expect(page.getByText(`Could not move ${name}`)).toBeVisible();
});
