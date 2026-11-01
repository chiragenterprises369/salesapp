import { PrismaPg } from '@prisma/adapter-pg';
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLE_SCOPE,
  ROLE_KIND_LABELS,
  ROLE_KINDS,
  SYSTEM_ROLE_KEYS,
  type RoleKind,
  type WorkspacePackState,
} from '@vistar/shared';
import { randomBytes } from 'node:crypto';
import { getEnv } from '../../config/env.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Helpers for specs that run against the shared dev database (temp workspaces only; never seeded companies).
 * Not used by application code.
 */

export const newTestPrisma = (): PrismaClient => new PrismaClient({ adapter: new PrismaPg({ connectionString: getEnv().DATABASE_URL }) });

export const testSuffix = (): string => randomBytes(4).toString('hex');

/** Workspace + the four system roles, nothing else (no pipeline, templates or users). */
export async function createBareWorkspace(prisma: PrismaClient, slugPrefix: string): Promise<{ id: string; slug: string; roles: Map<RoleKind, string> }> {
  const slug = `${slugPrefix}-${testSuffix()}`;
  const ws = await prisma.workspace.create({ data: { name: `Test ${slug}`, slug, businessHours: DEFAULT_BUSINESS_HOURS, holidays: [], status: 'trial', plan: 'free' } });
  const rows = await prisma.role.createManyAndReturn({
    data: ROLE_KINDS.map((kind) => ({
      workspaceId: ws.id,
      key: SYSTEM_ROLE_KEYS[kind],
      name: ROLE_KIND_LABELS[kind],
      kind,
      dataScope: DEFAULT_ROLE_SCOPE[kind],
      permissions: DEFAULT_ROLE_PERMISSIONS[kind],
      isSystem: true,
    })),
    select: { id: true, kind: true },
  });
  return { id: ws.id, slug, roles: new Map(rows.map((r) => [r.kind, r.id])) };
}

/** Delete a temp workspace and everything in it (leads and users first: their FKs are RESTRICT). */
export async function deleteTestWorkspace(prisma: PrismaClient, workspaceId: string): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { slug: true } });
  if (!ws) return;
  if (!/^test-/.test(ws.slug)) throw new Error(`Refusing to delete non-test workspace ${ws.slug}`);
  await prisma.$transaction([
    prisma.lead.deleteMany({ where: { workspaceId } }),
    prisma.user.deleteMany({ where: { workspaceId } }),
    prisma.workspace.delete({ where: { id: workspaceId } }),
  ]);
}

const by = <T>(key: (x: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));

/** Planner state without generated ids and live counts, sorted by stable keys (compare executor vs applyPlanToState). */
export function comparableState(s: WorkspacePackState) {
  return {
    objects: s.objects.map(({ id: _id, ...o }) => o).sort(by((o) => o.key)),
    fields: s.fields.map(({ id: _id, ...f }) => f).sort(by((f) => `${f.target}.${f.key}`)),
    pipelines: s.pipelines
      .map(({ id: _id, stages, ...p }) => ({ ...p, stages: stages.map(({ id: _sid, leadCount: _n, ...st }) => st).sort(by((st) => st.key)) }))
      .sort(by((p) => p.key)),
    roles: s.roles.map(({ id: _id, permissions, ...r }) => ({ ...r, permissions: [...permissions].sort() })).sort(by((r) => r.key)),
    templates: s.templates.map(({ id: _id, ...t }) => t).sort(by((t) => `${t.name}:${t.language}`)),
    labelOverrides: s.labelOverrides,
  };
}
