#!/usr/bin/env node
// Checks that three.js, @react-three/fiber and drei are NOT in the initial chunks of the Team Floor
// routes (SPEC 12 "lazy-load the whole Three.js bundle"). Reads the Next build output.
// Usage: node e2e/team-floor/bundle-check.mjs   (after `pnpm --filter @vistar/web build`)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const next = join(repo, 'apps/web/.next');
const ROUTES = ['(company)/app/team-floor', '(employee)/me/team-floor'];

/** The `entryJSFiles` object of a client reference manifest (layouts + page of one route). */
function entryFiles(src) {
  const at = src.indexOf('"entryJSFiles":');
  if (at < 0) return null;
  let i = src.indexOf('{', at);
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return JSON.parse(src.slice(start, i + 1));
}
// Strings that only exist inside three / R3F builds.
const MARKERS = [/WebGLRenderer/, /THREE\.WebGLRenderer|REVISION\s*=\s*"\d+"/, /react-three-fiber|@react-three\/fiber|useFrame must be used/, /MeshBasicMaterial/];

let failed = false;
for (const dir of ROUTES) {
  const manifestPath = join(next, 'server/app', dir, 'page_client-reference-manifest.js');
  const entries = entryFiles(readFileSync(manifestPath, 'utf8'));
  // Initial chunks of the route = root layout + group layouts + the page (global-error excluded).
  const files = entries
    ? [...new Set(Object.entries(entries).filter(([k]) => !k.includes('global-error')).flatMap(([, v]) => v))]
    : null;
  if (!files?.length) {
    console.error(`${dir}: no entry chunks found in the manifest`);
    failed = true;
    continue;
  }
  let bytes = 0;
  const hits = [];
  for (const f of files) {
    const path = join(next, f);
    const code = readFileSync(path, 'utf8');
    bytes += statSync(path).size;
    for (const m of MARKERS) if (m.test(code)) hits.push(`${f} matches ${m}`);
  }
  console.log(`${dir}: ${files.length} initial chunks, ${(bytes / 1024).toFixed(0)} KB raw, three/R3F markers: ${hits.length ? hits.join('; ') : 'none'}`);
  if (hits.length) failed = true;
}
// Positive control: three must still exist somewhere (the lazily loaded scene chunk).
const lazy = readdirSync(join(next, 'static/chunks')).filter((f) => f.endsWith('.js') && MARKERS[0].test(readFileSync(join(next, 'static/chunks', f), 'utf8')));
console.log(`lazy chunks with three: ${lazy.length ? lazy.join(', ') : 'none (markers broken?)'}`);
if (!lazy.length) failed = true;
process.exitCode = failed ? 1 : 0;
