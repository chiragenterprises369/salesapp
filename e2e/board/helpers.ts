import { expect as baseExpect, type CDPSession, type Locator, type Page } from '@playwright/test';

/** Board assertions wait a little longer than the default (shared, busy CI machines). */
export const expect = baseExpect.configure({ timeout: 15_000 });

/** Per-test budget for board specs (page load + gestures on a loaded machine). */
export const BOARD_TEST_TIMEOUT = 90_000;

/**
 * Board e2e helpers (frontend-physics). Wave 1 runs on the mock data layer: sign in by writing the
 * mock persona to localStorage before any page script runs (works in production builds).
 * Everything waits on DOM state (data attributes the Board exposes), never on fixed sleeps.
 *
 * Board attributes used here:
 * - root: data-board-phase (idle | dragging | dropping), data-pending (moves being saved),
 *   data-motion (full | reduced | flat), data-quality (high | medium | low)
 * - column: section[data-stage-key], data-over="true" while a drag hovers it
 * - count chip: [data-count] (final value; the visible text ticks)
 * - card: li[data-lead-id]; the focusable card has aria-roledescription="draggable card"
 * - overlay: [data-drag-ghost] (lifted card), [data-flight] (arc flights)
 */

export const LEADS_PATH = '/app/leads';

export async function signIn(page: Page, persona = 'company_admin') {
  await page.addInitScript((p) => {
    window.localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: p }));
  }, persona);
}

/** Theme cookie read by the boot script before first paint (same as scripts/smoke-web.mjs). */
export async function setTheme(page: Page, baseURL: string, theme: 'light' | 'dark') {
  await page.context().addCookies([
    {
      name: 'vistar_theme',
      value: encodeURIComponent(
        JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' }),
      ),
      domain: new URL(baseURL).hostname,
      path: '/',
    },
  ]);
  await page.emulateMedia({ colorScheme: theme });
}

export const boardRoot = (page: Page) => page.locator('[data-board-phase]').first();

/**
 * Record arc flights as they appear. A flight lasts about half a second, which can fall between
 * two polls of a locator assertion, so specs check the recording instead of polling the DOM.
 * Returns a reader for the kinds seen so far ("move" | "rollback").
 */
export async function recordFlights(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const w = window as unknown as { __vbFlights?: string[] };
    w.__vbFlights = [];
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          const found = n.matches('[data-flight]') ? [n] : [...n.querySelectorAll('[data-flight]')];
          for (const f of found) w.__vbFlights!.push(f.getAttribute('data-flight') ?? '');
        }
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => (window as unknown as { __vbFlights?: string[] }).__vbFlights ?? []);
}
export const column = (page: Page, key: string) => page.locator(`section[data-stage-key="${key}"]`);
export const cardsIn = (col: Locator) => col.locator('li[data-lead-id]');
export const cardById = (page: Page, id: string) => page.locator(`li[data-lead-id="${id}"]`);
export const faceOf = (li: Locator) =>
  li.locator('[aria-roledescription="draggable card"], [role="checkbox"]').first();
export const ghost = (page: Page) => page.locator('[data-drag-ghost]');
export const liveRegion = (page: Page) => page.locator('[data-board-live]');

/** Open the Leads board and wait until it is interactive (entrance finished, nothing in flight). */
export async function openBoard(page: Page, path = LEADS_PATH) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(column(page, 'new')).toBeVisible({ timeout: 60_000 });
  await expect(cardsIn(column(page, 'new')).first()).toBeVisible();
  await waitSettled(page);
}

/** Board idle: no drag, no pending saves, no running finite animations, no flights. */
export async function waitSettled(page: Page) {
  await expect(boardRoot(page)).toHaveAttribute('data-board-phase', 'idle');
  await expect(boardRoot(page)).toHaveAttribute('data-pending', '0');
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity,
        ),
    null,
    { timeout: 5_000 },
  );
  await expect(page.locator('[data-flight]')).toHaveCount(0);
}

export async function countOf(col: Locator): Promise<number> {
  return Number(await col.locator('[data-count]').first().getAttribute('data-count'));
}

export async function leadIdOf(li: Locator): Promise<string> {
  const id = await li.getAttribute('data-lead-id');
  if (!id) throw new Error('card without data-lead-id');
  return id;
}

/** The card's lead name (the name row of the card). */
export async function leadNameOf(li: Locator): Promise<string> {
  return ((await faceOf(li).locator('[data-lead-name]').textContent()) ?? '').trim();
}

