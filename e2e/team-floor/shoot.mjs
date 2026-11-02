#!/usr/bin/env node
// Team Floor screenshot set for the art-target loop (SPEC 12.1 "Verify").
// Usage: node e2e/team-floor/shoot.mjs --base http://localhost:3005 --iter 01 [--theme light] [--only name,name]
// Writes docs/screenshots/team-floor-v3/iter-NN/<shot>.png and shots.json (renderer, label stats).
// Sign-in: mock persona `manager` in localStorage (like scripts/smoke-web.mjs); QA flag on.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasBox, floorPage, launch, openFloor } from './lib.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)]] : acc), []),
);
const base = args.base ?? 'http://localhost:3005';
const iter = String(args.iter ?? '01').padStart(2, '0');
const theme = args.theme ?? 'light';
const out = args.out ?? join(repo, 'docs/screenshots/team-floor-v3', `iter-${iter}`);
const only = args.only ? String(args.only).split(',') : null;
const variant = theme === 'dark' ? 'evening' : 'day';
mkdirSync(out, { recursive: true });

const SHOTS = [
  { name: `medium-${variant}-1440x900@1x`, w: 1440, h: 900, dpr: 1 },
  { name: `medium-${variant}-1440x900@2x`, w: 1440, h: 900, dpr: 2 },
  { name: `medium-${variant}-1920x1080@1x`, w: 1920, h: 1080, dpr: 1 },
  { name: `medium-${variant}-1920x1080@2x`, w: 1920, h: 1080, dpr: 2 },
  // Fuller office (14 people, as in the reference) for the comparison sheet: canvas only.
  { name: `medium-${variant}-populated-1920x1080`, w: 1920, h: 1080, dpr: 1, params: { floorStress: 14 }, canvas: true },
  // Calling room close-up (flies the camera to the room).
  { name: `medium-${variant}-calling-room-zoom`, w: 1440, h: 900, dpr: 2, params: { floorStress: 14 }, canvas: true, room: 'calling', factor: 2.5 },
];

const browser = await launch();
const report = { base, theme, iter, takenAt: new Date().toISOString(), shots: [] };
for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  const { context, page, errors } = await floorPage(browser, base, { width: shot.w, height: shot.h, dpr: shot.dpr, theme });
  try {
    const info = await openFloor(page, base, '/app/team-floor', shot.params ?? {});
    if (shot.room) {
      await page.evaluate(({ room, factor }) => {
        const r = window.__vistarFloor.rooms().find((x) => x.id === room);
        if (r) window.__vistarFloor.focusPoint(r.x, r.z, factor);
      }, shot);
      await page.waitForTimeout(1400);
    }
    const labels = await page.evaluate(() => window.__vistarFloor.labels());
    const overlaps = await page.evaluate(() => window.__vistarFloor.overlaps());
    const file = join(out, `${shot.name}.png`);
    if (shot.canvas) {
      const box = await canvasBox(page);
      await page.screenshot({ path: file, clip: box });
    } else {
      await page.screenshot({ path: file });
      // Canvas crop as well (used by the comparison sheet).
      const box = await canvasBox(page);
      await page.screenshot({ path: join(out, `${shot.name}-canvas.png`), clip: box });
    }
    report.shots.push({
      name: shot.name,
      viewport: `${shot.w}x${shot.h}@${shot.dpr}x`,
      renderer: info.renderer,
      people: info.people,
      office: info.office,
      characters: info.characters,
      labels: labels.length,
      compact: labels.filter((l) => l.mode === 'compact').length,
      leaders: labels.filter((l) => l.leader).length,
      overlaps: overlaps.length,
      errors,
    });
    console.log(`${shot.name}: ${labels.length} labels, ${overlaps.length} overlaps, ${info.people} people, ${info.office}/${info.characters}`);
  } catch (e) {
    console.error(`${shot.name}: FAILED ${e.message}`);
    report.shots.push({ name: shot.name, failed: e.message, errors });
  } finally {
    await context.close();
  }
}
await browser.close();
writeFileSync(join(out, 'shots.json'), JSON.stringify(report, null, 1));
