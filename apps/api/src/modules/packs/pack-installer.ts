import {
  conflictsOf,
  CorePackError,
  defaultModes,
  DEFAULT_FIELD_ACCESS,
  FieldAccessSchema,
  isEntitled,
  LabelOverridesSchema,
  packEntitlement,
  planPackInstall,
  planPackUninstall,
  SETTING_KEYS,
  summarizeOps,
  writeOps,
  type AuditActorType,
  type DataScope,
  type FieldType,
  type PackAction,
  type PackConflict,
  type PackEntitlement,
  type PackManifest,
  type PackOp,
  type PackWriteOp,
  type Plan,
  type RoleKind,
  type StageType,
  type WorkspacePackState,
} from '@vistar/shared';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { PackDefinition, Prisma, WorkspacePack } from '../../generated/prisma/client.js';
import { tenantClient } from '../../infra/prisma/tenant.js';
import { writeLabelOverrides } from '../customization/labels.store.js';
import type { TenantDb } from '../leads/lib/context.js';
import { parseOverride } from './pack-entitlement.js';
import { loadManifest, type RootPrisma } from './pack-registry.js';

/**
 * PACK INSTALLER. Plain functions taking the ROOT Prisma client so the Nest services,
 * `scripts/packs-sync.ts`, the workspace provisioner and `prisma/seed.ts` share one implementation.
 *
 *   await syncRegistry(prisma);                                        // pack-registry.ts
 *   await installPack(prisma, workspaceId, 'generic-sales', { action: 'sync' });
 *
 * Every install / upgrade / uninstall: plan with the shared planner and write ALL ops in ONE interactive
 * transaction (explicit workspaceId on every row, archive via archivedAt, never delete), then upsert
 * WorkspacePack and write PackInstallLog in the same transaction. On failure everything rolls back,
 * the failure is recorded (WorkspacePack.status = failed, failed log) and PACK_INSTALL_FAILED is thrown.
 */

export interface PackActor {
  type: AuditActorType;
  id: string | null;
  name: string | null;
}
export const SYSTEM_PACK_ACTOR: PackActor = { type: 'system', id: null, name: 'Vistar' };

export interface PackRunResult {
  packKey: string;
  action: PackAction;
  status: 'success' | 'noop';
  noop: boolean;
  fromVersion: string | null;
  toVersion: string | null;
  modes: string[];
  ops: PackOp[];
  summary: Record<string, number>;
  conflicts: PackConflict[];
  logId: string;
  workspacePack: WorkspacePack;
}

export interface InstallOptions {
  /** Enabled modes; omitted = current modes (installed packs) or the manifest defaults. */
  modes?: readonly string[];
  /** install (default; also reinstall / mode change), upgrade (to latest) or sync (packs:sync, seed). */
  action?: Extract<PackAction, 'install' | 'upgrade' | 'sync'>;
  /** Exact version to install (default: installed version for active packs on install, else latest). */
  version?: string;
  actor?: PackActor;
  /** Skip the entitlement check (platform jobs only). Core packs are always entitled. */
  skipEntitlement?: boolean;
}

const TX = { timeout: 60_000, maxWait: 15_000 } as const;
const LABELS_KEY = SETTING_KEYS.workspace.labels;

// ---------------------------------------------------------------- state

/**
 * Current workspace state for the planner, from tenant tables: objects, fields, pipelines with stages and
 * live lead counts, roles, WhatsApp templates and label overrides. `db` = tenant client (or its transaction).
 */
