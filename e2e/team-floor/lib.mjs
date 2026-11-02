// Shared helpers for the Team Floor screenshot, label and FPS scripts (frontend-3d).
// Sign-in uses the mock session in localStorage (works in production builds), like scripts/smoke-web.mjs.
import { chromium } from '@playwright/test';

export const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

export async function launch({ headless = true } = {}) {
  return chromium.launch({ headless, args: GPU_ARGS });
}

/**
 * New context + page, signed in as `persona`, theme cookie set, floor QA flag on
 * (localStorage vistar.floor.qa = 1 enables the window.__vistarFloor hook and ?floor* params).
 */
export async function floorPage(browser, base, { persona = 'manager', theme = 'light', width = 1440, height = 900, dpr = 1, mobile = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, colorScheme: theme, ...(mobile ?? {}) });
  const host = new URL(base).hostname;
  await context.addCookies([
    {
      name: 'vistar_theme',
      value: encodeURIComponent(JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' })),
      domain: host,
      path: '/',
    },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/DevTools|Fast Refresh|favicon/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  await page.goto(`${base}/kit`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((p) => {
    localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: p }));
    localStorage.setItem('vistar.floor.qa', '1');
  }, persona);
  return { context, page, errors };
}

/** Opens a floor route in 3D and waits until the scene reports ready (assets loaded, first frames drawn). */
export async function openFloor(page, base, path = '/app/team-floor', params = {}) {
  const url = new URL(`${base}${path}`);
  url.searchParams.set('floorMode', '3d');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__vistarFloor?.ready?.() === true, null, { timeout: 60_000 });
  // Let walk-ins finish and labels settle.
  await page.waitForTimeout(1200);
  return page.evaluate(() => window.__vistarFloor.info());
}

/** Bounding box of the 3D canvas container. */
export async function canvasBox(page) {
  const el = page.locator('[data-floor-canvas]').first();
  return el.boundingBox();
}

export function overlaps(rects, gap = 0) {
  const out = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap) out.push([a.id, b.id]);
    }
  }
  return out;
}
