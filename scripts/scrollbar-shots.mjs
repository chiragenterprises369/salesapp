// Screenshots of the themed scrollbars (styles/scrollbar.css) in every theme and interface style.
// Usage: node scripts/scrollbar-shots.mjs [baseUrl] [outDir]
//   default http://localhost:3000 and docs/screenshots/scrollbar
// Signs in with the mock persona (company_admin), sets theme, interface style and board skin through
// the same cookie and localStorage keys the app reads, and saves one full shot plus one 2x crop of the
// scrollbars per case.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? 'docs/screenshots/scrollbar';
mkdirSync(out, { recursive: true });

const ADMIN_ID = '0190f5a0-0000-7000-8000-100000000000';
const CASES = [
  { name: 'classic-light', theme: 'light', style: 'classic' },
  { name: 'classic-dark', theme: 'dark', style: 'classic' },
  { name: 'depth-light', theme: 'light', style: 'depth' },
  { name: 'depth-dark', theme: 'dark', style: 'depth' },
  { name: 'neon-dark', theme: 'dark', style: 'neon' },
  { name: 'aurora-light', theme: 'light', style: 'neon' },
];

// Playwright passes --hide-scrollbars to headless Chromium; drop it so the scrollbars are drawn.
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const results = [];
try {
  for (const c of CASES) {
    for (const page of ['reports', 'board']) {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: c.theme,
      });
      await ctx.addCookies([
        {
          name: 'vistar_theme',
          value: encodeURIComponent(
            JSON.stringify({
              mode: c.theme,
              darkFrom: '19:00',
              darkTo: '07:00',
              tz: 'Asia/Kolkata',
            }),
          ),
          url: base,
        },
      ]);
      await ctx.addInitScript(
        ({ id, style, board }) => {
          localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'company_admin' }));
          localStorage.setItem(
            `vistar.ui.user.${id}`,
            JSON.stringify({ interfaceStyle: style, motionIntensity: 'reduced' }),
          );
          localStorage.setItem('vistar.mock.live', '0');
          if (board) {
            const key = 'vistar.mock.settings.company_admin';
            const cur = JSON.parse(localStorage.getItem(key) ?? '{}');
            localStorage.setItem(
              key,
              JSON.stringify({ ...cur, boardSkin: style === 'neon' ? 'neon' : 'depth' }),
            );
          }
        },
        { id: ADMIN_ID, style: c.style, board: page === 'board' },
      );
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      if (page === 'reports') {
        await p.goto(`${base}/app/reports`, { waitUntil: 'networkidle' });
        await p.waitForTimeout(1500);
        // Pointer inside the main scroll area shows the "near" state.
        await p.mouse.move(900, 500);
      } else {
        await p.goto(`${base}/app/leads`, { waitUntil: 'networkidle' });
        await p
          .locator('section[data-stage-key="new"] li[data-lead-id]')
          .first()
          .waitFor({ timeout: 60_000 });
        await p.waitForTimeout(1500);
        const list = p.locator('section[data-stage-key="contacted"] .vb-list');
        await list.evaluate((el) => (el.scrollTop = 600));
        const box = await list.boundingBox();
        if (box) await p.mouse.move(box.x + box.width / 2, box.y + 200);
      }
      await p.waitForTimeout(400);
      const attrs = await p.evaluate(() => ({
        style: document.documentElement.dataset.interfaceStyle,
        theme: document.documentElement.dataset.theme,
        skin: document.querySelector('[data-board-skin]')?.getAttribute('data-board-skin') ?? null,
      }));
      const file = `${page}-${c.name}`;
      await p.screenshot({ path: join(out, `${file}.png`) });
      // Crop: right edge of the main area (reports) or the right edge of the Contacted column (board).
      const clip =
        page === 'reports'
          ? { x: 1440 - 240, y: 70, width: 240, height: 520 }
          : await p
              .locator('section[data-stage-key="contacted"] .vb-list')
              .boundingBox()
              .then((b) => ({ x: b.x + b.width - 180, y: b.y, width: 200, height: 420 }));
      await p.screenshot({ path: join(out, `${file}-crop.png`), clip });
      results.push({ case: file, ...attrs, errors });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(results, null, 1));