export async function loadPackState(db: TenantDb): Promise<WorkspacePackState> {
  const [objects, fields, pipelines, counts, roles, templates, labels] = await Promise.all([
    db.customObject.findMany({ orderBy: { createdAt: 'asc' } }),
    db.customField.findMany({ orderBy: [{ target: 'asc' }, { order: 'asc' }, { key: 'asc' }] }),
    db.pipeline.findMany({ include: { stages: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } }, orderBy: { createdAt: 'asc' } }),
    db.lead.groupBy({ by: ['stageId'], where: { deletedAt: null }, _count: { _all: true } }),
    db.role.findMany({ orderBy: { createdAt: 'asc' } }),
    db.template.findMany({ where: { channel: 'whatsapp' }, select: { id: true, name: true, language: true, packKey: true } }),
    db.setting.findFirst({ where: { scope: 'workspace', key: LABELS_KEY }, select: { value: true } }),
  ]);
  const leadCount = new Map(counts.map((c) => [c.stageId, c._count._all]));
  const labelOverrides = LabelOverridesSchema.safeParse(labels?.value ?? {});
  return {
    objects: objects.map((o) => ({
      id: o.id,
      key: o.key,
      labelSingular: o.labelSingular,
      labelPlural: o.labelPlural,
      icon: o.icon,
      description: o.description,
      primaryFieldKey: o.primaryFieldKey,
      showInNav: o.showInNav,
      packKey: o.packKey,
      archived: !!o.archivedAt,
    })),
    fields: fields.map((f) => {
      const access = FieldAccessSchema.safeParse(f.access ?? {});
      return {
        id: f.id,
        target: f.target,
        key: f.key,
        label: f.label,
        type: f.type as FieldType,
        config: f.config && typeof f.config === 'object' && !Array.isArray(f.config) ? (f.config as Record<string, unknown>) : {},
        helpText: f.helpText,
        required: f.required,
        unique: f.isUnique,
        access: access.success ? access.data : DEFAULT_FIELD_ACCESS,
        order: f.order,
        packKey: f.packKey,
        archived: !!f.archivedAt,
      };
    }),
    pipelines: pipelines.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      isDefault: p.isDefault,
      packKey: p.packKey,
      archived: !!p.archivedAt,
      stages: p.stages.map((s) => ({
        id: s.id,
        key: s.key,
        name: s.name,
        type: s.type,
        probability: s.probability,
        color: s.color,
        order: s.order,
        archived: !!s.archivedAt,
        leadCount: leadCount.get(s.id) ?? 0,
      })),
    })),
    roles: roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      kind: r.kind,
      dataScope: r.dataScope,
      permissions: [...r.permissions],
      isSystem: r.isSystem,
      packKey: r.packKey,
      archived: !!r.archivedAt,
    })),
    templates: templates.map((t) => ({ id: t.id, name: t.name, language: t.language, packKey: t.packKey })),
    labelOverrides: labelOverrides.success ? labelOverrides.data : {},
  };
}

// ---------------------------------------------------------------- writes

const json = (v: unknown) => v as Prisma.InputJsonObject;

/**
 * Execute planned write ops inside the caller's transaction. Every row carries `workspaceId` explicitly
 * (the tenant client also injects it). Nothing is deleted: removals are `archivedAt`.
 */
