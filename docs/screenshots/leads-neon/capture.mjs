// Leads Board "Neon Space" screenshots (SPEC 28.1): Neon in Dark and Aurora in Light, at 1440x900 and
// 1920x1080, DPR 1 and 2, with the 28.2 Neon Space interface style around the board.
// Usage (worktree root, server on 3003): node docs/screenshots/leads-neon/capture.mjs [outDir] [--only=dark-1440-1]
// Writes <outDir>/leads-<variant>-<theme>-<w>x<h>@<dpr>x.png (default outDir: this folder).
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? here);
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const base = process.env.BOARD_BASE_URL ?? 'http://localhost:3003';
const persona = 'company_admin';
mkdirSync(outDir, { recursive: true });

/** Sign in, pick the board skin and the app interface style before any page script runs. */
export async function prepareContext(browser, { theme, width, height, dpr, skin = 'neon', style = 'neon' }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, colorScheme: theme, reducedMotion: 'no-preference' });
  await ctx.addCookies([
    { name: 'vistar_theme', value: encodeURIComponent(JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' })), domain: new URL(base).hostname, path: '/' },
  ]);
  await ctx.addInitScript(
    ({ persona, skin, style }) => {
      localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona }));
      const key = `vistar.mock.settings.${persona}`;
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(key, JSON.stringify({ ...saved, boardSkin: skin }));
      // 28.2 interface style adapter (per user id, unknown here): answer every user key.
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) {
        if (typeof k === 'string' && k.startsWith('vistar.ui.user.')) return JSON.stringify({ interfaceStyle: style, motionIntensity: 'full' });
        return get.call(this, k);
      };
    },
    { persona, skin, style },
  );
  return ctx;
}

/** Open /app/leads and wait until the board settled and the backdrop plate has loaded. */
export async function openBoard(page) {
  await page.goto(`${base}/app/leads`, { waitUntil: 'domcontentloaded' });
  await page.locator('section[data-stage-key="new"] li[data-lead-id]').first().waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => document.querySelector('[data-board-phase]')?.getAttribute('data-board-phase') === 'idle');
  await page
    .waitForFunction(() => {
      const img = document.querySelector('.vn-backdrop__plate');
      return !img || img.hasAttribute('data-ready');
    }, null, { timeout: 15_000 })
    .catch(() => undefined);
  // Entrance and plate fade done; pulses keep running (they are part of the look).
  await page.waitForTimeout(1_200);
  await page.mouse.move(2, 2);
}

const SHOTS = [];
for (const [theme, variant] of [
  ['dark', 'neon'],
  ['light', 'aurora'],
])
  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
  ])
    for (const dpr of [1, 2]) SHOTS.push({ theme, variant, width, height, dpr });

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    for (const s of SHOTS) {
      if (only && only !== `${s.theme}-${s.width}-${s.dpr}`) continue;
      const ctx = await prepareContext(browser, s);
      const page = await ctx.newPage();
      await openBoard(page);
      // The dev-mode build indicator is not part of the product.
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      const attrs = await page.evaluate(() => {
        const r = document.querySelector('[data-board-phase]');
        return `${r?.getAttribute('data-board-skin')}/${r?.getAttribute('data-board-variant')}/glow-${r?.getAttribute('data-board-glow')}/${r?.getAttribute('data-quality')}`;
      });
      const file = join(outDir, `leads-${s.variant}-${s.theme}-${s.width}x${s.height}@${s.dpr}x.png`);
      await page.screenshot({ path: file });
      console.info(`${file} (${attrs})`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}
