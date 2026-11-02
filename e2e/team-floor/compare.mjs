#!/usr/bin/env node
// Side-by-side comparison sheet: reference render (left) and our screenshot (right), same height,
// with captions. Renders a local HTML page with Playwright (no extra dependencies).
// Usage: node e2e/team-floor/compare.mjs <ours.png> <out.png> "<caption for ours>" [height=720]
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [ours, out, caption = 'Ours', h = '720'] = process.argv.slice(2);
if (!ours || !out) {
  console.error('Usage: node e2e/team-floor/compare.mjs <ours.png> <out.png> "<caption>" [height]');
  process.exit(1);
}
const height = Number(h);
const ref = readFileSync(join(repo, 'docs/screenshots/team-floor-v3/reference.jpg')).toString('base64');
const mine = readFileSync(ours).toString('base64');
const html = `<!doctype html><html><head><style>
  body { margin: 0; background: #e9ebef; font: 14px/1.4 Inter, system-ui, sans-serif; color: #0f172a; }
  main { display: flex; gap: 16px; padding: 16px; width: max-content; }
  figure { margin: 0; background: #fff; border: 1px solid #d1d5db; border-radius: 10px; overflow: hidden; }
  img { display: block; height: ${height}px; width: auto; }
  figcaption { padding: 8px 12px; border-top: 1px solid #e5e7eb; }
  b { font-weight: 600; }
  span { color: #56657a; }
</style></head><body><main>
  <figure><img src="data:image/jpeg;base64,${ref}"><figcaption><b>Reference</b> <span>AI concept render (comparison only, never shipped)</span></figcaption></figure>
  <figure><img src="data:image/png;base64,${mine}"><figcaption><b>Ours</b> <span>${caption.replace(/</g, '&lt;')}</span></figcaption></figure>
</main></body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 3200, height: height + 120 } });
await page.setContent(html, { waitUntil: 'load' });
await page.locator('main').screenshot({ path: out });
await browser.close();
console.log(out);
