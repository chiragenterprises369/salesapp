#!/usr/bin/env node
// Screenshots of a PUBLISHED custom floor (layout_json, module kit) in Day and Evening, 3D and flat.
// API mode: signs in as the company admin through /login, so the floor comes from GET /team-floor/layout.
// Usage: node e2e/team-floor/published-shots.mjs --base http://localhost:3005 [--email anil@shakti.example] [--out docs/screenshots/team-floor-custom]
// QA mode without the API (web built with NEXT_PUBLIC_ALLOW_MOCK_DATA=1): add --qa to load the sample plan
// with ?floorPlan=/team-floor/samples/sample-office.json and a mock manager persona.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasBox, launch } from './lib.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)]] : acc), []),
);
const base = args.base ?? 'http://localhost:3005';
const email = args.email ?? 'anil@shakti.example';
const password = process.env.SMOKE_PASSWORD ?? 'vistar-demo-123';
const qa = !!args.qa;
const out = resolve(repo, args.out ?? 'docs/screenshots/team-floor-custom');
mkdirSync(out, { recursive: true });

const browser = await launch();
const report = { base, qa, takenAt: new Date().toISOString(), shots: [] };
for (const theme of ['light', 'dark']) {
  const variant = theme === 'dark' ? 'evening' : 'day';
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
  await context.addCookies([
    { name: 'vistar_theme', value: encodeURIComponent(JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' })), domain: new URL(base).hostname, path: '/' },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/DevTools|favicon/i.test(m.text()) && errors.push(`console: ${m.text().slice(0, 200)}`));
  try {
    if (qa) {
      await page.goto(`${base}/kit`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        localStorage.setItem('vistar.dataSource', 'mock');
        localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'manager' }));
        localStorage.setItem('vistar.floor.qa', '1');
      });
    } else {
      await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.locator('form button[type="submit"]').click();
      await page.waitForURL((u) => !u.pathname.startsWith('/login'));
      await page.evaluate(() => localStorage.setItem('vistar.floor.qa', '1'));
    }
    const plan = qa ? '&floorPlan=/team-floor/samples/sample-office.json' : '';
    await page.goto(`${base}/app/team-floor?floorMode=3d${plan}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__vistarFloor?.ready?.() === true, null, { timeout: 90_000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => window.__vistarFloor.info());
    if (info.office !== 'kit' && info.office !== 'model') throw new Error(`expected a custom office, got "${info.office}" (is a floor published and does the Team Floor page use loadWorkspaceFloor?)`);
    const page3d = join(out, `custom-${variant}-1440x900.png`);
    await page.screenshot({ path: page3d });
    const box = await canvasBox(page);
    await page.screenshot({ path: join(out, `custom-${variant}-canvas.png`), clip: box });
    await page.goto(`${base}/app/team-floor?floorMode=flat${plan}`, { waitUntil: 'networkidle' });
    await page.locator('[data-floor-map]').waitFor();
    await page.screenshot({ path: join(out, `custom-${variant}-flat.png`), fullPage: true });
    const zones = await page.locator('[data-floor-map] [data-zone]').count();
    report.shots.push({ variant, renderer: info.renderer, office: info.office, people: info.people, lightMix: info.lightMix, zones, errors });
    console.log(`${variant}: office=${info.office} people=${info.people} lightMix=${info.lightMix} zones=${zones} errors=${errors.length}`);
  } catch (e) {
    console.error(`${variant}: FAILED ${e.message}`);
    report.shots.push({ variant, failed: e.message, errors });
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}
await browser.close();
writeFileSync(join(out, 'shots.json'), JSON.stringify(report, null, 2));
console.log(`wrote ${out}`);
