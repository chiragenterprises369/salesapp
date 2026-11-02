// Mid-animation frames of each Board event celebration (SPEC 28.1), triggered from /dev/board-physics.
// Usage (worktree root, web app running): node docs/screenshots/leads-neon/events/capture.mjs http://localhost:3004 [outDir] [--skin=neon]
// Writes <outDir>/<theme>-<event>.png at 1440x900, DPR 1, dark and light. Default outDir: iter-01 next to this file.
// --skin=neon sets data-board-skin="neon" on the board root (neon palette on the canvas) before triggering.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const [, , base = 'http://localhost:3004', outArg, ...rest] = process.argv;
const outDir = outArg && !outArg.startsWith('--') ? outArg : join(here, 'iter-01');
const skin = [outArg, ...rest].find((a) => a?.startsWith('--skin='))?.split('=')[1] ?? null;
mkdirSync(outDir, { recursive: true });

/** Button, effect to wait for, extra delay into the effect (ms), board scroll (left | right). */
const EVENTS = [
  { kind: 'new-lead', button: 'New lead', effect: 'new-lead:stream', after: 230, scroll: 'left' },
  { kind: 'stage-move', button: 'Stage move', effect: null, after: 110, scroll: 'left' },
  { kind: 'quote-sent', button: 'Quote sent', effect: 'quote-sent:envelope', after: 330, scroll: 'mid' },
  { kind: 'won', button: 'Won', effect: 'won:burst', after: 380, scroll: 'right' },
  { kind: 'lost', button: 'Lost', effect: 'lost:shards', after: 260, scroll: 'right' },
];

const layer = (page) => page.locator('[data-celebrations]');

async function scrollBoard(page, where) {
  await page.evaluate((w) => {
    const s = document.querySelector('[role="region"][aria-label$="pipeline"]');
    if (!s) return;
    s.scrollLeft = w === 'left' ? 0 : w === 'right' ? s.scrollWidth : s.scrollWidth * 0.3;
  }, where);
  await page.waitForTimeout(250);
}

const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
  const { hostname } = new URL(base);
  await context.addCookies([{ name: 'vistar_theme', value: encodeURIComponent(JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' })), domain: hostname, path: '/' }]);
  await context.addInitScript(() => window.localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'company_admin' })));
  const page = await context.newPage();
  await page.goto(`${base}/dev/board-physics`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.locator('section[data-stage-key="new"] li[data-lead-id]').first().waitFor({ timeout: 90_000 });
  await layer(page).waitFor({ state: 'attached' });
  await page.waitForTimeout(1500);
  if (skin) await page.evaluate((s) => document.querySelector('[data-board-phase]')?.setAttribute('data-board-skin', s), skin);

  for (const ev of EVENTS) {
    await scrollBoard(page, ev.scroll);
    const before = Number((await layer(page).getAttribute('data-event-count')) ?? 0);
    await page.locator('[data-celebration-triggers] button', { hasText: new RegExp(`^${ev.button}$`) }).click();
    await page.waitForFunction(
      ({ k, n }) => {
        const el = document.querySelector('[data-celebrations]');
        return el?.getAttribute('data-last-event') === k && Number(el.getAttribute('data-event-count')) > n;
      },
      { k: ev.kind, n: before },
      { timeout: 8000 },
    );
    if (ev.effect) {
      await page
        .waitForFunction((e) => document.querySelector('[data-celebrations]')?.getAttribute('data-last-effect') === e, ev.effect, { timeout: 4000 })
        .catch(() => console.warn(`${theme} ${ev.kind}: effect ${ev.effect} not seen (last ${''})`));
    }
    await page.waitForTimeout(ev.after);
    const file = join(outDir, `${skin ? `neon-palette-` : ''}${theme}-${ev.kind}.png`);
    await page.screenshot({ path: file });
    const stats = await layer(page).evaluate((el) => ({ ...el.dataset }));
    console.info(file, JSON.stringify({ effect: stats.lastEffect, particles: stats.activeParticles, peak: stats.peakParticles, running: stats.running }));
    // Let it finish (and respect the 2 s Won throttle) before the next event.
    await page.waitForFunction(() => document.querySelector('[data-celebrations]')?.getAttribute('data-running') !== 'true', null, { timeout: 6000 }).catch(() => undefined);
    await page.waitForTimeout(ev.kind === 'won' ? 2100 : 400);
  }
  await context.close();
}
await browser.close();
