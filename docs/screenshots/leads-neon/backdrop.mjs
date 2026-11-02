// Leads Board "Neon Space" backdrop (SPEC 28.1): a dimmed, blurred office plate, pre-rendered once.
// Captures the Live Team Floor 3D scene (Evening for dark, Day for light) from a running web server,
// hides every HTML overlay so only the WebGL canvas shows, then blurs, dims and encodes WebP at
// 1920 and 960 px wide into apps/web/public/leads-neon/. Never a video; about 150 KB or less each.
//
// Usage (worktree root, server running): node docs/screenshots/leads-neon/backdrop.mjs http://localhost:3003
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:3003';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = join(root, 'apps/web/public/leads-neon');
mkdirSync(out, { recursive: true });

// sharp ships with Next.js (image optimisation); resolve it through next so no new dependency is needed.
const webRequire = createRequire(join(root, 'apps/web/package.json'));
const sharp = createRequire(webRequire.resolve('next/package.json'))('sharp');

/** How each theme's plate is treated. Dark: dim and slightly cool; light: lifted and desaturated. */
const LOOK = {
  dark: { blur: 14, brightness: 0.6, saturation: 0.9, tint: { r: 6, g: 10, b: 30, alpha: 0.2 } },
  light: { blur: 14, brightness: 1.06, saturation: 0.7, tint: { r: 255, g: 255, b: 255, alpha: 0.22 } },
};

async function capture(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5, colorScheme: theme, reducedMotion: 'no-preference' });
  await ctx.addCookies([
    { name: 'vistar_theme', value: encodeURIComponent(JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' })), domain: new URL(base).hostname, path: '/' },
  ]);
  await ctx.addInitScript(() => window.localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'company_admin' })));
  const page = await ctx.newPage();
  await page.goto(`${base}/app/team-floor`, { waitUntil: 'domcontentloaded' });
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ timeout: 120_000 });
  await page.waitForTimeout(12_000);
  // Closer than "Fit": the office should fill the plate, like a room seen through glass.
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(1_500);
  }
  await page.addStyleTag({ content: 'body *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  await page.waitForTimeout(1_000);
  const png = await canvas.screenshot({ type: 'png' });
  await ctx.close();
  return png;
}

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  for (const theme of ['dark', 'light']) {
    const png = await capture(browser, theme);
    const look = LOOK[theme];
    const plate = await sharp(png)
      .resize(1920, 1080, { fit: 'cover', position: 'centre' })
      .blur(look.blur)
      .modulate({ brightness: look.brightness, saturation: look.saturation })
      .composite([{ input: { create: { width: 1920, height: 1080, channels: 4, background: look.tint } }, blend: 'over' }])
      .png()
      .toBuffer();
    for (const width of [1920, 960]) {
      const file = join(out, `office-${theme}-${width}.webp`);
      await sharp(plate)
        .resize(width, Math.round((width * 9) / 16))
        .webp({ quality: width === 1920 ? 50 : 58, effort: 6, smartSubsample: true })
        .toFile(file);
      console.info(`${file} ${(statSync(file).size / 1024).toFixed(1)} KB`);
    }
  }
} finally {
  await browser.close();
}
