// Screenshots of the data pages (frontend-app pages): 1440x900 light and dark plus Pixel 7, and a
// Depth / Neon Space check of two pages. Needs a running production server.
// Usage: node e2e/pages/shoot.mjs http://localhost:3002   -> docs/screenshots/pages/*.png
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3002';
const out = join(process.cwd(), 'docs', 'screenshots', 'pages');
mkdirSync(out, { recursive: true });

const PAGES = [
  ['tasks', 'company_admin', '/app/tasks', '[data-task-row]'],
  ['calls', 'company_admin', '/app/calls', '[data-call-row]'],
  ['inbox', 'company_admin', '/app/inbox', '[data-conversation]'],
  ['team', 'company_admin', '/app/team', '[data-member-card]'],
  ['targets', 'company_admin', '/app/targets', '[data-target-subject]'],
  ['reports', 'company_admin', '/app/reports', '[data-rep-row]'],
  ['me-inbox', 'employee', '/me/inbox', '[data-conversation]'],
];
const STYLE_CHECKS = [
  ['reports', 'neon', 'dark'],
  ['inbox', 'neon', 'dark'],
  ['reports', 'depth', 'light'],
  ['team', 'depth', 'dark'],
];

const browser = await chromium.launch();
const host = new URL(base).hostname;
const shots = [];

async function shoot(name, persona, path, selector, { theme, device, style }) {
  const ctxOpts = device === 'mobile' ? { ...devices['Pixel 7'] } : { viewport: { width: 1440, height: 900 } };
  const context = await browser.newContext({ ...ctxOpts, colorScheme: theme });
  const cookies = [
    { name: 'vistar_theme', value: encodeURIComponent(JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' })), domain: host, path: '/' },
  ];
  if (style) cookies.push({ name: 'vistar_ui', value: encodeURIComponent(JSON.stringify({ s: style, d: 'classic', m: 'reduced', rm: 'system' })), domain: host, path: '/' });
  await context.addCookies(cookies);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    ([p, s]) => {
      localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: p }));
      if (s) localStorage.setItem(`vistar.mock.settings.${p}`, JSON.stringify({ interfaceStyle: s, motionIntensity: 'reduced' }));
      else localStorage.removeItem(`vistar.mock.settings.${p}`);
    },
    [persona, style ?? null],
  );
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(900);
  const file = `${name}-${style ? `${style}-` : ''}${theme}-${device === 'mobile' ? 'pixel7' : '1440'}.png`;
  await page.screenshot({ path: join(out, file) });
  const attr = await page.evaluate(() => document.documentElement.getAttribute('data-interface-style'));
  shots.push(`${file}${style ? ` (interface ${attr})` : ''}${errors.length ? ` ERRORS: ${errors.join(' | ')}` : ''}`);
  await context.close();
}

for (const [name, persona, path, sel] of PAGES) {
  await shoot(name, persona, path, sel, { theme: 'light', device: 'desktop' });
  await shoot(name, persona, path, sel, { theme: 'dark', device: 'desktop' });
  await shoot(name, persona, path, sel, { theme: 'light', device: 'mobile' });
}
for (const [name, style, theme] of STYLE_CHECKS) {
  const [, persona, path, sel] = PAGES.find((p) => p[0] === name);
  await shoot(name, persona, path, sel, { theme, device: 'desktop', style });
}
await browser.close();
console.info(shots.join('\n'));
console.info(`\n${shots.length} screenshots in ${out}`);
