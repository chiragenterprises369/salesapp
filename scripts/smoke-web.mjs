// Web smoke check for wave reports (orchestrator). Needs a running web app (next start or dev).
// Usage: node scripts/smoke-web.mjs [baseUrl]   (default http://localhost:3000)
// Visits key routes per mock persona in light and dark at desktop and mobile widths, and fails on
// page errors, console errors, failed redirects or blank pages. Screenshots: %TEMP%/vistar-smoke.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3000';
const outDir = join(tmpdir(), 'vistar-smoke');
mkdirSync(outDir, { recursive: true });

/** [persona, path, expected final path prefix] */
const ROUTES = [
  ['company_admin', '/app', '/app'],
  ['company_admin', '/app/leads', '/app/leads'],
  ['company_admin', '/app/leads?view=table', '/app/leads'],
  ['company_admin', '/app/team-floor', '/app/team-floor'],
  ['company_admin', '/app/workflows/indiamart_nurturing', '/app/workflows'],
  ['company_admin', '/app/settings/roles', '/app/settings'],
  ['manager', '/app/leads', '/app/leads'],
  ['viewer', '/app', '/app'],
  ['employee', '/me', '/me'],
  ['employee', '/me/leads', '/me/leads'],
  ['employee', '/app/leads', '/me'], // guard: employee cannot use the company panel
  ['company_admin', '/super-admin', '/app'], // guard: company admin cannot use the Super Admin panel
  ['super_admin', '/super-admin', '/super-admin'],
  [null, '/app', '/login'], // signed out
];

const IGNORED_CONSOLE = [/Download the React DevTools/i, /\[Fast Refresh\]/i, /favicon/i];
const results = [];
const browser = await chromium.launch();

for (const [persona, path, expect] of ROUTES) {
  for (const [theme, width] of [
    ['light', 1440],
    ['dark', 375],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: theme,
    });
    const host = new URL(base).hostname;
    await context.addCookies([
      {
        name: 'vistar_theme',
        value: encodeURIComponent(
          JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' }),
        ),
        domain: host,
        path: '/',
      },
    ]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !IGNORED_CONSOLE.some((r) => r.test(m.text())))
        errors.push(`console: ${m.text().slice(0, 160)}`);
    });
    // Sign in (or out) by writing the mock session (works in production builds; ?mockAs= is dev-only).
    await page.goto(`${base}/kit`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((p) => {
      if (p) localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: p }));
      else localStorage.removeItem('vistar.mock.persona');
    }, persona);
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const finalPath = new URL(page.url()).pathname;
    const textLen = (await page.locator('body').innerText()).trim().length;
    const dataTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    const hScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    const slug = `${persona ?? 'anon'}${path.replace(/[^a-z0-9]+/gi, '-')}-${theme}-${width}`;
    await page.screenshot({ path: join(outDir, `${slug}.png`) });
    const problems = [];
    const onLogin = /\/login$/.test(finalPath);
    if (!finalPath.startsWith(expect) || (onLogin && !expect.endsWith('/login')))
      problems.push(`landed on ${finalPath}, expected ${expect}`);
    if (textLen < 20) problems.push('blank page');
    if (dataTheme !== theme) problems.push(`data-theme=${dataTheme}`);
    if (hScroll && width < 400 && !path.includes('leads'))
      problems.push('horizontal scroll at mobile width');
    problems.push(...errors);
    results.push({
      name: `${persona ?? 'signed-out'} ${path} [${theme} ${width}]`,
      ok: problems.length === 0,
      detail: problems.join(' | '),
    });
    await context.close();
  }
}
await browser.close();

const failed = results.filter((r) => !r.ok);
for (const r of results)
  console.info(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  (${r.detail})`}`);
console.info(
  `\n${results.length - failed.length}/${results.length} web checks passed. Screenshots: ${outDir}`,
);
process.exit(failed.length ? 1 : 0);
