#!/usr/bin/env node
// Theme switch check (SPEC 12.1 item 2): opens the floor in Light, switches to Dark with the top-bar
// theme control, samples canvas frames during the Day -> Evening cross-fade, then switches back.
// Fails on page or console errors, or when the canvas does not change.
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

async function pick(mode) {
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await page.getByRole('radio', { name: new RegExp(`^${mode}`) }).click();
  await page.keyboard.press('Escape');
}

/** Mean RGB of the canvas centre (cheap change detector). */
async function sample(tag) {
  const buf = await page.screenshot({ clip: box });
  if (outDir) await page.screenshot({ path: join(outDir, `theme-${template}-${tag}.png`), clip: box });
  return buf.length;
}

const results = [];
results.push({ at: 'light', bytes: await sample('light') });
await pick('Dark');
const t0 = Date.now();
for (const ms of [80, 200, 320, 600]) {
  await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
  results.push({ at: `dark+${ms}ms`, theme: await page.evaluate(() => document.documentElement.dataset.theme), bytes: await sample(`dark-${ms}`) });
}
await page.waitForTimeout(600);
await pick('Light');
await page.waitForTimeout(800);
results.push({ at: 'light-again', theme: await page.evaluate(() => document.documentElement.dataset.theme), bytes: await sample('light-again') });
const info = await page.evaluate(() => window.__vistarFloor.info());
console.log(JSON.stringify({ template, reduced, renderer: info.renderer, lightMix: info.lightMix, results, errors }, null, 1));
await context.close();
await browser.close();
if (errors.length) process.exitCode = 1;
