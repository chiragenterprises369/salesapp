// Contrast audit of the Leads Board "Neon Space" skin on the RENDERED background (SPEC 28.1, D-053).
// For each text class it takes two screenshots in the same frame (animations paused): one as rendered,
// one with all board text made transparent. Background pixels are sampled from the second one inside
// every text line box (Range client rects, device pixels), and WCAG 2.x contrast is computed against
// the element's computed text colour. Body text needs >= 4.5:1, large text (>= 24 px, or >= 18.66 px
// bold) >= 3:1. The pass criterion is the WORST sampled pixel of every instance.
//
// Usage (worktree root, server on 3003): node docs/screenshots/leads-neon/contrast.mjs [out.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { openBoard, prepareContext } from './capture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(process.argv[2] ?? join(here, 'contrast.json'));
// The rendered frames the audit measured (gitignored, like the iteration folders).
const shotsDir = join(here, 'iter-contrast');
mkdirSync(shotsDir, { recursive: true });

const CLASSES = {
  stageHeader: 'section[data-stage-key] h3',
  count: 'section[data-stage-key] [data-count] > span[aria-hidden], section[data-stage-key] [data-count]',
  inrTotal: '[data-column-total]',
  cardName: '[data-lead-name]',
  company: '[data-lead-company]',
  value: '[data-lead-value]',
  activityLine: '[data-lead-followup]',
  chips: '[data-lead-tags] [data-slot="chip"]',
  toolbar: '[data-board-phase] > div:first-of-type > p',
};

const VIEWS = [
  { theme: 'dark', variant: 'neon', width: 1440, height: 900, dpr: 1 },
  { theme: 'dark', variant: 'neon', width: 1920, height: 1080, dpr: 2 },
  { theme: 'light', variant: 'aurora', width: 1440, height: 900, dpr: 1 },
  { theme: 'light', variant: 'aurora', width: 1920, height: 1080, dpr: 2 },
];

/** In the board page: text line boxes (CSS px) and colours for every visible instance of each class. */
function collect(classes) {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
    return [Number(r), Number(g), Number(b), Number(a)];
  };
  const visibleIn = (rect, el) => {
    // Inside the viewport and inside the column's scroll area (not clipped).
    if (rect.width < 2 || rect.height < 2 || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return false;
    const clip = el.closest('.vb-list, .vb-scroller');
    if (clip) {
      const c = clip.getBoundingClientRect();
      if (rect.top < c.top || rect.bottom > c.bottom || rect.left < c.left || rect.right > c.right) return false;
    }
    const scroller = el.closest('.vb-scroller');
    if (scroller) {
      const s = scroller.getBoundingClientRect();
      if (rect.left < s.left || rect.right > s.right) return false;
    }
    return true;
  };
  const out = {};
  for (const [name, selector] of Object.entries(classes)) {
    const seen = new Set();
    out[name] = [];
    for (const el of document.querySelectorAll(selector)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const rects = [];
      let text = '';
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const host = n.parentElement;
        if (!n.textContent?.trim() || !host || host.closest('.sr-only, [hidden]')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (visibleIn(r, el)) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height, color: getComputedStyle(host).color });
        text += n.textContent.trim() + ' ';
      }
      if (!rects.length) continue;
      const cs = getComputedStyle(el);
      out[name].push({
        text: text.trim().slice(0, 40),
        fontSize: parseFloat(cs.fontSize),
        fontWeight: Number(cs.fontWeight),
        rects: rects.map((r) => ({ ...r, rgba: parse(r.color) })),
      });
    }
  }
  return out;
}

/** In a blank page: sample a PNG (base64) inside rects (device px). Returns per-rect pixel arrays. */
async function sampler(page, png) {
  await page.setContent('<canvas id="c"></canvas>');
  await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.getElementById('c');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    window.__px = (x, y, w, h) => Array.from(ctx.getImageData(x, y, w, h).data);
  }, png.toString('base64'));
  return (x, y, w, h) => page.evaluate(([x, y, w, h]) => window.__px(x, y, w, h), [x, y, w, h]);
}

