// Creates or completes .env from .env.example. Existing keys and values are NEVER changed;
// only missing keys are appended (local-only secrets are generated). Run: pnpm setup:env
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env');

const gen = {
  JWT_ACCESS_SECRET: () => randomBytes(48).toString('base64url'),
  JWT_REFRESH_SECRET: () => randomBytes(48).toString('base64url'),
  SUPER_JWT_SECRET: () => randomBytes(48).toString('base64url'),
  ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
  S3_ACCESS_KEY: () => 'vistar',
  S3_SECRET_KEY: () => 'vistar-dev-secret',
};

const existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
const present = new Set(
  existing
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1])
    .filter(Boolean),
);

const added = [];
const lines = [];
for (const line of readFileSync(join(root, '.env.example'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  const [, key, value] = m;
  if (present.has(key)) continue;
  lines.push(`${key}=${value === '' && gen[key] ? gen[key]() : value}`);
  added.push(key);
}

if (added.length === 0) {
  console.info('.env is complete; nothing changed.');
  process.exit(0);
}
const sep = existing && !existing.endsWith('\n') ? '\n' : '';
const header = existing ? '\n# ---- added by pnpm setup:env ----\n' : '';
writeFileSync(target, `${existing}${sep}${header}${lines.join('\n')}\n`, { mode: 0o600 });
console.info(`.env: added ${added.length} missing keys (existing values untouched): ${added.join(', ')}`);
