import { z } from 'zod';
import { PlanSchema, type Plan } from '../enums.js';
import { IdSchema, IsoDateTimeSchema, queryArray } from '../schemas/common.js';
import { parseTarget } from '../customization/fields.js';
import { DEFAULT_LABELS, ResolvedLabelsSchema, resolveLabels, type LabelOverrides } from '../customization/labels.js';
import { ActivePackSchema } from './active.js';
import {
  itemsForModes,
  PackImportMappingSchema,
  PackKeySchema,
  PackManifestSchema,
  PackMapLayerSchema,
  PackModeSchema,
  PackNavItemSchema,
  PackReportSchema,
  PackWidgetSchema,
  SemverSchema,
  type PackManifest,
} from './manifest.js';
import type { PackOp } from './planner.js';

/**
 * PACK RUNTIME AND REGISTRY (contract).
 * - Data items (objects, fields, pipelines and stages, roles, WhatsApp template suggestions, labels) are
 *   written into tenant tables by the installer (planner.ts).
 * - Runtime items (navigation, widgets, reports, import mappings, workflow templates, map layers) are read
 *   from the installed manifest version on every request and never copied into tenant tables.
 */

// ---------------------------------------------------------------- entitlement

export const WORKSPACE_PACK_STATUSES = ['active', 'uninstalled', 'failed'] as const;
export const WorkspacePackStatusSchema = z.enum(WORKSPACE_PACK_STATUSES);
export type WorkspacePackStatus = z.infer<typeof WorkspacePackStatusSchema>;

/** Why a workspace may (or may not) use a pack. Super Admin overrides beat plan entitlements. */
export const PACK_ENTITLEMENTS = ['core', 'plan', 'grant', 'none', 'revoked'] as const;
export const PackEntitlementSchema = z.enum(PACK_ENTITLEMENTS);
export type PackEntitlement = z.infer<typeof PackEntitlementSchema>;

export const PackOverrideSchema = z.enum(['grant', 'revoke']);
export type PackOverride = z.infer<typeof PackOverrideSchema>;

export function packEntitlement(input: { core: boolean; plan: Plan; plans: readonly Plan[]; override: PackOverride | null }): PackEntitlement {
  if (input.core) return 'core';
  if (input.override === 'revoke') return 'revoked';
  if (input.override === 'grant') return 'grant';
  return input.plans.includes(input.plan) ? 'plan' : 'none';
}
export const isEntitled = (e: PackEntitlement) => e === 'core' || e === 'plan' || e === 'grant';

// ---------------------------------------------------------------- company admin (Settings > Industry)

export const PackKeyParamSchema = z.object({ key: PackKeySchema });

/**
 * One pack as the company admin sees it.
 * status: available = entitled, not installed; locked = not entitled (ask Super Admin / upgrade plan);
 * active / uninstalled / failed = WorkspacePack.status. An active pack whose entitlement was revoked keeps
 * its data but is hidden from the runtime (entitlement = revoked).
 */
export const PackListItemSchema = z.object({
  key: PackKeySchema,
  name: z.string(),
  description: z.string(),
  industry: z.string(),
  icon: z.string(),
  core: z.boolean(),
  latestVersion: SemverSchema,
  installedVersion: SemverSchema.nullable(),
  status: z.enum(['available', 'locked', ...WORKSPACE_PACK_STATUSES]),
  entitlement: PackEntitlementSchema,
  modes: z.array(PackModeSchema),
  enabledModes: z.array(z.string()),
  upgradeAvailable: z.boolean(),
  /** manifestSummary() of the latest version. */
  summary: z.record(z.string(), z.number().int()),
  lastError: z.string().nullable(),
  installedAt: IsoDateTimeSchema.nullable(),
});
export type PackListItem = z.infer<typeof PackListItemSchema>;

/** Install, reinstall or change modes (idempotent). Omitted modes = current modes, or the manifest defaults. */
export const PackInstallRequestSchema = z.object({
  modes: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,30}$/)).max(10).optional(),
});
export type PackInstallRequest = z.infer<typeof PackInstallRequestSchema>;

