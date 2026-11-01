import { isEntitled, packEntitlement, PackOverrideSchema, type ActivePack, type PackEntitlement, type Plan } from '@vistar/shared';
import type { PackDefinition, WorkspacePack } from '../../generated/prisma/client.js';
import { tenantClient } from '../../infra/prisma/tenant.js';
import type { RootPrisma } from './pack-registry.js';

export const parseOverride = (v: string | null | undefined) => {
  const r = PackOverrideSchema.safeParse(v);
  return r.success ? r.data : null;
};

export interface WorkspacePackEntry {
  def: PackDefinition & { entitlements: Array<{ plan: Plan }> };
  row: WorkspacePack | null;
  entitlement: PackEntitlement;
}

/** Every registry pack with this workspace's WorkspacePack row and entitlement (root client: registry is platform data). */
export async function workspacePackEntries(prisma: RootPrisma, workspaceId: string): Promise<WorkspacePackEntry[]> {
  const [defs, ws, rows] = await Promise.all([
    prisma.packDefinition.findMany({ include: { entitlements: { select: { plan: true } } }, orderBy: [{ core: 'desc' }, { name: 'asc' }] }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { plan: true } }),
    tenantClient(prisma, workspaceId).workspacePack.findMany(),
  ]);
  if (!ws) return [];
  const byKey = new Map(rows.map((r) => [r.packKey, r]));
  return defs.map((def) => {
    const row = byKey.get(def.key) ?? null;
    return { def, row, entitlement: packEntitlement({ core: def.core, plan: ws.plan, plans: def.entitlements.map((e) => e.plan), override: parseOverride(row?.platformOverride) }) };
  });
}

/** Active AND entitled packs (MeResponse.packs, runtime). Revoked packs keep their data but leave the runtime. */
export async function activeEntitledPacks(prisma: RootPrisma, workspaceId: string): Promise<ActivePack[]> {
  const entries = await workspacePackEntries(prisma, workspaceId);
  return entries
    .filter((e) => e.row?.status === 'active' && !!e.row.installedVersion && isEntitled(e.entitlement))
    .map((e) => ({ key: e.def.key, version: e.row!.installedVersion!, modes: [...e.row!.modes] }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
