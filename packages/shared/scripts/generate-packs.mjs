// Writes packs/<key>/manifest.json for every built-in pack from BUILTIN_PACK_MANIFESTS. Run: pnpm --filter @vistar/shared packs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_PACK_MANIFESTS } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', 'packs');

for (const [key, manifest] of Object.entries(BUILTIN_PACK_MANIFESTS)) {
  const dir = join(root, key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.info(`Pack ${key}@${manifest.version} -> ${join(dir, 'manifest.json')}`);
}
