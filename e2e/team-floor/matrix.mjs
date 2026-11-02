#!/usr/bin/env node
// Team Floor V3 screenshot matrix (SPEC 12.1 "Verify"): Medium at 1440x900 and 1920x1080, DPR 1 and 2,
// Light (Day) and Dark (Evening); calling-room zooms; mobile Flat (Pixel 7); Small and Large at
// 1440x900; Flat plans for every template. Writes PNGs plus shots.json (renderer, people, label
// counts, overlaps, console errors) into docs/screenshots/team-floor-v3/iter-NN/ (git-ignored).
// Usage: node e2e/team-floor/matrix.mjs --base http://localhost:3005 --iter 05 [--only a,b] [--group medium|small|large|flat]
import { devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasBox, floorPage, launch, openFloor } from './lib.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)]] : acc), []),
);
const base = args.base ?? 'http://localhost:3005';
const iter = String(args.iter ?? '05').padStart(2, '0');
const out = args.out ?? join(repo, 'docs/screenshots/team-floor-v3', `iter-${iter}`);
const only = args.only ? String(args.only).split(',') : null;
const group = args.group ?? null;
mkdirSync(out, { recursive: true });

const VARIANT = { light: 'day', dark: 'evening' };
const MEDIUM = { floorTemplate: 'medium', floorStress: 14 };
const SHOTS = [];
for (const theme of ['light', 'dark']) {
  const v = VARIANT[theme];
  for (const [w, h] of [
    [1440, 900],
    [1920, 1080],
  ]) {
    for (const dpr of [1, 2]) SHOTS.push({ group: 'medium', name: `medium-${v}-${w}x${h}@${dpr}x`, theme, w, h, dpr, params: MEDIUM, canvasToo: dpr === 1 });
  }
  SHOTS.push({ group: 'medium', name: `medium-${v}-calling-room-zoom`, theme, w: 1440, h: 900, dpr: 2, params: MEDIUM, canvas: true, room: 'calling', factor: 2.5 });
  SHOTS.push({ group: 'flat', name: `mobile-flat-${v}`, theme, mobile: true, params: { ...MEDIUM, floorMode: 'flat' }, flat: true, fullPage: true });
  SHOTS.push({ group: 'small', name: `small-${v}-1440x900@1x`, theme, w: 1440, h: 900, dpr: 1, params: { floorTemplate: 'small' }, canvasToo: true });
  SHOTS.push({ group: 'large', name: `large-${v}-1440x900@1x`, theme, w: 1440, h: 900, dpr: 1, params: { floorTemplate: 'large', floorStress: 36 }, canvasToo: true });
  for (const [tpl, stress] of [
    ['small', 0],
    ['medium', 14],
    ['large', 36],
  ]) {
    SHOTS.push({ group: 'flat', name: `flat-${tpl}-${v}-1440x900`, theme, w: 1440, h: 900, dpr: 1, params: { floorTemplate: tpl, floorMode: 'flat', ...(stress ? { floorStress: stress } : {}) }, flat: true });
  }
}

const browser = await launch();
const report = { base, iter, takenAt: new Date().toISOString(), shots: [] };
for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  if (group && shot.group !== group) continue;
  const viewport = shot.mobile ? devices['Pixel 7'] : null;
  const { context, page, errors } = await floorPage(browser, base, {
    width: viewport?.viewport.width ?? shot.w,
    height: viewport?.viewport.height ?? shot.h,
    dpr: viewport?.deviceScaleFactor ?? shot.dpr,
    theme: shot.theme,
    mobile: viewport ? { isMobile: true, hasTouch: true, userAgent: viewport.userAgent } : null,
  });
  try {
    const file = join(out, `${shot.name}.png`);
    const entry = { name: shot.name, theme: shot.theme, viewport: viewport ? `Pixel 7 ${viewport.viewport.width}x${viewport.viewport.height}@${viewport.deviceScaleFactor}x` : `${shot.w}x${shot.h}@${shot.dpr}x`, errors };
    if (shot.flat) {
      const url = new URL(`${base}/app/team-floor`);
      for (const [k, v] of Object.entries(shot.params)) url.searchParams.set(k, String(v));
      await page.goto(url.toString(), { waitUntil: 'networkidle' });
      await page.locator('[data-floor-map]').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      const flat = await page.evaluate(() => {
        const svg = document.querySelector('[data-floor-map]');
        return { template: svg?.getAttribute('data-floor-map'), people: Number(svg?.getAttribute('data-people') ?? 0), buttons: document.querySelectorAll('[id*="-emp-"]').length };
      });
      Object.assign(entry, flat);
      await page.screenshot({ path: file, fullPage: !!shot.fullPage });
      console.log(`${shot.name}: flat ${flat.template}, ${flat.people} people, ${flat.buttons} list buttons, ${errors.length} errors`);
    } else {
      const info = await openFloor(page, base, '/app/team-floor', shot.params);
      if (shot.room) {
        await page.evaluate(({ room, factor }) => {
          const r = window.__vistarFloor.rooms().find((x) => x.id === room);
          if (r) window.__vistarFloor.focusPoint(r.x, r.z, factor);
        }, shot);
        await page.waitForTimeout(1400);
      }
      const labels = await page.evaluate(() => window.__vistarFloor.labels());
      const overlaps = await page.evaluate(() => window.__vistarFloor.overlaps());
      const box = await canvasBox(page);
      if (shot.canvas) await page.screenshot({ path: file, clip: box });
      else {
        await page.screenshot({ path: file });
        if (shot.canvasToo) await page.screenshot({ path: join(out, `${shot.name}-canvas.png`), clip: box });
      }
      Object.assign(entry, {
        renderer: info.renderer,
        template: info.template,
        people: info.people,
        office: info.office,
        characters: info.characters,
        lightMix: await page.evaluate(() => window.__vistarFloor.lightMix()),
        labels: labels.length,
        compact: labels.filter((l) => l.mode === 'compact').length,
        leaders: labels.filter((l) => l.leader).length,
        overlaps: overlaps.length,
      });
      console.log(`${shot.name}: ${info.template}, ${info.people} people, ${labels.length} labels (${entry.compact} compact), ${overlaps.length} overlaps, mix ${entry.lightMix}, ${errors.length} errors`);
    }
    report.shots.push(entry);
  } catch (e) {
    console.error(`${shot.name}: FAILED ${e.message}`);
    report.shots.push({ name: shot.name, failed: e.message, errors });
  } finally {
    await context.close();
  }
}
await browser.close();
writeFileSync(join(out, `shots${group ? `-${group}` : ''}.json`), JSON.stringify(report, null, 1));
