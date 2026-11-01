import type { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Tenant-scoped Prisma client. Injects `workspaceId` into every query's `where` and every create's
 * `data`, so a forgotten filter cannot leak data across workspaces.
 *
 * Rules (enforced in review and tenant-isolation tests):
 * - Use UNCHECKED inputs: set scalar foreign keys (`ownerId`, `stageId`), not `{ connect }`.
 * - Nested writes are NOT scoped automatically: pass `workspaceId` explicitly in nested `create`.
 * - `$queryRaw` / `$executeRaw` bypass this: always filter by "workspaceId" yourself.
 * - Workspace itself is excluded (query it by id from the AuthContext).
 */
const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

type AnyArgs = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown; create?: Record<string, unknown> };

/** Models without workspaceId. Workspace passes through; platform tables are rejected. */
const UNSCOPED_MODELS = new Set(['Workspace', 'PlatformAdmin', 'PlatformSession', 'PlatformAuditLog', 'PlanDefinition']);

export function tenantClient(prisma: PrismaClient, workspaceId: string) {
  if (!workspaceId) throw new Error('tenantClient requires a workspaceId');
  return prisma.$extends({
    name: 'tenant',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (UNSCOPED_MODELS.has(model)) {
            if (model === 'Workspace') return query(args);
            throw new Error(`${model} is a platform table; use the root PrismaService, not forTenant()`);
          }
          const a = { ...(args as AnyArgs) };
          if (WHERE_OPS.has(operation)) {
            a.where = { ...(a.where ?? {}), workspaceId };
          } else if (operation === 'create') {
            a.data = { ...(a.data as Record<string, unknown>), workspaceId };
          } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const data = a.data as Record<string, unknown> | Record<string, unknown>[];
            a.data = Array.isArray(data) ? data.map((d) => ({ ...d, workspaceId })) : { ...data, workspaceId };
          } else if (operation === 'upsert') {
            a.where = { ...(a.where ?? {}), workspaceId };
            a.create = { ...(a.create ?? {}), workspaceId };
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof tenantClient>;
