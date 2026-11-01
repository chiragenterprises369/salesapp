import { z } from 'zod';
import { DataScopeSchema, RoleKindSchema, StageTypeSchema, TemplateCategorySchema } from '../enums.js';
import { PermissionSchema } from '../rbac.js';
import { HexColorSchema } from '../schemas/common.js';
import { FieldKeySchema, FieldSpecSchema, FieldTargetSchema, ObjectKeySchema, RoleKeyRefSchema } from '../customization/fields.js';
import { LabelOverridesSchema } from '../customization/labels.js';
import { validateGraph, WorkflowGraphSchema, type WorkflowGraph } from '../workflow/graph.js';

/**
 * PACK MANIFEST (contract, JSON, versioned). A pack only ADDS data definitions and screens.
 * Installing = applying the manifest to a workspace with `planPackInstall` (idempotent, upgradeable,
 * removable without deleting user data). Files live in `packs/<key>/manifest.json`.
 */
export const PACK_SCHEMA_VERSION = 1 as const;
export const PackKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, { error: 'Pack keys use lowercase letters, digits and -' });
export const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, { error: 'Use a semantic version like 1.2.0' });
const ItemKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/);
const ModeKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,30}$/);
/** Item applies only when one of these modes is enabled at activation (omit = always). */
const modes = z.array(ModeKeySchema).optional();

/** Where pack widgets render. */
export const WIDGET_SLOTS = ['dashboard.main', 'dashboard.side', 'lead.detail', 'teamfloor.side', 'employee.home'] as const;
export const WidgetSlotSchema = z.enum(WIDGET_SLOTS);
export type WidgetSlot = z.infer<typeof WidgetSlotSchema>;

export const NAV_GROUP_IDS = ['work', 'automate', 'team', 'insights', 'admin'] as const;
/** Code-backed UI component id: "<packKey>.<Name>", resolved by the web pack UI registry. */
const ComponentIdSchema = z.string().regex(/^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*$/);

export const PackModeSchema = z.object({ key: ModeKeySchema, label: z.string().min(1).max(40), description: z.string().max(200).optional(), default: z.boolean().default(false) });

export const PackObjectSchema = z.object({
  key: ObjectKeySchema,
  labelSingular: z.string().min(1).max(40),
  labelPlural: z.string().min(1).max(40),
  icon: z.string().max(40).default('Box'),
  description: z.string().max(300).optional(),
  primaryFieldKey: FieldKeySchema,
  showInNav: z.boolean().default(false).describe('Packs usually provide their own pages instead'),
  fields: z.array(FieldSpecSchema).min(1).max(150),
  modes,
});
export const PackFieldSchema = z.object({
  target: FieldTargetSchema.describe('Core entity, or object:<key> of an object in this manifest'),
  field: FieldSpecSchema,
  modes,
});
export const PackStageSchema = z.object({
  key: ItemKeySchema,
  name: z.string().min(1).max(40),
  type: StageTypeSchema,
  probability: z.number().int().min(0).max(100),
  color: HexColorSchema.nullable().optional(),
});
export const PackPipelineSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  name: z.string().min(1).max(40),
  /** Becomes the workspace default only if no active default pipeline exists. */
  isDefault: z.boolean().default(false),
  stages: z.array(PackStageSchema).min(2).max(30),
  modes,
});
export const PackRoleSchema = z.object({
  key: RoleKeyRefSchema,
  name: z.string().min(1).max(60),
  kind: RoleKindSchema,
  dataScope: DataScopeSchema,
  permissions: z.array(PermissionSchema),
  modes,
});
export const PackWorkflowTemplateSchema = z.object({
  key: ItemKeySchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  graph: WorkflowGraphSchema,
  modes,
});
export const PackWhatsappTemplateSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]{1,60}$/),
  category: TemplateCategorySchema,
  language: z.string().default('en'),
  body: z.string().min(1).max(1024),
  variables: z.array(z.string()).default([]),
  modes,
});
export const PackWidgetSchema = z.object({
  key: ItemKeySchema,
  title: z.string().min(1).max(60),
  slot: WidgetSlotSchema,
  component: ComponentIdSchema,
  size: z.enum(['sm', 'md', 'lg', 'full']).default('md'),
  anyOf: z.array(PermissionSchema).default([]),
  modes,
});
export const PackReportSchema = z.object({
  key: ItemKeySchema,
  title: z.string().min(1).max(80),
  description: z.string().max(300).default(''),
  component: ComponentIdSchema,
  anyOf: z.array(PermissionSchema).default([]),
  modes,
});
export const PackImportMappingSchema = z.object({
  key: ItemKeySchema,
  name: z.string().min(1).max(80),
  /** e.g. "indiamart", "99acres", "magicbricks" */
  source: z.string().min(1).max(40),
  target: FieldTargetSchema.default('lead'),
  fields: z.array(
    z.object({
      from: z.string().min(1).max(120).describe('Column name or JSON path in the source'),
      to: z.string().regex(/^([a-zA-Z]+|custom\.[a-z][a-z0-9_]*)$/).describe('Lead field (LEAD_IMPORT_FIELDS) or custom.<key>'),
      transform: z.enum(['none', 'trim', 'lower', 'phone_in', 'number']).default('none'),
    }),
  ),
  defaults: z.record(z.string(), z.string()).default({}),
  modes,
});
export const PackNavItemSchema = z.object({
  id: ItemKeySchema,
  label: z.string().min(1).max(40),
  icon: z.string().max(40),
  /** Page slug under /app/x/<packKey>/ (company) or /me/x/<packKey>/ (employee). */
  page: z.string().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/),
  group: z.enum(NAV_GROUP_IDS),
  panels: z.array(z.enum(['company', 'employee'])).min(1).default(['company']),
  anyOf: z.array(PermissionSchema).default([]),
  component: ComponentIdSchema,
  modes,
});
export const PackMapLayerSchema = z.object({
  key: ItemKeySchema,
  title: z.string().min(1).max(60),
  source: z.string().regex(/^object:[a-z][a-z0-9_]{1,39}$/),
  geoField: FieldKeySchema,
  polygonField: FieldKeySchema.optional(),
  style: z.record(z.string(), z.unknown()).default({}),
  modes,
});

