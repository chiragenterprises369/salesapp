// Screenshot a page in light and dark at desktop and mobile widths (for agent self-review).
// Usage (from a worktree root): node scripts/screenshot.mjs http://localhost:3001/app/leads [outDir] [--persona=manager]
// Writes <outDir>/<slug>-<theme>-<width>.png (default outDir: %TEMP%/vistar-shots).
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const [, , url, outArg, ...rest] = process.argv;
if (!url) {
  console.error('Usage: node scripts/screenshot.mjs <url> [outDir] [--persona=<persona>]');
  process.exit(1);
}
const persona = rest.find((a) => a.startsWith('--persona='))?.split('=')[1];
const outDir = outArg && !outArg.startsWith('--') ? outArg : join(tmpdir(), 'vistar-shots');
mkdirSync(outDir, { recursive: true });
const slug = new URL(url).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: width > 400 ? 900 : 812 }, colorScheme: theme });
    // Theme mode cookie so the boot script resolves the theme before first paint.
    const { hostname } = new URL(url);
    await context.addCookies([{ name: 'vistar_theme', value: encodeURIComponent(JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' })), domain: hostname, path: '/' }]);
    const page = await context.newPage();
    const target = persona ? `${url}${url.includes('?') ? '&' : '?'}mockAs=${persona}` : url;
    await page.goto(target, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const file = join(outDir, `${slug}-${theme}-${width}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.info(file);
    await context.close();
  }
}
await browser.close();
