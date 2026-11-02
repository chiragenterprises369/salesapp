// Space Shell (SPEC 28.2) screenshots, axe and backdrop contrast audit, FPS and page-transition checks.
// Needs a running build (next start). Usage (worktree root):
//   node docs/screenshots/space-shell/capture.mjs http://localhost:3001 [outDir]
// Writes <outDir>/<page>-<style>-<theme>-<desktop|mobile>.png and <outDir>/results.json.
// The device is pinned to a capable laptop (8 cores, 8 GB) so Depth and Neon are not auto-downgraded;
// at 375 px every style falls back to Classic by design (D-052).
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { palettes } from '../../../packages/shared/dist/design/tokens.js';
import { EMPLOYEE_FIXTURES, MOCK_WORKSPACE_ID, mockUsers } from '../../../packages/shared/dist/fixtures/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] ?? 'http://localhost:3001';
const outDir = process.argv[3] ?? here;
mkdirSync(outDir, { recursive: true });

const PAGES = ['/app', '/app/leads', '/app/settings'];
const STYLES = ['classic', 'depth', 'neon'];
const THEMES = ['light', 'dark'];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
];
const adminId = mockUsers()[EMPLOYEE_FIXTURES.findIndex((e) => e.key === 'admin')].id;
const IGNORED_CONSOLE = [/Download the React DevTools/i, /favicon/i];

const slug = (p) => p.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') || 'home';

async function newContext(browser, { style, theme, viewport, motion = 'full' }) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: theme });
  const { hostname } = new URL(base);
  const cookie = (name, value) => ({ name, value: encodeURIComponent(JSON.stringify(value)), domain: hostname, path: '/' });
  await context.addCookies([
    cookie('vistar_theme', { mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' }),
    cookie('vistar_ui', { s: style, d: 'classic', m: motion, rm: 'system' }),
  ]);
  await context.addInitScript(
    ({ id, ws, style, motion }) => {
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8 });
      localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'company_admin' }));
      localStorage.setItem(`vistar.ui.user.${id}`, JSON.stringify({ interfaceStyle: style, motionIntensity: motion }));
      localStorage.setItem(`vistar.ui.workspace.${ws}`, JSON.stringify({ defaultInterfaceStyle: 'classic' }));
      // Count View Transitions started by React.
      const start = document.startViewTransition?.bind(document);
      if (start)
        document.startViewTransition = (...args) => {
          window.__vt = (window.__vt ?? 0) + 1;
          return start(...args);
        };
    },
    { id: adminId, ws: MOCK_WORKSPACE_ID, style, motion },
  );
  return context;
}

// --- contrast helpers (WCAG relative luminance) ---
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Backdrop contrast inside the main area with the page content hidden. Reports the background field
 * (99.5th percentile: darkest pixel in light, lightest in dark, particles hidden) and the extreme pixel
 * with particles (1-3 px dots) for reference.
 */
async function backdropExtreme(page, theme) {
  const measure = async (hideParticles) => {
    await page.evaluate((hide) => {
      document.getElementById('main').style.visibility = 'hidden';
      const c = document.querySelector('.vs-backdrop__particles');
      if (c) c.style.visibility = hide ? 'hidden' : '';
    }, hideParticles);
    const box = await page.locator('#main').boundingBox();
    const png = await page.screenshot({ clip: box });
    await page.evaluate(() => {
      document.getElementById('main').style.visibility = '';
      const c = document.querySelector('.vs-backdrop__particles');
      if (c) c.style.visibility = '';
    });
    return page.evaluate(
      async ({ b64, light }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        const bins = new Uint32Array(10001);
        let extreme = light ? 1 : 0;
        for (let i = 0; i < d.length; i += 4) {
          const L = 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]);
          bins[Math.round(L * 10000)]++;
          extreme = light ? Math.min(extreme, L) : Math.max(extreme, L);
        }
        const total = d.length / 4;
        const cut = total * 0.005;
        let acc = 0;
        let pct = 0;
        if (light) {
          for (let b = 0; b <= 10000; b++) if ((acc += bins[b]) > cut) { pct = b / 10000; break; }
        } else {
          for (let b = 10000; b >= 0; b--) if ((acc += bins[b]) > cut) { pct = b / 10000; break; }
        }
        return { pct, extreme };
      },
      { b64: png.toString('base64'), light: theme === 'light' },
    );
  };
  const field = await measure(true);
  const withParticles = await measure(false);
  const out = { fieldL: Number(field.pct.toFixed(4)), extremeL: Number(field.extreme.toFixed(4)), particleExtremeL: Number(withParticles.extreme.toFixed(4)) };
  for (const t of ['fg', 'fg-secondary', 'muted-strong', 'accent-text']) {
    out[t] = Number(ratio(lum(hex(palettes[theme][t])), field.pct).toFixed(2));
    out[`${t}@extreme`] = Number(ratio(lum(hex(palettes[theme][t])), field.extreme).toFixed(2));
  }
  return out;
}

