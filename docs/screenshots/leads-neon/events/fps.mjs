// Frame times during the celebrations stress case (SPEC 28.1 PERFORMANCE): "Won x5 + 3 moves" on the
// 2,500-lead stress board of /dev/board-physics, 1440x900, DPR 1, intensity Full.
// Usage (worktree root, web app running): node docs/screenshots/leads-neon/events/fps.mjs http://localhost:3004 [--gpu] [--themes=dark,light]
// --gpu launches Chromium with the hardware GPU (ANGLE D3D11) instead of the default headless renderer.
// Prints one JSON line per theme: average and p95 frame time, worst frame, frames, peak particles,
// particle budget, quality tier before and after, and the renderer string. Writes fps.json next to this file.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3004';
const gpu = args.includes('--gpu');
const themes = (args.find((a) => a.startsWith('--themes='))?.split('=')[1] ?? 'dark,light').split(',');
const CAP = 300;

const browser = await chromium.launch(gpu ? { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] } : {});
const results = [];
for (const theme of themes) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
  const { hostname } = new URL(base);
  await context.addCookies([{ name: 'vistar_theme', value: encodeURIComponent(JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' })), domain: hostname, path: '/' }]);
  await context.addInitScript(() => window.localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'company_admin' })));
  const page = await context.newPage();
  await page.goto(`${base}/dev/board-physics?stress`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  // Wait for the stress data (2,500 cards across the columns; long columns virtualise).
  await page.waitForFunction(
    () => [...document.querySelectorAll('section[data-stage-key] [data-count]')].reduce((n, el) => n + Number(el.getAttribute('data-count')), 0) >= 2000,
    null,
    { timeout: 120_000 },
  );
  await page.locator('[data-celebrations]').waitFor({ state: 'attached' });
  await page.waitForTimeout(2500);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  const tierBefore = await page.locator('[data-board-phase]').first().getAttribute('data-quality');
  const setting = await page.locator('[data-celebrations]').getAttribute('data-celebrations');

  // Record every frame (rAF deltas) and the live particle count until the effects are over.
  await page.evaluate((cap) => {
    const el = document.querySelector('[data-celebrations]');
    const w = window;
    w.__fps = { deltas: [], maxParticles: 0, overCap: 0, stop: false };
    let last = 0;
    const tick = (t) => {
      if (last) w.__fps.deltas.push(t - last);
      last = t;
      const p = Number(el.getAttribute('data-active-particles'));
      if (p > w.__fps.maxParticles) w.__fps.maxParticles = p;
      if (p > cap) w.__fps.overCap++;
      if (!w.__fps.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, CAP);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Won x5 + 3 moves (FPS check)' }).click();
  // 1 burst now, 3 queued 2 s apart, 1 skipped: about 8 s of effects.
  await page.waitForFunction(() => Number(document.querySelector('[data-celebrations]')?.getAttribute('data-won-bursts')) >= 1, null, { timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-celebrations]');
      return el?.getAttribute('data-won-queued') === '0' && el?.getAttribute('data-running') === 'false';
    },
    null,
    { timeout: 30_000, polling: 100 },
  );
  const seconds = (Date.now() - t0) / 1000;
  const run = await page.evaluate(() => {
    window.__fps.stop = true;
    const el = document.querySelector('[data-celebrations]');
    return { ...window.__fps, peak: Number(el.getAttribute('data-peak-particles')), bursts: Number(el.getAttribute('data-won-bursts')), skipped: Number(el.getAttribute('data-won-skipped')) };
  });
  const tierAfter = await page.locator('[data-board-phase]').first().getAttribute('data-quality');
  const d = [...run.deltas].sort((a, b) => a - b);
  const avg = d.reduce((n, x) => n + x, 0) / d.length;
  const p95 = d[Math.min(d.length - 1, Math.floor(d.length * 0.95))];
  const r = {
    theme,
    gpu,
    renderer,
    setting,
    seconds: Number(seconds.toFixed(1)),
    frames: d.length,
    avgMs: Number(avg.toFixed(1)),
    fps: Math.round(1000 / avg),
    p95Ms: Number(p95.toFixed(1)),
    worstMs: Number(d.at(-1).toFixed(1)),
    framesOver33ms: d.filter((x) => x > 33.4).length,
    maxParticles: run.maxParticles,
    peakParticles: run.peak,
    overCap: run.overCap,
    cap: CAP,
    bursts: run.bursts,
    skipped: run.skipped,
    tierBefore,
    tierAfter,
  };
  console.info(JSON.stringify(r));
  results.push(r);
  await context.close();
}
await browser.close();
const out = join(here, gpu ? 'fps-gpu.json' : 'fps.json');
writeFileSync(out, `${JSON.stringify({ base, at: new Date().toISOString(), viewport: '1440x900@1x', case: 'Won x5 + 3 moves, 2,500-lead stress board', results }, null, 2)}\n`);
console.info(`wrote ${out}`);
