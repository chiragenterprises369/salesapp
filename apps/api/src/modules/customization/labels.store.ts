import { LabelOverridesSchema, SETTING_KEYS, type LabelOverrides } from '@vistar/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TenantDb } from '../leads/lib/context.js';

/** Label overrides storage (Setting `ui.labels`, scope workspace). Plain functions: also used by the pack installer and scripts. */
const LABELS_KEY = SETTING_KEYS.workspace.labels;

/** Stored overrides of a workspace. Invalid JSON = no overrides. */
export async function readLabelOverrides(db: TenantDb, workspaceId: string): Promise<LabelOverrides> {
  const row = await db.setting.findFirst({ where: { scope: 'workspace', scopeId: workspaceId, key: LABELS_KEY }, select: { value: true } });
  const parsed = LabelOverridesSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : {};
}

/** Upsert the overrides row (explicit workspaceId). */
export function writeLabelOverrides(db: TenantDb, workspaceId: string, overrides: LabelOverrides) {
  const value = overrides as unknown as Prisma.InputJsonObject;
  return db.setting.upsert({
    where: { workspaceId_scope_scopeId_key: { workspaceId, scope: 'workspace', scopeId: workspaceId, key: LABELS_KEY } },
    create: { workspaceId, scope: 'workspace', scopeId: workspaceId, key: LABELS_KEY, value },
    update: { value },
  });
}
