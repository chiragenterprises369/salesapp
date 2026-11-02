#!/usr/bin/env node
// Theme switch check (SPEC 12.1 item 2): opens the floor in Light, switches to Dark with the top-bar
// theme control and records the Day -> Evening lightmap blend every animation frame, saves frames
// (Day, held mid-fade, Evening) and switches back. Fails on page or console errors, when the blend
// does not reach 1, or when it is not instant under reduced motion.
// Usage: node e2e/team-floor/theme.mjs [base] [template=medium] [outDir] [--reduced]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { canvasBox, floorPage, launch, openFloor } from './lib.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const reduced = process.argv.includes('--reduced');
const [base = 'http://localhost:3005', template = 'medium', outDir] = args;
const browser = await launch();
const { context, page, errors } = await floorPage(browser, base, { width: 1440, height: 900, dpr: 1, theme: 'light' });
if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
await openFloor(page, base, '/app/team-floor', { floorTemplate: template, floorStress: 14 });
const box = await canvasBox(page);
if (outDir) mkdirSync(outDir, { recursive: true });
const tag = `${template}${reduced ? '-reduced' : ''}`;
const shot = (name) => (outDir ? page.screenshot({ path: join(outDir, `theme-${tag}-${name}.png`), clip: box }) : null);

async function pick(mode) {
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await page.getByRole('radio', { name: new RegExp(`^${mode}`) }).click();
  await page.keyboard.press('Escape');
}

/** Records (ms since the theme attribute flipped, lightMix) on every animation frame. */
async function record() {
  await page.evaluate(() => {
    const log = [];
    window.__mixLog = log;
    let flippedAt = 0;
    const start = document.documentElement.dataset.theme;
    const tick = () => {
      const now = performance.now();
      if (!flippedAt && document.documentElement.dataset.theme !== start) flippedAt = now;
      if (flippedAt) log.push([Math.round(now - flippedAt), Math.round(window.__vistarFloor.lightMix() * 1000) / 1000]);
      if (!flippedAt || now - flippedAt < 900) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

await shot('day');
await record();
await pick('Dark');
await page.waitForTimeout(1200);
const toDark = await page.evaluate(() => window.__mixLog);
await shot('evening');
// Mid-fade frame: hold the cross-fade half way (QA hook), then release.
await page.evaluate(() => window.__vistarFloor.holdThemeTween(0.5));
await page.waitForTimeout(300);
await shot('mid');
await page.evaluate(() => window.__vistarFloor.holdThemeTween(null));
await record();
await pick('Light');
await page.waitForTimeout(1200);
const toLight = await page.evaluate(() => window.__mixLog);

// Summaries: first frame with a partial blend, frame where it completes.
const summary = (log, target) => {
  const done = log.find(([, m]) => Math.abs(m - target) < 0.001);
  const partial = log.filter(([, m]) => m > 0.001 && m < 0.999);
  return { frames: log.length, partialFrames: partial.length, completesAtMs: done?.[0] ?? null, samples: log.filter((_, i) => i % 3 === 0).slice(0, 12) };
};
const dark = summary(toDark, 1);
const light = summary(toLight, 0);
const info = await page.evaluate(() => window.__vistarFloor.info());
console.log(JSON.stringify({ template, reduced, renderer: info.renderer, toDark: dark, toLight: light, errors }, null, 1));
await context.close();
await browser.close();
const ok = !errors.length && dark.completesAtMs !== null && light.completesAtMs !== null && (reduced ? dark.partialFrames === 0 : dark.partialFrames > 3);
if (!ok) {
  console.error('theme check FAILED');
  process.exitCode = 1;
}