export const PackManifestSchema = z
  .object({
    schemaVersion: z.literal(PACK_SCHEMA_VERSION),
    key: PackKeySchema,
    name: z.string().min(1).max(60),
    version: SemverSchema,
    description: z.string().max(500),
    industry: z.string().min(1).max(40),
    icon: z.string().max(40).default('Package'),
    /** Core packs are installed in every workspace and cannot be uninstalled. */
    core: z.boolean().default(false),
    minCoreVersion: SemverSchema.optional(),
    modes: z.array(PackModeSchema).default([]),
    labels: LabelOverridesSchema.default({}),
    objects: z.array(PackObjectSchema).default([]),
    fields: z.array(PackFieldSchema).default([]),
    pipelines: z.array(PackPipelineSchema).default([]),
    roles: z.array(PackRoleSchema).default([]),
    workflowTemplates: z.array(PackWorkflowTemplateSchema).default([]),
    whatsappTemplates: z.array(PackWhatsappTemplateSchema).default([]),
    dashboardWidgets: z.array(PackWidgetSchema).default([]),
    reports: z.array(PackReportSchema).default([]),
    importMappings: z.array(PackImportMappingSchema).default([]),
    navigation: z.array(PackNavItemSchema).default([]),
    mapLayers: z.array(PackMapLayerSchema).default([]),
  })
  .superRefine((m, ctx) => {
    const dup = (path: string, keys: string[]) => {
      const seen = new Set<string>();
      for (const k of keys) {
        if (seen.has(k)) ctx.addIssue({ code: 'custom', path: [path], message: `Duplicate key "${k}"` });
        seen.add(k);
      }
    };
    dup('objects', m.objects.map((o) => o.key));
    dup('fields', m.fields.map((f) => `${f.target}.${f.field.key}`));
    dup('pipelines', m.pipelines.map((p) => p.key));
    dup('roles', m.roles.map((r) => r.key));
    dup('workflowTemplates', m.workflowTemplates.map((t) => t.key));
    dup('whatsappTemplates', m.whatsappTemplates.map((t) => `${t.name}:${t.language}`));
    dup('dashboardWidgets', m.dashboardWidgets.map((w) => w.key));
    dup('reports', m.reports.map((r) => r.key));
    dup('importMappings', m.importMappings.map((r) => r.key));
    dup('navigation', m.navigation.map((n) => n.id));
    dup('mapLayers', m.mapLayers.map((l) => l.key));
    const modeKeys = new Set(m.modes.map((x) => x.key));
    const objectKeys = new Set(m.objects.map((o) => o.key));
    const knownTarget = (t: string) => !t.startsWith('object:') || objectKeys.has(t.slice(7));

    m.objects.forEach((o, i) => {
      dup(`objects.${i}.fields`, o.fields.map((f) => f.key));
      const primary = o.fields.find((f) => f.key === o.primaryFieldKey);
      if (!primary || primary.type !== 'text') ctx.addIssue({ code: 'custom', path: ['objects', i, 'primaryFieldKey'], message: 'Title field must be a text field of the object' });
    });
    const relationTargets: Array<[string, (string | number)[]]> = [];
    m.objects.forEach((o, i) =>
      o.fields.forEach((f, j) => {
        if (f.type === 'relation') relationTargets.push([f.config.target, ['objects', i, 'fields', j, 'config', 'target']]);
      }),
    );
    m.fields.forEach((f, i) => {
      if (!knownTarget(f.target)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'target'], message: `Unknown object "${f.target}"` });
      if (f.field.type === 'relation') relationTargets.push([f.field.config.target, ['fields', i, 'field', 'config', 'target']]);
    });
    for (const [t, path] of relationTargets) if (!knownTarget(t)) ctx.addIssue({ code: 'custom', path, message: `Relation to unknown object "${t}"` });
    m.mapLayers.forEach((l, i) => {
      const obj = m.objects.find((o) => `object:${o.key}` === l.source);
      if (!obj) ctx.addIssue({ code: 'custom', path: ['mapLayers', i, 'source'], message: `Unknown object "${l.source}"` });
      else if (!obj.fields.some((f) => f.key === l.geoField && f.type === 'geo_point'))
        ctx.addIssue({ code: 'custom', path: ['mapLayers', i, 'geoField'], message: 'geoField must be a geo_point field of the object' });
    });
    m.workflowTemplates.forEach((t, i) => {
      const issues = validateGraph(t.graph as WorkflowGraph, { aiEnabled: true }).filter((x) => x.severity === 'error');
      if (issues.length) ctx.addIssue({ code: 'custom', path: ['workflowTemplates', i, 'graph'], message: issues[0]!.message });
    });
    const items = [
      ...m.objects, ...m.fields, ...m.pipelines, ...m.roles, ...m.workflowTemplates, ...m.whatsappTemplates,
      ...m.dashboardWidgets, ...m.reports, ...m.importMappings, ...m.navigation, ...m.mapLayers,
    ] as Array<{ modes?: string[] }>;
    for (const it of items) for (const mode of it.modes ?? []) if (!modeKeys.has(mode)) ctx.addIssue({ code: 'custom', path: ['modes'], message: `Unknown mode "${mode}"` });
    for (const w of [...m.dashboardWidgets, ...m.reports, ...m.navigation]) {
      if (!w.component.startsWith(`${m.key}.`)) ctx.addIssue({ code: 'custom', path: ['component'], message: `Component "${w.component}" must start with "${m.key}."` });
    }
  });

