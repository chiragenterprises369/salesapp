import { DEFAULT_PIPELINE_KEY, GENERIC_SALES_PACK_KEY, planPackInstall, summarizeOps, writeOps } from '@vistar/shared';
import { COMPANY_FIXTURES } from '@vistar/shared/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { tenantClient } from '../../infra/prisma/tenant.js';
import { loadPackState } from './pack-installer.js';
import { loadManifest, syncRegistry } from './pack-registry.js';
import { newTestPrisma } from './testing.js';

/**
 * Existing (seeded) workspaces after migration 20261101180000: READ-ONLY checks, nothing is written to them.
 * - Before `packs:sync`: generic-sales adopts the existing pipeline and templates and only adds its fields.
 * - After `packs:sync`: planning with the installed version as previous yields no write ops.
 * - Pipeline keys are unique per workspace; exactly one default "sales" pipeline owned by generic-sales.
 */

let prisma: PrismaClient;
let seeded: Array<{ id: string; slug: string }> = [];

beforeAll(async () => {
  prisma = newTestPrisma();
  await syncRegistry(prisma);
  seeded = await prisma.workspace.findMany({ where: { slug: { in: COMPANY_FIXTURES.map((c) => c.slug) } }, select: { id: true, slug: true } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('existing workspaces and generic-sales', () => {
  it('plans no pipeline/stage/template writes for seeded workspaces, and nothing at all once synced', async () => {
    if (!seeded.length) console.warn('No seeded workspaces found (run pnpm db:seed:demo): adoption check skipped');
    for (const ws of seeded) {
      const db = tenantClient(prisma, ws.id);
      const state = await loadPackState(db);
      const row = await db.workspacePack.findUnique({ where: { workspaceId_packKey: { workspaceId: ws.id, packKey: GENERIC_SALES_PACK_KEY } } });
      const def = await prisma.packDefinition.findUniqueOrThrow({ where: { key: GENERIC_SALES_PACK_KEY } });
      const manifest = await loadManifest(prisma, GENERIC_SALES_PACK_KEY, def.latestVersion);
      if (row?.status === 'active' && row.installedVersion) {
        const previous = await loadManifest(prisma, GENERIC_SALES_PACK_KEY, row.installedVersion);
        const ops = planPackInstall(state, manifest, { modes: row.modes, previous, previousModes: row.modes });
        expect(writeOps(ops), ws.slug).toEqual([]);
      } else {
        const ops = writeOps(planPackInstall(state, manifest, { modes: [] }));
        expect(Object.keys(summarizeOps(ops)).filter((k) => k !== 'field.create'), ws.slug).toEqual([]);
      }
    }
  });

  it('pipeline keys are unique per workspace and the default pipeline is "sales" (generic-sales)', async () => {
    const dupes = await prisma.pipeline.groupBy({ by: ['workspaceId', 'key'], _count: { _all: true }, having: { key: { _count: { gt: 1 } } } });
    expect(dupes).toEqual([]);
    for (const ws of seeded) {
      const sales = await tenantClient(prisma, ws.id).pipeline.findMany({ where: { key: DEFAULT_PIPELINE_KEY } });
      expect(sales, ws.slug).toHaveLength(1);
      expect(sales[0], ws.slug).toMatchObject({ isDefault: true, packKey: GENERIC_SALES_PACK_KEY, archivedAt: null });
    }
  });
});