async function measureFps(page, ms = 3000) {
  return page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        let frames = 0;
        const t0 = performance.now();
        const tick = (t) => {
          frames++;
          if (t - t0 < ms) requestAnimationFrame(tick);
          else resolve(Math.round((frames * 1000) / (t - t0)));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

const browser = await chromium.launch();
const results = { base, shots: [], axe: [], contrast: [], fps: [], transitions: [], errors: [] };
const transitionsOnly = process.argv.includes('--transitions-only');

for (const theme of transitionsOnly ? [] : THEMES) {
  for (const viewport of VIEWPORTS) {
    for (const style of STYLES) {
      const context = await newContext(browser, { style, theme, viewport });
      const page = await context.newPage();
      page.on('pageerror', (e) => results.errors.push(`${style}/${theme}/${viewport.name}: pageerror ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !IGNORED_CONSOLE.some((r) => r.test(m.text()))) results.errors.push(`${style}/${theme}/${viewport.name}: console ${m.text().slice(0, 200)}`);
      });
      for (const path of PAGES) {
        await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1200);
        const attrs = await page.evaluate(() => ({
          style: document.documentElement.getAttribute('data-interface-style'),
          motion: document.documentElement.getAttribute('data-motion'),
          theme: document.documentElement.getAttribute('data-theme'),
          particles: !!document.querySelector('.vs-backdrop__particles[data-ready]'),
          hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        }));
        const file = `${slug(path)}-${style}-${theme}-${viewport.name}.png`;
        await page.screenshot({ path: join(outDir, file) });
        results.shots.push({ file, requested: style, ...attrs });

        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        results.axe.push({
          page: path,
          style,
          theme,
          viewport: viewport.name,
          serious: serious.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target?.join(' ')}`),
          minor: axe.violations.filter((v) => !serious.includes(v)).map((v) => `${v.impact} ${v.id} (${v.nodes.length})`),
          contrastIncomplete: axe.incomplete.find((v) => v.id === 'color-contrast')?.nodes.length ?? 0,
        });

        if (style !== 'classic' && viewport.name === 'desktop') results.contrast.push({ page: path, style, theme, ...(await backdropExtreme(page, theme)) });
        if (viewport.name === 'desktop' && path === '/app') results.fps.push({ style, theme, fps: await measureFps(page) });
      }
      await context.close();
    }
  }
}

// Page transitions: click a sidebar link in each motion intensity (Depth, dark, desktop). While the
// view transition runs, check that a point on the page hit-tests to a real element (input is not blocked).
for (const motion of ['full', 'reduced', 'off']) {
  const context = await newContext(browser, { style: 'depth', theme: 'dark', viewport: VIEWPORTS[0], motion });
  const page = await context.newPage();
  await page.goto(`${base}/app`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const t0 = Date.now();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Leads', exact: true }).click();
  const running = await page
    .waitForFunction(() => document.getAnimations().some((a) => a.effect?.pseudoElement?.startsWith('::view-transition') && a.playState === 'running' && (a.currentTime ?? 0) > 40), null, { timeout: 1500, polling: 'raf' })
    .then(() => true)
    .catch(() => false);
  const mid = await page.evaluate(() => {
    const anims = document.getAnimations().filter((a) => a.effect?.pseudoElement?.startsWith('::view-transition'));
    const hit = document.elementFromPoint(window.innerWidth / 2, 300);
    return { vtAnimations: anims.map((a) => `${a.effect.pseudoElement} ${a.animationName ?? ''} ${Math.round(a.currentTime ?? 0)}ms`), hitIsRoot: hit === document.documentElement, hit: hit?.tagName, vtCount: window.__vt ?? 0 };
  });
  if (running) await page.screenshot({ path: join(outDir, `transition-depth-dark-${motion}-mid.png`) });
  await page.waitForURL('**/app/leads');
  await page.waitForTimeout(400);
  results.transitions.push({ motion, running, ...mid, vtCountAfter: await page.evaluate(() => window.__vt ?? 0), msToUrl: Date.now() - t0 });
  await context.close();
}

await browser.close();
writeFileSync(join(outDir, transitionsOnly ? 'results-transitions.json' : 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

const seriousTotal = results.axe.reduce((n, a) => n + a.serious.length, 0);
console.info(`shots: ${results.shots.length}, errors: ${results.errors.length}, axe serious/critical: ${seriousTotal}`);
for (const c of results.contrast)
  console.info(
    `contrast ${c.style}/${c.theme} ${c.page}: field L=${c.fieldL} (muted-strong ${c['muted-strong']}, fg-secondary ${c['fg-secondary']}, accent-text ${c['accent-text']}); extreme L=${c.extremeL} (muted-strong ${c['muted-strong@extreme']}); with particles L=${c.particleExtremeL}`,
  );
for (const f of results.fps) console.info(`fps ${f.style}/${f.theme}: ${f.fps}`);
for (const t of results.transitions) console.info(`transition ${t.motion}: vt=${t.vtCountAfter} running=${t.running} hit=${t.hit} hitIsRoot=${t.hitIsRoot} ${t.vtAnimations.join(', ')}`);
for (const e of results.errors.slice(0, 10)) console.info(`error ${e}`);
for (const a of results.axe.filter((x) => x.serious.length)) console.info(`axe ${a.style}/${a.theme}/${a.viewport} ${a.page}: ${a.serious.join(' | ')}`);
