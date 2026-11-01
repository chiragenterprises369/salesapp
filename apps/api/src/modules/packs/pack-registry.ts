import { BUILTIN_PACK_MANIFESTS, compareSemver, PackManifestSchema, type PackManifest } from '@vistar/shared';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppException } from '../../common/errors/app-exception.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

/**
 * PACK REGISTRY (platform tables PackDefinition / PackVersion; root Prisma client only).
 * `syncRegistry(prisma)` registers every `packs/<key>/manifest.json`. Versions are immutable: the same
 * version with different content is refused (bump the version instead).
 * Plain functions so the API, `scripts/packs-sync.ts` and `prisma/seed.ts` share them.
 */

/** Root client (PrismaService or a script's PrismaClient). The tenant client throws for platform tables. */
export type RootPrisma = PrismaClient;

export class PackRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackRegistryError';
  }
}

/** JSON with object keys sorted recursively (arrays keep their order); undefined values dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

/** SHA-256 (hex) of the canonical JSON of the parsed manifest. */
export const manifestChecksum = (m: PackManifest): string => createHash('sha256').update(canonicalJson(m)).digest('hex');

/**
 * Directory with `<key>/manifest.json` files: env PACKS_DIR, else `<repo root>/packs` (the monorepo root is
 * found by walking up to pnpm-workspace.yaml, so it works from `src` via tsx and from `dist`).
 */
export function resolvePacksDir(): string {
  if (process.env.PACKS_DIR) return path.resolve(process.env.PACKS_DIR);
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return path.join(dir, 'packs');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // apps/api/{src,dist}/modules/packs -> repo root
  return path.resolve(here, '../../../../../packs');
}

export interface ManifestFile {
  file: string;
  manifest: PackManifest;
}

