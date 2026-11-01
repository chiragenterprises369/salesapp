/**
 * pnpm --filter @vistar/api packs:sync
 *
 * 1. Registers every packs/<key>/manifest.json in the pack registry (PackDefinition / PackVersion).
 *    A changed manifest under an already registered version is refused (bump the version).
 * 2. Installs or upgrades every CORE pack in every workspace (idempotent: a second run is all noop).
 * Prints one line per workspace; exits 1 if anything failed. Never deletes data (adopts and adds only).
 * PACKS_DIR overrides the manifests directory (default: <repo root>/packs).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { installPack, SYSTEM_PACK_ACTOR } from '../src/modules/packs/pack-installer.js';
import { syncRegistry } from '../src/modules/packs/pack-registry.js';

config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const fmt = (summary: Record<string, number>) =>
  Object.entries(summary)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  let failures = 0;
  try {
    const registry = await syncRegistry(prisma);
    for (const p of registry.packs) console.info(`registry  ${p.key}@${p.version}  ${p.status}  (latest ${p.latestVersion})`);

    const corePacks = await prisma.packDefinition.findMany({ where: { core: true }, select: { key: true }, orderBy: { key: 'asc' } });
    const workspaces = await prisma.workspace.findMany({ where: { deletedAt: null, status: { not: 'deleted' } }, select: { id: true, slug: true }, orderBy: { createdAt: 'asc' } });
    for (const ws of workspaces) {
      const parts: string[] = [];
      for (const { key } of corePacks) {
        try {
          const r = await installPack(prisma, ws.id, key, { action: 'sync', actor: SYSTEM_PACK_ACTOR, onError: (m) => console.error(m) });
          const what = r.noop ? 'noop' : `${r.status}${r.fromVersion && r.fromVersion !== r.toVersion ? ` ${r.fromVersion}->${r.toVersion}` : ''} ${fmt(r.summary)}`.trim();
          parts.push(`${key}@${r.toVersion} ${what}${r.conflicts.length ? ` (${r.conflicts.length} conflicts)` : ''}`);
        } catch (err) {
          failures++;
          parts.push(`${key} FAILED: ${(err as Error).message}`);
        }
      }
      console.info(`workspace ${ws.slug.padEnd(32)} ${parts.join('; ') || 'no core packs'}`);
    }
    console.info(`\n${workspaces.length} workspaces, ${corePacks.length} core packs, ${failures} failures`);
  } finally {
    await prisma.$disconnect();
  }
  return failures ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: Error) => {
    console.error(`packs:sync failed: ${err.message}`);
    process.exit(1);
  });
