// Space Shell (SPEC 28.2) performance check: Lighthouse (desktop preset, performance only) on
// /login, /app and /app/leads for each interface style, in the dark theme (the heaviest backdrop).
// Needs a running production build (next start) and Lighthouse 12 in the npx cache (`npx -y lighthouse@12 --version`).
// Usage (worktree root): node docs/screenshots/space-shell/perf.mjs http://localhost:3001 <label> [classic,depth,neon] [runs]
// Writes docs/screenshots/space-shell/perf-<label>.json and prints a table (median of `runs` per page).
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPLOYEE_FIXTURES, MOCK_WORKSPACE_ID, mockUsers } from '../../../packages/shared/dist/fixtures/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const [, , base = 'http://localhost:3001', label = 'run', stylesArg = 'classic', runsArg = '3', pagesArg] = process.argv;
const styles = stylesArg.split(',');
const runs = Number(runsArg);
const PAGES = pagesArg ? pagesArg.split(',') : ['/login', '/app', '/app/leads'];
const adminId = mockUsers()[EMPLOYEE_FIXTURES.findIndex((e) => e.key === 'admin')].id;

function findLighthouseCli() {
  const root = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'npm-cache', '_npx');
  for (const dir of existsSync(root) ? readdirSync(root) : []) {
    const cli = join(root, dir, 'node_modules', 'lighthouse', 'cli', 'index.js');
    if (existsSync(cli)) return cli;
  }
  throw new Error('Lighthouse not in the npx cache. Run: npx -y lighthouse@12 --version');
}
const LH = findLighthouseCli();

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

let PORT = 9333;

/** Chromium with a debugging port; Lighthouse attaches to it so cookies and localStorage survive. */
async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'vistar-lh-'));
  const proc = spawn(chromium.executablePath(), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return { proc, profile };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Chromium did not open port ${PORT}`);
}

/**
 * Theme and interface cookies, the mock session (signed out for /login), one warm-up visit so the
 * server is warm, then an empty HTTP cache so every Lighthouse run is a cold first load.
 */
async function prepare(style, path) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const context = browser.contexts()[0];
  const { hostname } = new URL(base);
  const expires = Math.floor(Date.now() / 1000) + 86_400;
  const cookie = (name, value) => ({ name, value: encodeURIComponent(JSON.stringify(value)), domain: hostname, path: '/', expires });
  await context.addCookies([
    cookie('vistar_theme', { mode: 'dark', darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' }),
    cookie('vistar_ui', { s: style, d: 'classic', m: 'full', rm: 'system' }),
  ]);
  const page = await context.newPage();
  await page.goto(`${base}/kit`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ id, ws, style, signedIn }) => {
      if (signedIn) localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'company_admin' }));
      else localStorage.removeItem('vistar.mock.persona');
      localStorage.setItem(`vistar.ui.user.${id}`, JSON.stringify({ interfaceStyle: style, motionIntensity: 'full' }));
      localStorage.setItem(`vistar.ui.workspace.${ws}`, JSON.stringify({ defaultInterfaceStyle: 'classic' }));
    },
    { id: adminId, ws: MOCK_WORKSPACE_ID, style, signedIn: path !== '/login' },
  );
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.close();
  // Disconnect: an attached Playwright client pauses new targets, and Lighthouse opens its own tab.
  await browser.close();
}

async function clearHttpCache() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const page = await browser.contexts()[0].newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await page.close();
  await browser.close();
}

function lighthouse(url, out) {
  const r = spawnSync(
    process.execPath,
    [LH, url, `--port=${PORT}`, '--disable-storage-reset', '--preset=desktop', '--only-categories=performance', '--output=json', `--output-path=${out}`, '--quiet'],
    { encoding: 'utf8', timeout: 170_000 },
  );
  if (r.status !== 0) throw new Error(`lighthouse failed for ${url} (status ${r.status}, ${r.error ?? ''}): ${(r.stderr || r.stdout || '').slice(-600)}`);
  const lhr = JSON.parse(readFileSync(out, 'utf8'));
  const a = lhr.audits;
  const script = a['resource-summary']?.details?.items?.find((i) => i.resourceType === 'script');
  return {
    score: Math.round((lhr.categories.performance.score ?? 0) * 100),
    fcp: Math.round(a['first-contentful-paint'].numericValue),
    lcp: Math.round(a['largest-contentful-paint'].numericValue),
    tbt: Math.round(a['total-blocking-time'].numericValue),
    cls: Number(a['cumulative-layout-shift'].numericValue.toFixed(3)),
    jsKb: Math.round((script?.transferSize ?? 0) / 1024),
    landed: new URL(lhr.finalDisplayedUrl ?? lhr.finalUrl).pathname,
  };
}

const results = [];
for (const style of styles) {
  PORT += 1; // a fresh port per style: Windows may hold the previous one for a moment
  const { proc, profile } = await launchChrome();
  for (const path of PAGES) {
    await prepare(style, path);
    const samples = [];
    for (let i = 0; i < runs; i++) {
      await clearHttpCache();
      samples.push(lighthouse(`${base}${path}`, join(tmpdir(), `vistar-lh-${label}-${i}.json`)));
    }
    const pick = (k) => median(samples.map((s) => s[k]));
    const row = { style, path, score: pick('score'), fcp: pick('fcp'), lcp: pick('lcp'), tbt: pick('tbt'), cls: pick('cls'), jsKb: pick('jsKb'), landed: samples[0].landed, runs };
    results.push(row);
    console.info(JSON.stringify(row));
  }
  // Chrome on Windows leaves child processes; kill the tree, then clean up best-effort.
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill();
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    console.warn(`could not remove ${profile}`);
  }
}

writeFileSync(join(here, `perf-${label}.json`), `${JSON.stringify({ base, label, theme: 'dark', preset: 'desktop', results }, null, 2)}\n`);
console.info('\nstyle    page        score  FCP ms  LCP ms  TBT ms  CLS    JS kB  landed');
for (const r of results)
  console.info(
    `${r.style.padEnd(8)} ${r.path.padEnd(11)} ${String(r.score).padStart(5)}  ${String(r.fcp).padStart(6)}  ${String(r.lcp).padStart(6)}  ${String(r.tbt).padStart(6)}  ${String(r.cls).padEnd(5)}  ${String(r.jsKb).padStart(5)}  ${r.landed}`,
  );
process.exit(0);
