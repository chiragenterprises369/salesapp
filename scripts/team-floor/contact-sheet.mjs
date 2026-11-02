#!/usr/bin/env node
// Composes PNGs from a folder into one contact sheet (for reviewing Blender clip previews).
// Usage: node scripts/team-floor/contact-sheet.mjs <dir> <out.png> [columns]
import { chromium } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out, cols = '6'] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const cells = files
  .map((f) => `<figure><img src="data:image/png;base64,${readFileSync(join(dir, f)).toString('base64')}"><figcaption>${f.replace('.png', '')}</figcaption></figure>`)
  .join('');
const html = `<style>body{margin:0;font:12px sans-serif;background:#ddd}main{display:grid;grid-template-columns:repeat(${cols},auto);gap:4px;padding:4px;width:max-content}figure{margin:0;background:#fff}img{display:block;width:240px}figcaption{padding:2px 4px}</style><main>${cells}</main>`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
await page.locator('main').screenshot({ path: out });
await browser.close();
console.log(out);
