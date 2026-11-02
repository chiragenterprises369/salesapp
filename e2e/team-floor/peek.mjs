// Quick look at the floor during development: one screenshot plus the QA info and label report.
// Usage: node e2e/team-floor/peek.mjs [base] [out.png] [path] [width] [height] [theme] [query]
import { canvasBox, floorPage, launch, openFloor } from './lib.mjs';

const [base = 'http://localhost:3005', out = 'peek.png', path = '/app/team-floor', w = '1440', h = '900', theme = 'light', query = ''] = process.argv.slice(2);
const params = Object.fromEntries(new URLSearchParams(query));
const browser = await launch();
const { page, errors } = await floorPage(browser, base, { width: Number(w), height: Number(h), theme });
try {
  const info = await openFloor(page, base, path, params);
  const box = await canvasBox(page);
  await page.screenshot({ path: out });
  const labels = await page.evaluate(() => window.__vistarFloor.labels());
  const overlaps = await page.evaluate(() => window.__vistarFloor.overlaps());
  console.log(JSON.stringify({ info, box, labels: labels.length, compact: labels.filter((l) => l.mode === 'compact').length, leaders: labels.filter((l) => l.leader).length, overlaps }, null, 1));
} catch (e) {
  await page.screenshot({ path: out });
  console.error('FAILED', e.message);
} finally {
  if (errors.length) console.log('page errors:', errors.slice(0, 10));
  await browser.close();
}