/** Read and validate every `<dir>/<key>/manifest.json`. Throws PackRegistryError listing the first problems. */
export function readManifestFiles(dir = resolvePacksDir()): ManifestFile[] {
  if (!existsSync(dir)) throw new PackRegistryError(`Packs directory not found: ${dir} (set PACKS_DIR)`);
  const out: ManifestFile[] = [];
  const problems: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const file = path.join(dir, name, 'manifest.json');
    if (!statSync(path.join(dir, name)).isDirectory() || !existsSync(file)) continue;
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push(`${name}/manifest.json is not valid JSON (${(err as Error).message})`);
      continue;
    }
    const parsed = PackManifestSchema.safeParse(json);
    if (!parsed.success) {
      problems.push(`${name}/manifest.json: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      continue;
    }
    if (parsed.data.key !== name) problems.push(`${name}/manifest.json declares key "${parsed.data.key}" (must match the folder name)`);
    else out.push({ file, manifest: parsed.data });
  }
  if (problems.length) throw new PackRegistryError(`Invalid pack manifests:\n  - ${problems.join('\n  - ')}`);
  return out;
}

export type RegisterStatus = 'created' | 'version_added' | 'unchanged';
export interface RegisterResult {
  key: string;
  version: string;
  latestVersion: string;
  checksum: string;
  status: RegisterStatus;
}

/** Refuse a changed manifest under an already registered version. */
async function assertSameChecksum(prisma: RootPrisma, m: PackManifest, checksum: string): Promise<boolean> {
  const existing = await prisma.packVersion.findFirst({ where: { version: m.version, pack: { key: m.key } }, select: { checksum: true } });
  if (existing && existing.checksum !== checksum) {
    throw new PackRegistryError(`${m.key}@${m.version} is already registered with different content. Bump "version" in the manifest.`);
  }
  return !!existing;
}

/** Register one manifest version (idempotent). PackDefinition metadata follows the highest version. */
export async function registerManifest(prisma: RootPrisma, manifest: PackManifest): Promise<RegisterResult> {
  try {
    return await registerOnce(prisma, manifest);
  } catch (err) {
    // Two syncs racing on the same new pack/version: the loser retries against the committed rows.
    if ((err as { code?: string }).code !== 'P2002') throw err;
    return registerOnce(prisma, manifest);
  }
}

async function registerOnce(prisma: RootPrisma, manifest: PackManifest): Promise<RegisterResult> {
  const checksum = manifestChecksum(manifest);
  await assertSameChecksum(prisma, manifest, checksum);
  return prisma.$transaction(async (tx) => {
    const def = await tx.packDefinition.findUnique({ where: { key: manifest.key }, include: { versions: { select: { version: true, checksum: true } } } });
    const existing = def?.versions.find((v) => v.version === manifest.version);
    if (existing && existing.checksum !== checksum) throw new PackRegistryError(`${manifest.key}@${manifest.version} is already registered with different content`);
    const versions = [...new Set([...(def?.versions.map((v) => v.version) ?? []), manifest.version])].sort(compareSemver);
    const latestVersion = versions.at(-1)!;
    const meta = { name: manifest.name, description: manifest.description, industry: manifest.industry, icon: manifest.icon, core: manifest.core };
    let packId: string;
    if (!def) {
      packId = (await tx.packDefinition.create({ data: { key: manifest.key, latestVersion, ...meta } })).id;
    } else {
      packId = def.id;
      const isLatest = compareSemver(manifest.version, latestVersion) === 0;
      if (def.latestVersion !== latestVersion || (isLatest && (Object.keys(meta) as Array<keyof typeof meta>).some((k) => def[k] !== meta[k]))) {
        await tx.packDefinition.update({ where: { id: def.id }, data: { latestVersion, ...(isLatest ? meta : {}) } });
      }
    }
    if (!existing) {
      await tx.packVersion.create({ data: { packId, version: manifest.version, manifest: manifest as unknown as Prisma.InputJsonObject, checksum } });
    }
    return { key: manifest.key, version: manifest.version, latestVersion, checksum, status: !def ? 'created' : existing ? 'unchanged' : 'version_added' };
  });
}

/**
 * Register every manifest file. All files are validated (schema + immutable versions) before anything is
 * written, so a bad file changes nothing.
 */
export async function syncRegistry(prisma: RootPrisma, opts: { dir?: string } = {}): Promise<{ dir: string; packs: RegisterResult[] }> {
  const dir = opts.dir ?? resolvePacksDir();
  const files = readManifestFiles(dir);
  for (const { manifest } of files) await assertSameChecksum(prisma, manifest, manifestChecksum(manifest));
  const packs: RegisterResult[] = [];
  for (const { manifest } of files) packs.push(await registerManifest(prisma, manifest));
  return { dir, packs };
}

// ---------------------------------------------------------------- reading versions

/**
 * Make sure a pack has at least one registered version: sync the packs directory first; if that is not
 * possible (no packs dir in this deployment), register the built-in manifest shipped in @vistar/shared.
 */
export async function ensurePackRegistered(prisma: RootPrisma, key: string): Promise<void> {
  if (await prisma.packVersion.count({ where: { pack: { key } } })) return;
  try {
    await syncRegistry(prisma);
  } catch (err) {
    if (!BUILTIN_PACK_MANIFESTS[key]) throw err;
  }
  if (await prisma.packVersion.count({ where: { pack: { key } } })) return;
  const builtin = BUILTIN_PACK_MANIFESTS[key];
  if (!builtin) throw new PackRegistryError(`Pack ${key} is not in the registry and has no built-in manifest`);
  await registerManifest(prisma, builtin);
}

const manifestCache = new Map<string, PackManifest>();

/** Parsed manifest of one registered version (cached by checksum; versions are immutable). */
export async function loadManifest(prisma: RootPrisma, key: string, version: string): Promise<PackManifest> {
  const row = await prisma.packVersion.findFirst({ where: { version, pack: { key } }, select: { checksum: true, manifest: true } });
  if (!row) throw new AppException('NOT_FOUND', `Pack ${key} version ${version} is not in the registry`);
  const cacheKey = `${key}@${version}:${row.checksum}`;
  let m = manifestCache.get(cacheKey);
  if (!m) {
    const parsed = PackManifestSchema.safeParse(row.manifest);
    if (!parsed.success) throw new AppException('INTERNAL_ERROR', `Stored manifest ${key}@${version} is invalid`);
    m = parsed.data;
    if (manifestCache.size > 200) manifestCache.clear();
    manifestCache.set(cacheKey, m);
  }
  return m;
}
