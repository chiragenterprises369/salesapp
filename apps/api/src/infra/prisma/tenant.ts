import { AppException } from '../../common/errors/app-exception.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Tenant-scoped Prisma client. Injects `workspaceId` into every query's `where` and every create's
 * `data`, so a forgotten filter cannot leak data across workspaces.
 *
 * Rules (enforced in review and tenant-isolation tests):
 * - Use UNCHECKED inputs: set scalar foreign keys (`ownerId`, `stageId`), not `{ connect }`.
 * - Foreign-key ids that come from user input MUST be checked with `assertInTenant()` first
 *   (a row could otherwise point at another workspace's stage/role/user).
 * - Nested writes are NOT scoped automatically: pass `workspaceId` explicitly in nested `create`.
 * - `$queryRaw` / `$executeRaw` bypass this: always filter by "workspaceId" yourself.
 * - `workspaceId` can never be changed by an update (it is stripped from update data).
 * - Workspace: reads/updates are pinned to the caller's workspace; create/delete are rejected.
 * - Platform tables (PlatformAdmin, PlatformSession, PlatformAuditLog, PlanDefinition, PackDefinition,
 *   PackVersion, PackPlanEntitlement) throw.
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
const UPDATE_OPS = new Set(['update', 'updateMany', 'updateManyAndReturn']);
const WORKSPACE_ALLOWED_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'update']);
const PLATFORM_MODELS = new Set(['PlatformAdmin', 'PlatformSession', 'PlatformAuditLog', 'PlanDefinition', 'PackDefinition', 'PackVersion', 'PackPlanEntitlement']);

type AnyArgs = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

function stripWorkspaceId<T>(data: T): T {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const { workspaceId: _ignored, workspace: _rel, ...rest } = data as Record<string, unknown>;
  return rest as T;
}

export function tenantClient(prisma: PrismaClient, workspaceId: string) {
  if (!workspaceId) throw new Error('tenantClient requires a workspaceId');
  return prisma.$extends({
    name: 'tenant',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (PLATFORM_MODELS.has(model)) {
            throw new Error(`${model} is a platform table; use the root PrismaService, not forTenant()`);
          }
          const a = { ...(args as AnyArgs) };

          if (model === 'Workspace') {
            if (!WORKSPACE_ALLOWED_OPS.has(operation)) throw new Error(`Workspace.${operation} is not allowed through the tenant client`);
            a.where = { ...(a.where ?? {}), id: workspaceId };
            if (operation === 'update') a.data = stripWorkspaceId(a.data);
            return query(a as typeof args);
          }

          if (WHERE_OPS.has(operation)) a.where = { ...(a.where ?? {}), workspaceId };
          if (UPDATE_OPS.has(operation)) a.data = stripWorkspaceId(a.data);
          if (operation === 'create') {
            a.data = { ...(a.data as Record<string, unknown>), workspaceId };
          } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const data = a.data as Record<string, unknown> | Record<string, unknown>[];
            a.data = Array.isArray(data) ? data.map((d) => ({ ...d, workspaceId })) : { ...data, workspaceId };
          } else if (operation === 'upsert') {
            a.where = { ...(a.where ?? {}), workspaceId };
            a.create = { ...(a.create ?? {}), workspaceId };
            a.update = stripWorkspaceId(a.update ?? {});
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof tenantClient>;

type CountDelegate = { count: (args: { where: Record<string, unknown> }) => Promise<number> };

/**
 * Verify that every referenced id belongs to the tenant before writing it as a foreign key.
 * Usage: `await assertInTenant(db, { stage: body.stageId, user: body.ownerId })`
 * Throws NOT_FOUND (never reveals that the id exists in another workspace).
 */
export async function assertInTenant(
  db: TenantPrisma,
  refs: Partial<Record<'user' | 'role' | 'team' | 'stage' | 'pipeline' | 'lead' | 'contact' | 'company' | 'workflow' | 'template' | 'webhookEndpoint' | 'customObject' | 'customRecord', string | null | undefined>>,
): Promise<void> {
  const delegates = db as unknown as Record<string, CountDelegate>;
  await Promise.all(
    Object.entries(refs).map(async ([model, id]) => {
      if (!id) return;
      const found = await delegates[model]!.count({ where: { id } });
      if (found !== 1) throw new AppException('NOT_FOUND', `${model} not found`);
    }),
  );
}