const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))];

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = {
  generatedAt: new Date().toISOString(),
  method:
    'Two screenshots per view in the same frame (animations paused): rendered, and with board text transparent. Background = pixels of the second screenshot inside each text line box (device px, inset 1 px). Contrast = WCAG 2.x ratio of the computed text colour (alpha composited over the mean background) against every sampled pixel; worst pixel per instance. Body >= 4.5, large >= 3.',
  views: {},
  summary: { pass: true, failures: [] },
};
try {
  for (const v of VIEWS) {
    const ctx = await prepareContext(browser, v);
    const page = await ctx.newPage();
    await openBoard(page);
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
    const items = await page.evaluate(collect, CLASSES);
    await page.screenshot({ path: join(shotsDir, `${v.variant}-${v.width}@${v.dpr}x.png`) }).catch(() => undefined);
    await page.addStyleTag({
      content: '[data-board-phase] *, [data-board-phase] *::before, [data-board-phase] *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }',
    });
    await page.waitForTimeout(150);
    const bg = await page.screenshot();
    const blank = await ctx.newPage();
    const px = await sampler(blank, bg);
    const key = `${v.variant}-${v.theme}-${v.width}x${v.height}@${v.dpr}x`;
    const classes = {};
    for (const [name, list] of Object.entries(items)) {
      const ratios = [];
      let worst = null;
      const colors = new Set();
      for (const inst of list.slice(0, 40)) {
        const large = inst.fontSize >= 24 || (inst.fontSize >= 18.66 && inst.fontWeight >= 700);
        let instWorst = Infinity;
        let instBg = null;
        for (const r of inst.rects) {
          if (!r.rgba) continue;
          const x = Math.round((r.x + 1) * v.dpr);
          const y = Math.round((r.y + 1) * v.dpr);
          const w = Math.max(1, Math.round((r.w - 2) * v.dpr));
          const h = Math.max(1, Math.round((r.h - 2) * v.dpr));
          const data = await px(x, y, w, h);
          let sr = 0;
          let sg = 0;
          let sb = 0;
          const n = data.length / 4;
          for (let i = 0; i < data.length; i += 4) {
            sr += data[i];
            sg += data[i + 1];
            sb += data[i + 2];
          }
          const mean = [sr / n, sg / n, sb / n];
          const [cr, cg, cb, ca] = r.rgba;
          const fg = [cr * ca + mean[0] * (1 - ca), cg * ca + mean[1] * (1 - ca), cb * ca + mean[2] * (1 - ca)];
          colors.add(hex(fg));
          for (let i = 0; i < data.length; i += 4) {
            const c = ratio(fg, [data[i], data[i + 1], data[i + 2]]);
            if (c < instWorst) {
              instWorst = c;
              instBg = [data[i], data[i + 1], data[i + 2]];
            }
          }
        }
        if (instWorst === Infinity) continue;
        ratios.push(instWorst);
        const need = large ? 3 : 4.5;
        if (!worst || instWorst < worst.ratio) worst = { ratio: Math.round(instWorst * 100) / 100, text: inst.text, background: hex(instBg), need };
      }
      ratios.sort((a, b) => a - b);
      const need = worst?.need ?? 4.5;
      const pass = !worst || worst.ratio >= need;
      classes[name] = {
        instances: ratios.length,
        minRatio: worst?.ratio ?? null,
        p10Ratio: ratios.length ? Math.round(pct(ratios, 0.1) * 100) / 100 : null,
        medianRatio: ratios.length ? Math.round(pct(ratios, 0.5) * 100) / 100 : null,
        required: need,
        textColors: [...colors].slice(0, 6),
        worst,
        pass,
      };
      if (!pass) {
        report.summary.pass = false;
        report.summary.failures.push(`${key} ${name}: ${worst.ratio} < ${need} ("${worst.text}" on ${worst.background})`);
      }
    }
    report.views[key] = classes;
    console.info(key, Object.entries(classes).map(([k, c]) => `${k} ${c.minRatio}${c.pass ? '' : ' FAIL'}`).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.info(`${outFile} pass=${report.summary.pass}`);