export type PackManifest = z.output<typeof PackManifestSchema>;
export type PackManifestInput = z.input<typeof PackManifestSchema>;
export type PackNavItem = z.output<typeof PackNavItemSchema>;
export type PackWidget = z.output<typeof PackWidgetSchema>;
export type PackReport = z.output<typeof PackReportSchema>;
export type PackImportMapping = z.output<typeof PackImportMappingSchema>;
export type PackMapLayer = z.output<typeof PackMapLayerSchema>;

/** Items of the manifest that apply for the enabled modes. */
export function itemsForModes<T extends { modes?: string[] }>(items: readonly T[], enabled: readonly string[]): T[] {
  return items.filter((i) => !i.modes || i.modes.length === 0 || i.modes.some((m) => enabled.includes(m)));
}

/** Default modes for activation: the manifest's `default` modes (all modes if none is marked). */
export function defaultModes(m: Pick<PackManifest, 'modes'>): string[] {
  const d = m.modes.filter((x) => x.default).map((x) => x.key);
  return d.length ? d : m.modes.map((x) => x.key);
}

/** Compare semantic versions (numeric parts only). */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('-')[0]!.split('.').map(Number);
  const pb = b.split('-')[0]!.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Item counts for registry previews. */
export function manifestSummary(m: PackManifest): Record<string, number> {
  return {
    objects: m.objects.length,
    fields: m.fields.length + m.objects.reduce((n, o) => n + o.fields.length, 0),
    pipelines: m.pipelines.length,
    stages: m.pipelines.reduce((n, p) => n + p.stages.length, 0),
    roles: m.roles.length,
    workflowTemplates: m.workflowTemplates.length,
    whatsappTemplates: m.whatsappTemplates.length,
    dashboardWidgets: m.dashboardWidgets.length,
    reports: m.reports.length,
    importMappings: m.importMappings.length,
    navigation: m.navigation.length,
    mapLayers: m.mapLayers.length,
  };
}
