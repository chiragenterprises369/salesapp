import type { CustomFieldValue, CustomFieldValues, FieldDefinition, FieldError } from '@vistar/shared';
import { Prisma } from '../../generated/prisma/client.js';
import type { TenantDb } from '../leads/lib/context.js';
import { sameValue } from './custom-values.js';

/**
 * Unique custom fields ("value must be unique per target in the workspace").
 * Run inside the write transaction after `lockUnique` so two concurrent writes cannot both pass.
 */

const notUnique = (pathPrefix: string, def: FieldDefinition): FieldError => ({ path: `${pathPrefix}.${def.key}`, message: `Another record already has this ${def.label}` });

/** Unique, active definitions whose key is set (non-null) in `values`. */
export function uniqueDefsIn(defs: readonly FieldDefinition[], values: CustomFieldValues, keys?: readonly string[]): FieldDefinition[] {
  return defs.filter((d) => d.unique && !d.archivedAt && values[d.key] !== undefined && values[d.key] !== null && (!keys || keys.includes(d.key)));
}

/** Transaction-scoped advisory lock (released at commit/rollback). */
export async function lockUnique(tx: TenantDb, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Custom object records: JSON containment on `values` (GIN jsonb_path_ops index), then exact compare. */
export async function recordUniqueErrors(
  tx: TenantDb,
  workspaceId: string,
  objectId: string,
  defs: readonly FieldDefinition[],
  values: CustomFieldValues,
  opts: { excludeId?: string; keys?: readonly string[]; pathPrefix?: string } = {},
): Promise<FieldError[]> {
  const errors: FieldError[] = [];
  for (const def of uniqueDefsIn(defs, values, opts.keys)) {
    const value = values[def.key] as CustomFieldValue;
    const probe = JSON.stringify({ [def.key]: value });
    // Raw SQL is not tenant-scoped automatically: workspaceId is filtered explicitly.
    const rows = await tx.$queryRaw<Array<{ v: unknown }>>`
      SELECT "values" -> ${def.key} AS v FROM "CustomRecord"
      WHERE "workspaceId" = ${workspaceId}::uuid AND "objectId" = ${objectId}::uuid AND "deletedAt" IS NULL
        AND "values" @> ${probe}::jsonb
        ${opts.excludeId ? Prisma.sql`AND "id" <> ${opts.excludeId}::uuid` : Prisma.empty}
      LIMIT 50`;
    if (rows.some((r) => sameValue(normalize(r.v), normalize(value)))) errors.push(notUnique(opts.pathPrefix ?? 'values', def));
  }
  return errors;
}

/** Core entities with a customFields column and soft delete. */
export async function entityUniqueErrors(
  tx: TenantDb,
  entity: 'lead' | 'task',
  defs: readonly FieldDefinition[],
  values: CustomFieldValues,
  opts: { excludeId?: string; keys?: readonly string[]; pathPrefix?: string } = {},
): Promise<FieldError[]> {
  const errors: FieldError[] = [];
  for (const def of uniqueDefsIn(defs, values, opts.keys)) {
    const where = {
      deletedAt: null,
      ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
      customFields: { path: [def.key], equals: values[def.key] as Prisma.InputJsonValue },
    };
    const found = entity === 'lead' ? await tx.lead.count({ where }) : await tx.task.count({ where });
    if (found > 0) errors.push(notUnique(opts.pathPrefix ?? 'customFields', def));
  }
  return errors;
}

/** Arrays compare as sets (multi-select order does not matter). */
function normalize(v: unknown): unknown {
  return Array.isArray(v) ? [...v].map(String).sort() : v;
}