export async function applyPackOps(tx: TenantDb, workspaceId: string, packKey: string, ops: readonly PackWriteOp[], state: WorkspacePackState): Promise<void> {
  const now = new Date();
  const objectIds = new Map(state.objects.map((o) => [o.key, o.id]));
  const archivedAt = (archive: boolean) => (archive ? now : null);

  for (const op of ops) {
    switch (op.op) {
      case 'object.create': {
        const row = await tx.customObject.create({ data: { workspaceId, key: op.key, ...op.data, packKey } });
        objectIds.set(op.key, row.id);
        break;
      }
      case 'object.update':
        await tx.customObject.update({ where: { id: op.id, workspaceId }, data: op.data });
        break;
      case 'object.archive':
      case 'object.restore':
        await tx.customObject.update({ where: { id: op.id, workspaceId }, data: { archivedAt: archivedAt(op.op === 'object.archive') } });
        break;

      case 'field.create': {
        const objectKey = op.target.startsWith('object:') ? op.target.slice('object:'.length) : null;
        const customObjectId = objectKey ? objectIds.get(objectKey) : null;
        if (objectKey && !customObjectId) throw new Error(`Object ${objectKey} missing for field ${op.key}`);
        await tx.customField.create({
          data: {
            workspaceId,
            target: op.target,
            customObjectId: customObjectId ?? null,
            key: op.key,
            label: op.spec.label,
            type: op.spec.type,
            config: json(op.spec.config),
            access: json(op.spec.access),
            helpText: op.spec.helpText ?? null,
            required: op.spec.required,
            isUnique: op.spec.unique,
            order: op.order,
            packKey,
          },
        });
        break;
      }
      case 'field.update': {
        const { unique, config, access, ...rest } = op.data;
        await tx.customField.update({
          where: { id: op.id, workspaceId },
          data: {
            ...rest,
            ...(unique !== undefined ? { isUnique: unique } : {}),
            ...(config !== undefined ? { config: json(config) } : {}),
            ...(access !== undefined ? { access: json(access) } : {}),
          },
        });
        break;
      }
      case 'field.archive':
      case 'field.restore':
        await tx.customField.update({ where: { id: op.id, workspaceId }, data: { archivedAt: archivedAt(op.op === 'field.archive') } });
        break;

      case 'pipeline.create': {
        const p = await tx.pipeline.create({ data: { workspaceId, key: op.key, name: op.name, isDefault: op.isDefault, packKey } });
        await tx.stage.createMany({
          data: op.stages.map((s) => ({
            workspaceId,
            pipelineId: p.id,
            key: s.key,
            name: s.name,
            type: s.type as StageType,
            probability: s.probability,
            color: s.color,
            order: s.order,
          })),
        });
        break;
      }
      case 'pipeline.update':
        await tx.pipeline.update({ where: { id: op.id, workspaceId }, data: { name: op.data.name } });
        break;
      case 'pipeline.archive':
      case 'pipeline.restore':
        await tx.pipeline.update({ where: { id: op.id, workspaceId }, data: { archivedAt: archivedAt(op.op === 'pipeline.archive') } });
        break;

      case 'stage.create':
        await tx.stage.create({
          data: { workspaceId, pipelineId: op.pipelineId, key: op.key, name: op.data.name, type: op.data.type, probability: op.data.probability, color: op.data.color, order: op.order },
        });
        break;
      case 'stage.update':
        await tx.stage.update({ where: { id: op.id, workspaceId }, data: op.data });
        break;
      case 'stage.archive':
      case 'stage.restore':
        await tx.stage.update({ where: { id: op.id, workspaceId }, data: { archivedAt: archivedAt(op.op === 'stage.archive') } });
        break;

      case 'role.create':
        await tx.role.create({
          data: {
            workspaceId,
            key: op.key,
            name: op.data.name,
            kind: op.data.kind as RoleKind,
            dataScope: op.data.dataScope as DataScope,
            permissions: [...op.data.permissions],
            isSystem: false,
            packKey,
          },
        });
        break;
      case 'role.update':
        await tx.role.update({ where: { id: op.id, workspaceId }, data: { ...op.data, ...(op.data.permissions ? { permissions: [...op.data.permissions] } : {}) } });
        break;
      case 'role.archive':
      case 'role.restore':
        await tx.role.update({ where: { id: op.id, workspaceId }, data: { archivedAt: archivedAt(op.op === 'role.archive') } });
        break;

      case 'template.create':
        // Suggestions only: sendable after provider approval.
        await tx.template.create({
          data: {
            workspaceId,
            channel: 'whatsapp',
            name: op.name,
            language: op.language,
            category: op.data.category as Prisma.TemplateCreateInput['category'],
            status: 'draft',
            body: op.data.body,
            variables: [...op.data.variables],
            packKey,
          },
        });
        break;

      case 'labels.set':
        await writeLabelOverrides(tx, workspaceId, op.overrides);
        break;
    }
  }
}

// ---------------------------------------------------------------- context

export interface PackContext {
  def: PackDefinition & { entitlements: Array<{ plan: Plan }> };
  plan: Plan;
  row: WorkspacePack | null;
  entitlement: PackEntitlement;
  db: ReturnType<typeof tenantClient>;
}

/** Registry definition, workspace plan, WorkspacePack row and entitlement for one pack in one workspace. */
export async function packContext(prisma: RootPrisma, workspaceId: string, packKey: string): Promise<PackContext> {
  const [def, ws] = await Promise.all([
    prisma.packDefinition.findUnique({ where: { key: packKey }, include: { entitlements: { select: { plan: true } } } }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { plan: true } }),
  ]);
  if (!def) throw notFound('Pack');
  if (!ws) throw notFound('Workspace');
  const db = tenantClient(prisma, workspaceId);
  const row = await db.workspacePack.findUnique({ where: { workspaceId_packKey: { workspaceId, packKey } } });
  const entitlement = packEntitlement({ core: def.core, plan: ws.plan, plans: def.entitlements.map((e) => e.plan), override: parseOverride(row?.platformOverride) });
  return { def, plan: ws.plan, row, entitlement, db };
}

/** The pack was uninstalled (also when a later reinstall attempt failed). */
export function wasUninstalled(row: WorkspacePack | null): boolean {
  if (!row) return false;
  if (row.status === 'uninstalled') return true;
  return row.status === 'failed' && !!row.uninstalledAt && (!row.installedAt || row.uninstalledAt >= row.installedAt);
}