export const PACK_ACTIONS = ['install', 'upgrade', 'uninstall', 'sync'] as const;
export const PackActionSchema = z.enum(PACK_ACTIONS);
export type PackAction = z.infer<typeof PackActionSchema>;

export const PackPlanQuerySchema = z.object({
  action: z.enum(['install', 'upgrade', 'uninstall']).default('install'),
  modes: queryArray(z.string().regex(/^[a-z][a-z0-9_]{1,30}$/)),
});

export const PackConflictSchema = z.object({
  kind: z.enum(['object', 'field', 'pipeline', 'stage', 'role']),
  key: z.string(),
  reason: z.string(),
});
export type PackConflict = z.infer<typeof PackConflictSchema>;

export const PackChangeSchema = z.object({ op: z.string(), label: z.string() });

/** Dry run (preview). Nothing is written. */
export const PackPlanResponseSchema = z.object({
  packKey: PackKeySchema,
  action: z.enum(['install', 'upgrade', 'uninstall']),
  fromVersion: SemverSchema.nullable(),
  toVersion: SemverSchema.nullable(),
  modes: z.array(z.string()),
  /** Counts by op, e.g. { "field.create": 2 }. */
  summary: z.record(z.string(), z.number().int()),
  changes: z.array(PackChangeSchema),
  conflicts: z.array(PackConflictSchema),
  /** True when the workspace already matches the manifest (re-running changes nothing). */
  noop: z.boolean(),
});
export type PackPlanResponse = z.infer<typeof PackPlanResponseSchema>;

export const PackInstallResultSchema = z.object({
  pack: PackListItemSchema,
  summary: z.record(z.string(), z.number().int()),
  conflicts: z.array(PackConflictSchema),
  noop: z.boolean(),
  logId: IdSchema,
});
export type PackInstallResult = z.infer<typeof PackInstallResultSchema>;