/** Point on a card that is safe to grab (name row, away from the hover actions). */
export async function grabPoint(li: Locator) {
  const b = await faceOf(li).boundingBox();
  if (!b) throw new Error('card not visible');
  return { x: b.x + Math.min(60, b.width / 3), y: b.y + 14 };
}

/** Mouse: press on a card and move past the pick-up threshold; resolves once the card is lifted. */
export async function mousePickUp(page: Page, li: Locator) {
  const p = await grabPoint(li);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 8, p.y + 6, { steps: 3 });
  await expect(ghost(page)).toBeVisible();
  await expect(boardRoot(page)).toHaveAttribute('data-board-phase', 'dragging');
  return p;
}

/** Mouse: drag a lifted card over the top slot of another column (waits until that column is hovered). */
export async function mouseOverColumn(page: Page, target: Locator) {
  const width = page.viewportSize()?.width ?? 1440;
  const inView = async () => {
    const b = await target.boundingBox();
    return !!b && b.x >= 0 && b.x + b.width <= width;
  };
  if (!(await inView())) {
    // Off screen (mobile): hold just inside the board's right edge band (slow auto-scroll) until the
    // column slides under the pointer, then jump out of the band in one step.
    const y = (await target.boundingBox())?.y ?? 300;
    const scroller = page.locator('[role="region"][aria-label$="pipeline"]');
    const sr = await scroller.boundingBox();
    const x = (sr ? sr.x + sr.width : width) - 52;
    await page.mouse.move(x, y + 120, { steps: 4 });
    await target.evaluate(
      (el, px) =>
        new Promise<void>((resolve) => {
          const check = () =>
            el.getBoundingClientRect().left < px - 40 ? resolve() : requestAnimationFrame(check);
          check();
        }),
      x,
    );
    const b = await target.boundingBox();
    if (!b) throw new Error('target column not visible');
    await page.mouse.move(Math.max(b.x + 30, 24), y + 30, { steps: 1 });
    await expect(target).toHaveAttribute('data-over', 'true');
    return;
  }
  const first = cardsIn(target).first();
  const box = (await first.count())
    ? await faceOf(first).boundingBox()
    : await target.boundingBox();
  if (!box) throw new Error('target column not visible');
  await page.mouse.move(box.x + Math.min(60, box.width / 3), box.y + 10, { steps: 12 });
  await expect(target).toHaveAttribute('data-over', 'true');
}

// ------------------------------------------------------------------ touch (CDP, Chromium)

export interface Touch {
  start: (x: number, y: number) => Promise<void>;
  move: (x: number, y: number, steps?: number) => Promise<void>;
  end: () => Promise<void>;
}

/** Real touch input through the DevTools protocol (pointerType "touch", long-press timing honoured). */
export async function touchInput(page: Page): Promise<Touch> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  let at = { x: 0, y: 0 };
  return {
    async start(x, y) {
      at = { x, y };
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y, id: 1 }],
      });
    },
    async move(x, y, steps = 8) {
      const from = at;
      for (let i = 1; i <= steps; i++) {
        const p = {
          x: from.x + ((x - from.x) * i) / steps,
          y: from.y + ((y - from.y) * i) / steps,
        };
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: p.x, y: p.y, id: 1 }],
        });
        at = p;
      }
    },
    async end() {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
  };
}

/**
 * Running animations that move things (transform, translate, scale, rotate) on the Board or its
 * drag overlay. Returns "<tag>.<class> <name>" descriptors.
 */
export async function runningTransformAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scopes = [...document.querySelectorAll('[data-board-phase], [data-drag-overlay]')];
    return document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .filter((a) => {
        const effect = a.effect as KeyframeEffect | null;
        const target = effect?.target;
        if (!target || !scopes.some((s) => s.contains(target))) return false;
        // The global reduced-motion rule turns every style change into a 0.01 ms transition; ignore those.
        if (Number(effect.getComputedTiming().duration ?? 0) <= 1) return false;
        const frames = effect.getKeyframes?.() ?? [];
        return frames.some(
          (f) => 'transform' in f || 'translate' in f || 'scale' in f || 'rotate' in f,
        );
      })
      .map((a) => {
        const t = (a.effect as KeyframeEffect).target as Element;
        return `${t.tagName.toLowerCase()}.${String(t.className).split(' ')[0]} ${(a as CSSAnimation).animationName ?? ''}`.trim();
      });
  });
}