/** Modes for an install: requested (validated), else current modes, else manifest defaults. */
export function resolveModes(manifest: PackManifest, requested: readonly string[] | undefined, row: WorkspacePack | null): string[] {
  const known = new Set(manifest.modes.map((m) => m.key));
  if (requested) {
    const unknown = requested.filter((m) => !known.has(m));
    if (unknown.length) {
      throw new AppException('VALIDATION_FAILED', `Unknown mode: ${unknown.join(', ')}`, { details: unknown.map((m) => ({ path: 'modes', message: `Unknown mode "${m}"` })) });
    }
    return [...new Set(requested)];
  }
  if (row?.installedVersion) return row.modes.filter((m) => known.has(m));
  return defaultModes(manifest);
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Install target version: the installed one for active packs (mode change / repair), else the latest. */
function targetVersion(ctx: PackContext, opts: InstallOptions): string {
  if (opts.version) return opts.version;
  const action = opts.action ?? 'install';
  if (action === 'install' && ctx.row?.status === 'active' && ctx.row.installedVersion) return ctx.row.installedVersion;
  return ctx.def.latestVersion;
}

export interface InstallPlanInput {
  manifest: PackManifest;
  previous: PackManifest | null;
  previousModes: string[];
  modes: string[];
  reinstall: boolean;
}

/** Resolve what an install / upgrade / sync would apply (no writes). */
export async function installInput(prisma: RootPrisma, ctx: PackContext, opts: InstallOptions): Promise<InstallPlanInput> {
  const version = targetVersion(ctx, opts);
  const manifest = await loadManifest(prisma, ctx.def.key, version);
  const installed = ctx.row?.installedVersion ?? null;
  const previous = installed ? await loadManifest(prisma, ctx.def.key, installed) : null;
  return {
    manifest,
    previous,
    previousModes: installed ? [...(ctx.row?.modes ?? [])] : [],
    modes: resolveModes(manifest, opts.modes, ctx.row),
    reinstall: wasUninstalled(ctx.row),
  };
}

// ---------------------------------------------------------------- execute

const errorLabel = (err: unknown) => {
  const e = err as { name?: string; code?: string };
  // Prisma messages embed query values: store only the error class and code.
  return `${e?.name ?? 'Error'}${e?.code ? ` ${e.code}` : ''}`.slice(0, 200);
};

async function recordFailure(
  db: ReturnType<typeof tenantClient>,
  workspaceId: string,
  packKey: string,
  log: { action: PackAction; fromVersion: string | null; toVersion: string | null; modes: string[]; actor: PackActor; error: string },
): Promise<void> {
  await db.$transaction([
    db.workspacePack.upsert({
      where: { workspaceId_packKey: { workspaceId, packKey } },
      create: { workspaceId, packKey, status: 'failed', modes: log.modes, lastError: log.error },
      update: { status: 'failed', lastError: log.error },
    }),
    db.packInstallLog.create({
      data: {
        workspaceId,
        packKey,
        action: log.action,
        fromVersion: log.fromVersion,
        toVersion: log.toVersion,
        modes: log.modes,
        status: 'failed',
        error: log.error,
        actorType: log.actor.type,
        actorId: log.actor.id,
        actorName: log.actor.name,
      },
    }),
  ]);
}

interface ExecuteRequest {
  action: PackAction;
  manifest: PackManifest;
  /** Planner input for install-like actions; null = uninstall. */
  install: InstallPlanInput | null;
  actor: PackActor;
  /** Called on failure (scripts print, the API logs). Never receives PII. */
  onError?: (message: string) => void;
}

/**
 * Plan + write in ONE interactive transaction (advisory lock per workspace + pack), then upsert
 * WorkspacePack and write the PackInstallLog. Failure: rollback, record failure, PACK_INSTALL_FAILED.
 */
export async function executePlan(prisma: RootPrisma, workspaceId: string, packKey: string, req: ExecuteRequest): Promise<PackRunResult> {
  const db = tenantClient(prisma, workspaceId);
  const uninstall = req.install === null;
  const before = await db.workspacePack.findUnique({ where: { workspaceId_packKey: { workspaceId, packKey } } });
  const fromVersion = before?.installedVersion ?? null;
  const toVersion = uninstall ? null : req.manifest.version;
  const modes = req.install?.modes ?? [...(before?.modes ?? [])];
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pack:${workspaceId}:${packKey}`}))`;
      const state = await loadPackState(tx);
      const ops = req.install
        ? planPackInstall(state, req.manifest, { modes, previous: req.install.previous, previousModes: req.install.previousModes, reinstall: req.install.reinstall })
        : planPackUninstall(state, req.manifest);
      const writes = writeOps(ops);
      await applyPackOps(tx, workspaceId, packKey, writes, state);

      const now = new Date();
      const current = await tx.workspacePack.findUnique({ where: { workspaceId_packKey: { workspaceId, packKey } } });
      let unchanged: boolean;
      let data: Prisma.WorkspacePackUncheckedUpdateInput;
      if (uninstall) {
        unchanged = current?.status === 'uninstalled';
        data = { status: 'uninstalled', lastError: null, ...(unchanged ? {} : { uninstalledAt: now }) };
      } else {
        const sameVersion = current?.installedVersion === req.manifest.version;
        unchanged = current?.status === 'active' && sameVersion && sameSet(current.modes, modes);
        data = {
          status: 'active',
          installedVersion: req.manifest.version,
          modes,
          lastError: null,
          ...(current?.status === 'active' && sameVersion ? {} : { installedAt: now }),
        };
      }
      const noop = writes.length === 0 && unchanged;
      const workspacePack = await tx.workspacePack.upsert({
        where: { workspaceId_packKey: { workspaceId, packKey } },
        create: {
          ...(data as Omit<Prisma.WorkspacePackUncheckedCreateInput, 'workspaceId' | 'packKey'>),
          workspaceId,
          packKey,
          modes,
          ...(uninstall ? {} : { installedAt: now }),
        },
        update: data,
      });
      const summary = summarizeOps(ops);
      const conflicts = conflictsOf(ops);
      const log = await tx.packInstallLog.create({
        data: {
          workspaceId,
          packKey,
          action: req.action,
          fromVersion,
          toVersion,
          modes,
          status: noop ? 'noop' : 'success',
          summary,
          conflicts: conflicts as unknown as Prisma.InputJsonArray,
          actorType: req.actor.type,
          actorId: req.actor.id,
          actorName: req.actor.name,
        },
      });
      return { packKey, action: req.action, status: noop ? 'noop' : 'success', noop, fromVersion, toVersion, modes, ops, summary, conflicts, logId: log.id, workspacePack } satisfies PackRunResult;
    }, TX);
  } catch (err) {
    if (err instanceof CorePackError) throw new AppException('PACK_CORE_LOCKED', `${req.manifest.name} is a core pack and cannot be uninstalled`);
    const error = errorLabel(err);
    req.onError?.(`Pack ${packKey} ${req.action} failed in workspace ${workspaceId}: ${error}`);
    try {
      await recordFailure(db, workspaceId, packKey, { action: req.action, fromVersion, toVersion, modes, actor: req.actor, error });
    } catch (logErr) {
      req.onError?.(`Recording the failure also failed: ${errorLabel(logErr)}`);
    }
    const verb = uninstall ? 'uninstall' : req.action === 'upgrade' ? 'upgrade' : 'install';
    throw new AppException('PACK_INSTALL_FAILED', `Could not ${verb} ${req.manifest.name}. Nothing was changed. Try again or contact support.`, { cause: err });
  }
}

