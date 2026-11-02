// Frame times while dragging a card on the Leads Board "Neon Space" skin (SPEC 28.1), Neon/Dark at
// 1440x900, DPR 1. Records every requestAnimationFrame interval in the page: 3 s idle (pulses and grid
// drift running), then a card lifted from New and swept back and forth over New, Contacted and
// Interested for `seconds` (no edge auto-scroll), then the drop. Reports average and p95 frame time
// and the board's adaptive state (quality tier, skin performance level, glow) before and after.
//
// Usage (worktree root, production server on 3003): node docs/screenshots/leads-neon/fps.mjs [seconds=10] [out.json]
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { openBoard, prepareContext } from './capture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const seconds = Number(process.argv[2] ?? 10);
const outFile = resolve(process.argv[3] ?? join(here, 'fps.json'));

const stats = (frames) => {
  const s = [...frames].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const avg = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  const r = (v) => Math.round(v * 100) / 100;
  return {
    frames: s.length,
    avgMs: r(avg),
    fps: r(1000 / avg),
    p50Ms: r(at(0.5)),
    p95Ms: r(at(0.95)),
    p99Ms: r(at(0.99)),
    maxMs: r(s[s.length - 1] ?? 0),
    over20msPct: r((100 * s.filter((v) => v > 20).length) / Math.max(1, s.length)),
  };
};

const boardState = (page) =>
  page.evaluate(() => {
    const r = document.querySelector('[data-board-phase]');
    const a = (n) => r?.getAttribute(n) ?? null;
    return { skin: a('data-board-skin'), variant: a('data-board-variant'), glow: a('data-board-glow'), quality: a('data-quality'), perfLevel: a('data-board-perf'), fallback: a('data-board-skin-fallback'), motion: a('data-motion') };
  });

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
let report;
try {
  const ctx = await prepareContext(browser, { theme: 'dark', width: 1440, height: 900, dpr: 1 });
  const page = await ctx.newPage();
  await openBoard(page);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  });
  const before = await boardState(page);

  // Frame recorder: rAF intervals into window.__ft while window.__rec is set.
  await page.evaluate(() => {
    const w = window;
    w.__ft = [];
    w.__rec = false;
    let last = 0;
    const tick = (t) => {
      if (w.__rec && last) w.__ft.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const record = async (fn) => {
    await page.evaluate(() => {
      window.__ft = [];
      window.__rec = true;
    });
    await fn();
    return page.evaluate(() => {
      window.__rec = false;
      return window.__ft;
    });
  };

  const idle = await record(() => page.waitForTimeout(3_000));

  // Lift the first card in New (past the 4 px threshold), then sweep.
  const face = page.locator('section[data-stage-key="new"] li[data-lead-id]').first().locator('[aria-roledescription="draggable card"]');
  const box = await face.boundingBox();
  if (!box) throw new Error('no card in New');
  const start = { x: box.x + Math.min(60, box.width / 3), y: box.y + 14 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 6, { steps: 3 });
  await page.locator('[data-drag-ghost]').waitFor({ timeout: 10_000 });
  const cols = await page.evaluate(() =>
    ['new', 'contacted', 'interested'].map((k) => {
      const r = document.querySelector(`section[data-stage-key="${k}"]`).getBoundingClientRect();
      return { x: r.left + r.width / 2, top: r.top, bottom: r.bottom };
    }),
  );
  const x0 = cols[0].x;
  const x1 = cols[2].x;
  const yMid = (cols[0].top + cols[0].bottom) / 2;
  const yAmp = Math.min(160, (cols[0].bottom - cols[0].top) / 2 - 140);
  let moves = 0;
  const drag = await record(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) {
      const t = (Date.now() - t0) / 1000;
      // About one sweep New -> Interested -> New every 3 s, with a slow vertical wave.
      const u = (1 - Math.cos((2 * Math.PI * t) / 3)) / 2;
      await page.mouse.move(x0 + (x1 - x0) * u, yMid + yAmp * Math.sin((2 * Math.PI * t) / 2.2));
      moves++;
    }
  });
  const during = await boardState(page);
  const drop = await record(async () => {
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('[data-board-phase]')?.getAttribute('data-board-phase') === 'idle', null, { timeout: 10_000 });
    await page.waitForTimeout(500);
  });
  const after = await boardState(page);

  report = {
    generatedAt: new Date().toISOString(),
    view: 'Neon Space / Dark, 1440x900 @1x, /app/leads (mock data, 240 leads), headless Chromium',
    gpu,
    method: `requestAnimationFrame intervals in the page. Idle 3 s; drag ${seconds} s: card lifted from New, pointer swept between the New and Interested column centres (${moves} pointer moves, no edge auto-scroll); drop until the board is idle + 0.5 s.`,
    idle: stats(idle),
    drag: stats(drag),
    drop: stats(drop),
    board: { before, during, after },
  };
  console.info(JSON.stringify({ idle: report.idle, drag: report.drag, drop: report.drop, board: report.board, gpu }, null, 1));
  await ctx.close();
} finally {
  await browser.close();
}
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.info(outFile);
