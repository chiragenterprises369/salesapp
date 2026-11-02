#!/usr/bin/env node
// Renders scripts/team-floor/.out/<id>-plan.svg to PNG (for quick layout reviews).
// Usage: node scripts/team-floor/preview-plan.mjs [id]
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const id = process.argv[2] ?? 'medium';
const dir = join(dirname(fileURLToPath(import.meta.url)), '.out');
const svg = readFileSync(join(dir, `${id}-plan.svg`), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<body style="margin:0">${svg}</body>`);
await page.locator('svg').screenshot({ path: join(dir, `${id}-plan.png`) });
await browser.close();
console.log(join(dir, `${id}-plan.png`));
