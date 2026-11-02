import { test } from '@playwright/test';
import {
  BOARD_TEST_TIMEOUT,
  expect,
  boardRoot,
  cardsIn,
  column,
  countOf,
  ghost,
  grabPoint,
  leadIdOf,
  leadNameOf,
  openBoard,
  signIn,
  touchInput,
  waitSettled,
} from './helpers';

test.describe.configure({ timeout: BOARD_TEST_TIMEOUT });

/**
 * Mobile rule: press-and-move = drag; press-and-release after the 180 ms long-press (no movement)
 * = actions sheet; a quick tap opens the lead; a quick swipe scrolls.
 */
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'touch gestures run in the mobile project');
  await signIn(page);
  await openBoard(page);
});

test('long-press and release opens the actions sheet', async ({ page }) => {
  const card = cardsIn(column(page, 'new')).first();
  const id = await leadIdOf(card);
  const name = await leadNameOf(card);
  const p = await grabPoint(card);
  const touch = await touchInput(page);

  await touch.start(p.x, p.y);
  await expect(ghost(page)).toBeVisible(); // long-press picked it up (haptic tick where supported)
  await touch.end();

  const sheet = page.locator('[data-board-actions-sheet]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Open / })).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toHaveCount(0);
  await waitSettled(page);
  await expect(cardsIn(column(page, 'new')).first()).toHaveAttribute('data-lead-id', id);
});

test('long-press then move drags the card (reorder in its column)', async ({ page }) => {
  const col = column(page, 'new');
  const first = cardsIn(col).nth(0);
  const second = cardsIn(col).nth(1);
  const [a, b] = [await leadIdOf(first), await leadIdOf(second)];
  const p = await grabPoint(first);
  const box = await second.boundingBox();
  const touch = await touchInput(page);

  await touch.start(p.x, p.y);
  await expect(ghost(page)).toBeVisible();
  await touch.move(p.x, p.y + (box?.height ?? 100) * 1.4, 10);
  await expect(boardRoot(page)).toHaveAttribute('data-board-phase', 'dragging');
  await touch.end();

  await expect(page.locator('[data-board-actions-sheet]')).toHaveCount(0);
  await expect(cardsIn(col).nth(0)).toHaveAttribute('data-lead-id', b);
  await expect(cardsIn(col).nth(1)).toHaveAttribute('data-lead-id', a);
  await waitSettled(page);
});

test('long-press then move to the screen edge auto-scrolls and moves the card to another column', async ({
  page,
}) => {
  const from = column(page, 'new');
  const fromCount = await countOf(from);
  const card = cardsIn(from).first();
  const id = await leadIdOf(card);
  const p = await grabPoint(card);
  const width = page.viewportSize()?.width ?? 412;
  const touch = await touchInput(page);

  await touch.start(p.x, p.y);
  await expect(ghost(page)).toBeVisible();
  await touch.move(width - 10, p.y + 40, 12);
  // Edge auto-scroll brings the next column under the finger.
  await expect(page.locator('section[data-over="true"]:not([data-stage-key="new"])')).toHaveCount(
    1,
  );
  await touch.end();

  await expect(from.locator(`li[data-lead-id="${id}"]`)).toHaveCount(0);
  await expect(from.locator('[data-count]')).toHaveAttribute('data-count', String(fromCount - 1));
  await expect(
    page.locator(`section:not([data-stage-key="new"]) li[data-lead-id="${id}"]`),
  ).toHaveCount(1);
  await waitSettled(page);
});

test('every board control is at least 44 px on touch screens', async ({ page }) => {
  const small = await boardRoot(page)
    .locator('button, [role="button"], [role="checkbox"]')
    .evaluateAll((els) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            r.right > 0 &&
            r.left < window.innerWidth &&
            r.bottom > 0 &&
            r.top < window.innerHeight
          );
        })
        .map((el) => ({
          label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30),
          w: el.getBoundingClientRect().width,
          h: el.getBoundingClientRect().height,
        }))
        .filter((r) => r.w < 43.5 || r.h < 43.5),
    );
  expect(small).toEqual([]);
});