/** Install, reinstall, change modes, upgrade or sync a pack (idempotent). */
export async function installPack(prisma: RootPrisma, workspaceId: string, packKey: string, opts: InstallOptions & { onError?: (m: string) => void } = {}): Promise<PackRunResult> {
  const ctx = await packContext(prisma, workspaceId, packKey);
  if (!opts.skipEntitlement && !isEntitled(ctx.entitlement)) {
    throw new AppException('PACK_NOT_ENTITLED', `${ctx.def.name} is not included in your plan. Ask Vistar to enable it for your company.`);
  }
  const input = await installInput(prisma, ctx, opts);
  return executePlan(prisma, workspaceId, packKey, { action: opts.action ?? 'install', manifest: input.manifest, install: input, actor: opts.actor ?? SYSTEM_PACK_ACTOR, onError: opts.onError });
}

/** Uninstall: archives what the pack owns, reverts its labels, keeps all user data. Always allowed (except core packs). */
export async function uninstallPack(prisma: RootPrisma, workspaceId: string, packKey: string, opts: { actor?: PackActor; onError?: (m: string) => void } = {}): Promise<PackRunResult> {
  const ctx = await packContext(prisma, workspaceId, packKey);
  if (ctx.def.core) throw new AppException('PACK_CORE_LOCKED', `${ctx.def.name} is a core pack and cannot be uninstalled`);
  if (!ctx.row?.installedVersion) throw new AppException('CONFLICT', `${ctx.def.name} is not installed`);
  const manifest = await loadManifest(prisma, packKey, ctx.row.installedVersion);
  return executePlan(prisma, workspaceId, packKey, { action: 'uninstall', manifest, install: null, actor: opts.actor ?? SYSTEM_PACK_ACTOR, onError: opts.onError });
}
