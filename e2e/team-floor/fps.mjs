#!/usr/bin/env node
// FPS sample (SPEC 12.1 item 8): stress floor with N people at 1440x900, DPR 1, continuous rendering.
// Usage: node e2e/team-floor/fps.mjs [base] [people=30] [seconds=10]
import { floorPage, launch, openFloor } from './lib.mjs';

const [base = 'http://localhost:3005', people = '30', seconds = '10'] = process.argv.slice(2);
const browser = await launch();
const { page, errors } = await floorPage(browser, base, { width: 1440, height: 900, dpr: 1 });
const info = await openFloor(page, base, '/app/team-floor', { floorStress: people });
await page.waitForTimeout(3000);
const result = await page.evaluate((ms) => window.__vistarFloor.benchmark(ms), Number(seconds) * 1000);
const after = await page.evaluate(() => window.__vistarFloor.info());
console.log(JSON.stringify({ renderer: info.renderer, people: info.people, tier: after.tier, pixelRatio: after.pixelRatio, canvas: after.canvas, drawCalls: after.drawCalls, triangles: after.triangles, characters: after.characters, ...result, errors }, null, 1));
await browser.close();
