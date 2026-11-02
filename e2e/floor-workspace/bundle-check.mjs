#!/usr/bin/env node
// Floor workspace and attendance bundle check (after `pnpm --filter @vistar/web build`):
// - the Team Floor routes keep three.js / R3F AND Leaflet out of their initial chunks (panels, the lead
//   drawer and the request panel are loaded on first use);
// - the attendance routes keep Leaflet out of their initial chunks (the map is loaded with next/dynamic),
//   and Leaflet still exists in a lazy chunk (positive control).
// Usage: node e2e/floor-workspace/bundle-check.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const next = join(repo, 'apps/web/.next');

const THREE = [/WebGLRenderer/, /react-three-fiber|@react-three\/fiber|useFrame must be used/];
// Literal class names inside the Leaflet build (pane class names are computed, so they are not used).
const LEAFLET = [/leaflet-marker-icon/, /leaflet-control-attribution/];
const ROUTES = [
  { dir: '(company)/app/team-floor', forbid: [...THREE, ...LEAFLET] },
  { dir: '(employee)/me/team-floor', forbid: [...THREE, ...LEAFLET] },
  { dir: '(company)/app/attendance', forbid: [...THREE, ...LEAFLET] },
  { dir: '(company)/app/attendance/live', forbid: [...THREE, ...LEAFLET] },
  { dir: '(company)/app/attendance/routes', forbid: [...THREE, ...LEAFLET] },
];

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

let failed = false;
for (const { dir, forbid } of ROUTES) {
  const manifest = join(next, 'server/app', dir, 'page_client-reference-manifest.js');
  let entries;
  try {
    entries = entryFiles(readFileSync(manifest, 'utf8'));
  } catch {
    console.error(`${dir}: no client reference manifest (build first)`);
    failed = true;
    continue;
  }
  const files = entries ? [...new Set(Object.entries(entries).filter(([k]) => !k.includes('global-error')).flatMap(([, v]) => v))] : [];
  let bytes = 0;
  const hits = [];
  for (const f of files) {
    const path = join(next, f);
    const code = readFileSync(path, 'utf8');
    bytes += statSync(path).size;
    for (const m of forbid) if (m.test(code)) hits.push(`${f} matches ${m}`);
  }
  console.log(`${dir}: ${files.length} initial chunks, ${(bytes / 1024).toFixed(0)} KB raw, forbidden markers: ${hits.length ? hits.join('; ') : 'none'}`);
  if (!files.length || hits.length) failed = true;
}
const lazy = readdirSync(join(next, 'static/chunks')).filter((f) => f.endsWith('.js') && LEAFLET[0].test(readFileSync(join(next, 'static/chunks', f), 'utf8')));
console.log(`lazy chunks with Leaflet: ${lazy.length ? lazy.join(', ') : 'none (markers broken?)'}`);
if (!lazy.length) failed = true;
process.exitCode = failed ? 1 : 0;