export const PackInstallLogSchema = z.object({
  id: IdSchema,
  packKey: PackKeySchema,
  action: PackActionSchema,
  fromVersion: SemverSchema.nullable(),
  toVersion: SemverSchema.nullable(),
  modes: z.array(z.string()),
  status: z.enum(['success', 'noop', 'failed']),
  summary: z.record(z.string(), z.number().int()),
  conflicts: z.array(PackConflictSchema),
  error: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type PackInstallLog = z.infer<typeof PackInstallLogSchema>;

// ---------------------------------------------------------------- runtime (extension points)

const packKeyShape = { packKey: PackKeySchema };
export const RuntimeNavItemSchema = PackNavItemSchema.extend(packKeyShape);
export const RuntimeWidgetSchema = PackWidgetSchema.extend(packKeyShape);
export const RuntimeReportSchema = PackReportSchema.extend(packKeyShape);
export const RuntimeImportMappingSchema = PackImportMappingSchema.extend(packKeyShape);
export const RuntimeMapLayerSchema = PackMapLayerSchema.extend(packKeyShape);
export type RuntimeNavItem = z.infer<typeof RuntimeNavItemSchema>;
export type RuntimeWidget = z.infer<typeof RuntimeWidgetSchema>;
export type RuntimeReport = z.infer<typeof RuntimeReportSchema>;
export type RuntimeImportMapping = z.infer<typeof RuntimeImportMappingSchema>;
export type RuntimeMapLayer = z.infer<typeof RuntimeMapLayerSchema>;

/** Custom objects for navigation (showInNav) and record pages. */
export const RuntimeObjectSchema = z.object({
  key: z.string(),
  labelSingular: z.string(),
  labelPlural: z.string(),
  icon: z.string(),
  showInNav: z.boolean(),
  packKey: z.string().nullable(),
});
export type RuntimeObject = z.infer<typeof RuntimeObjectSchema>;

export const PackRuntimeSchema = z.object({
  packs: z.array(ActivePackSchema),
  labels: ResolvedLabelsSchema,
  objects: z.array(RuntimeObjectSchema),
  navigation: z.array(RuntimeNavItemSchema),
  widgets: z.array(RuntimeWidgetSchema),
  reports: z.array(RuntimeReportSchema),
  importMappings: z.array(RuntimeImportMappingSchema),
  workflowTemplates: z.array(z.object({ packKey: PackKeySchema, key: z.string(), name: z.string(), description: z.string() })),
  mapLayers: z.array(RuntimeMapLayerSchema),
});
export type PackRuntime = z.infer<typeof PackRuntimeSchema>;

export interface RuntimePackInput {
  manifest: PackManifest;
  modes: readonly string[];
}

/**
 * Pure runtime builder shared by the API (GET /packs/runtime) and web mocks. Pass only ACTIVE and
 * ENTITLED packs. Archived objects must be filtered out by the caller.
 */
export function buildPackRuntime(input: { packs: readonly RuntimePackInput[]; labelOverrides?: LabelOverrides | null; objects?: readonly RuntimeObject[] }): PackRuntime {
  const rt: PackRuntime = {
    packs: [],
    labels: resolveLabels(input.labelOverrides),
    objects: [...(input.objects ?? [])],
    navigation: [],
    widgets: [],
    reports: [],
    importMappings: [],
    workflowTemplates: [],
    mapLayers: [],
  };
  for (const { manifest: m, modes } of input.packs) {
    const packKey = m.key;
    rt.packs.push({ key: packKey, version: m.version, modes: [...modes] });
    rt.navigation.push(...itemsForModes(m.navigation, modes).map((x) => ({ ...x, packKey })));
    rt.widgets.push(...itemsForModes(m.dashboardWidgets, modes).map((x) => ({ ...x, packKey })));
    rt.reports.push(...itemsForModes(m.reports, modes).map((x) => ({ ...x, packKey })));
    rt.importMappings.push(...itemsForModes(m.importMappings, modes).map((x) => ({ ...x, packKey })));
    rt.workflowTemplates.push(...itemsForModes(m.workflowTemplates, modes).map((t) => ({ packKey, key: t.key, name: t.name, description: t.description })));
    rt.mapLayers.push(...itemsForModes(m.mapLayers, modes).map((x) => ({ ...x, packKey })));
  }
  return rt;
}

/** Drop runtime items the caller has no permission for (UX only; the API also checks). */
export function runtimeForPermissions(rt: PackRuntime, permissions: readonly string[]): PackRuntime {
  const ok = (anyOf: readonly string[]) => anyOf.length === 0 || anyOf.some((p) => permissions.includes(p));
  return {
    ...rt,
    navigation: rt.navigation.filter((n) => ok(n.anyOf)),
    widgets: rt.widgets.filter((w) => ok(w.anyOf)),
    reports: rt.reports.filter((r) => ok(r.anyOf)),
  };
}

// ---------------------------------------------------------------- previews

const targetLabel = (target: string) => {
  const t = parseTarget(target);
  if (t.kind === 'object') return t.key;
  return DEFAULT_LABELS[t.entity]?.plural ?? t.entity;
};

/** Human-readable line for one planned op (install previews and logs). */
export function describeOp(op: PackOp): string {
  switch (op.op) {
    case 'object.create':
      return `Add object "${op.data.labelPlural}"`;
    case 'object.update':
      return `Update object ${op.key} (${Object.keys(op.data).join(', ')})`;
    case 'object.archive':
      return `Archive object ${op.key} (records are kept)`;
    case 'object.restore':
      return `Restore object ${op.key}`;
    case 'field.create':
      return `Add field "${op.spec.label}" to ${targetLabel(op.target)}`;
    case 'field.update':
      return `Update field ${op.key} on ${targetLabel(op.target)} (${Object.keys(op.data).join(', ')})`;
    case 'field.archive':
      return `Archive field ${op.key} on ${targetLabel(op.target)} (values are kept)`;
    case 'field.restore':
      return `Restore field ${op.key} on ${targetLabel(op.target)}`;
    case 'pipeline.create':
      return `Add pipeline "${op.name}" with ${op.stages.length} stages`;
    case 'pipeline.update':
      return `Rename pipeline ${op.key} to "${op.data.name}"`;
    case 'pipeline.archive':
      return `Archive pipeline ${op.key} (leads are kept)`;
    case 'pipeline.restore':
      return `Restore pipeline ${op.key}`;
    case 'stage.create':
      return `Add stage "${op.data.name}" to pipeline ${op.pipelineKey}`;
    case 'stage.update':
      return `Update stage ${op.key} in pipeline ${op.pipelineKey} (${Object.keys(op.data).join(', ')})`;
    case 'stage.archive':
      return `Archive empty stage ${op.key} in pipeline ${op.pipelineKey}`;
    case 'stage.restore':
      return `Restore stage ${op.key} in pipeline ${op.pipelineKey}`;
    case 'role.create':
      return `Add role "${op.data.name}"`;
    case 'role.update':
      return `Update role ${op.key} (${Object.keys(op.data).join(', ')})`;
    case 'role.archive':
      return `Archive role ${op.key}`;
    case 'role.restore':
      return `Restore role ${op.key}`;
    case 'template.create':
      return `Add WhatsApp template suggestion ${op.name} (${op.language}, draft)`;
    case 'labels.set':
      return 'Update display labels';
    case 'conflict':
      return `Skipped ${op.kind} ${op.key}: ${op.reason}`;
  }
}

export const conflictsOf = (ops: readonly PackOp[]): PackConflict[] =>
  ops.flatMap((o) => (o.op === 'conflict' ? [{ kind: o.kind, key: o.key, reason: o.reason }] : []));

// ---------------------------------------------------------------- Super Admin registry

export const PackVersionParamSchema = z.object({ key: PackKeySchema, version: SemverSchema });
export const PackCompanyParamSchema = z.object({ key: PackKeySchema, workspaceId: IdSchema });

export const SuperPackSchema = z.object({
  key: PackKeySchema,
  name: z.string(),
  description: z.string(),
  industry: z.string(),
  icon: z.string(),
  core: z.boolean(),
  latestVersion: SemverSchema,
  versions: z.array(z.object({ version: SemverSchema, checksum: z.string(), createdAt: IsoDateTimeSchema })),
  /** Plans that include the pack (core packs: every plan). */
  plans: z.array(PlanSchema),
  /** Add-on price per workspace per month in whole rupees; null = included / not sold separately. */
  priceInrMonthly: z.number().int().min(0).nullable(),
  installs: z.object({ active: z.number().int(), total: z.number().int() }),
  summary: z.record(z.string(), z.number().int()),
});
export type SuperPack = z.infer<typeof SuperPackSchema>;

export const SuperPackVersionSchema = z.object({
  key: PackKeySchema,
  version: SemverSchema,
  checksum: z.string(),
  createdAt: IsoDateTimeSchema,
  manifest: PackManifestSchema,
  summary: z.record(z.string(), z.number().int()),
});
export type SuperPackVersion = z.infer<typeof SuperPackVersionSchema>;

export const SuperPackPlansUpdateSchema = z.object({
  plans: z.array(PlanSchema),
  priceInrMonthly: z.number().int().min(0).max(1_000_000).nullable().optional(),
});

export const SuperPackCompanyUpdateSchema = z.object({
  override: PackOverrideSchema.nullable().describe('grant / revoke for this company; null = follow the plan'),
  reason: z.string().trim().min(5).max(500),
});

export const PackCompanyUsageSchema = z.object({
  workspaceId: IdSchema,
  name: z.string(),
  plan: PlanSchema,
  override: PackOverrideSchema.nullable(),
  entitlement: PackEntitlementSchema,
  status: z.enum(['not_installed', ...WORKSPACE_PACK_STATUSES]),
  installedVersion: SemverSchema.nullable(),
  modes: z.array(z.string()),
  /** Records in the pack's custom objects. */
  recordCount: z.number().int(),
});
export type PackCompanyUsage = z.infer<typeof PackCompanyUsageSchema>;

export const PackUsageSchema = z.object({
  key: PackKeySchema,
  totals: z.object({ entitled: z.number().int(), active: z.number().int(), records: z.number().int() }),
  companies: z.array(PackCompanyUsageSchema),
});
export type PackUsage = z.infer<typeof PackUsageSchema>;
