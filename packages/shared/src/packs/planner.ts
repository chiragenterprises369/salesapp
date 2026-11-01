import type { DataScope, RoleKind, StageType } from '../enums.js';
import { parseTarget, type FieldAccess, type FieldSpec, type FieldType } from '../customization/fields.js';
import type { LabelKey, LabelOverrides } from '../customization/labels.js';
import { itemsForModes, type PackManifest } from './manifest.js';

/**
 * PACK INSTALL PLANNER (contract, pure). The API loads the workspace's current state, calls
 * `planPackInstall` / `planPackUninstall`, then executes the ops in ONE transaction.
 *
 * Rules (tested):
 * - Idempotent: planning again on the resulting state yields no write ops.
 * - Items are matched by stable keys; only rows with `packKey === manifest.key` are touched.
 *   Same key owned by another pack or by the workspace -> `conflict` op (reported, nothing written).
 * - Upgrades are three-way: a property changes only if the manifest changed it between versions AND
 *   the workspace did not edit it (current === previous manifest value). Admin edits win.
 * - Desired set = manifest items for the enabled modes. Owned items outside it are archived (never deleted).
 *   Stages that still hold leads are kept (conflict) instead of archived.
 * - Admin removals win too: an owned item the previous install already delivered that is now missing or
 *   archived stays that way (no re-create / restore) unless the pack is being reinstalled. Items the pack
 *   itself archived (mode turned off, removed in an earlier version) are restored when desired again.
 *   When an existing pipeline is adopted on first install (migration), missing stages are not re-created.
 * - Uninstall archives everything the pack owns and reverts its labels. User data stays.
 */

export interface InstalledObject {
  id: string;
  key: string;
  labelSingular: string;
  labelPlural: string;
  icon: string;
  description: string | null;
  primaryFieldKey: string;
  showInNav: boolean;
  packKey: string | null;
  archived: boolean;
}
export interface InstalledField {
  id: string;
  target: string;
  key: string;
  label: string;
  type: FieldType;
  config: Record<string, unknown>;
  helpText: string | null;
  required: boolean;
  unique: boolean;
  access: FieldAccess;
  order: number;
  packKey: string | null;
  archived: boolean;
}
export interface InstalledStage {
  id: string;
  key: string;
  name: string;
  type: StageType;
  probability: number;
  color: string | null;
  order: number;
  archived: boolean;
  leadCount: number;
}
export interface InstalledPipeline {
  id: string;
  key: string;
  name: string;
  isDefault: boolean;
  packKey: string | null;
  archived: boolean;
  stages: InstalledStage[];
}
export interface InstalledRole {
  id: string;
  key: string;
  name: string;
  kind: RoleKind;
  dataScope: DataScope;
  permissions: string[];
  isSystem: boolean;
  packKey: string | null;
  archived: boolean;
}
export interface InstalledTemplate {
  id: string;
  name: string;
  language: string;
  packKey: string | null;
}
export interface WorkspacePackState {
  objects: InstalledObject[];
  fields: InstalledField[];
  pipelines: InstalledPipeline[];
  roles: InstalledRole[];
  templates: InstalledTemplate[];
  labelOverrides: LabelOverrides;
}

export const emptyPackState = (): WorkspacePackState => ({ objects: [], fields: [], pipelines: [], roles: [], templates: [], labelOverrides: {} });

type ObjectData = Pick<InstalledObject, 'labelSingular' | 'labelPlural' | 'icon' | 'description' | 'primaryFieldKey' | 'showInNav'>;
type FieldData = Pick<InstalledField, 'label' | 'helpText' | 'required' | 'unique' | 'access' | 'config'>;
type StageData = Pick<InstalledStage, 'name' | 'type' | 'probability' | 'color'>;
type RoleData = Pick<InstalledRole, 'name' | 'kind' | 'dataScope' | 'permissions'>;

export type PackOp =
  | { op: 'object.create'; key: string; data: ObjectData }
  | { op: 'object.update'; id: string; key: string; data: Partial<ObjectData> }
  | { op: 'object.archive' | 'object.restore'; id: string; key: string }
  | { op: 'field.create'; target: string; key: string; spec: FieldSpec; order: number }
  | { op: 'field.update'; id: string; target: string; key: string; data: Partial<FieldData> }
  | { op: 'field.archive' | 'field.restore'; id: string; target: string; key: string }
  | { op: 'pipeline.create'; key: string; name: string; isDefault: boolean; stages: Array<StageData & { key: string; order: number }> }
  | { op: 'pipeline.update'; id: string; key: string; data: { name: string } }
  | { op: 'pipeline.archive' | 'pipeline.restore'; id: string; key: string }
  | { op: 'stage.create'; pipelineId: string; pipelineKey: string; key: string; data: StageData; order: number }
  | { op: 'stage.update'; id: string; pipelineKey: string; key: string; data: Partial<StageData> }
  | { op: 'stage.archive' | 'stage.restore'; id: string; pipelineKey: string; key: string }
  | { op: 'role.create'; key: string; data: RoleData }
  | { op: 'role.update'; id: string; key: string; data: Partial<RoleData> }
  | { op: 'role.archive' | 'role.restore'; id: string; key: string }
  | { op: 'template.create'; name: string; language: string; data: { category: string; body: string; variables: string[] } }
  | { op: 'labels.set'; overrides: LabelOverrides }
  | { op: 'conflict'; kind: 'object' | 'field' | 'pipeline' | 'stage' | 'role'; key: string; reason: string };

export type PackWriteOp = Exclude<PackOp, { op: 'conflict' }>;

export interface PlanOptions {
  /** Enabled modes (empty = only items without `modes`). */
  modes: readonly string[];
  /** Manifest of the currently installed version (upgrade / reinstall / mode change). Null = first install. */
  previous?: PackManifest | null;
  /** Modes enabled for the previous install (defaults to `modes`). */
  previousModes?: readonly string[];
  /** The pack was uninstalled and is being installed again: everything it archived comes back. */
  reinstall?: boolean;
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const same = (a: unknown, b: unknown) => json(a) === json(b);

/** Three-way property diff: props the manifest changed (prev -> next) that the workspace did not edit. */
function threeWay<T extends Record<string, unknown>>(current: T, prev: T | undefined, next: T, props: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  if (!prev) return out;
  for (const p of props) {
    if (same(prev[p], next[p])) continue; // manifest did not change it
    if (!same(current[p], prev[p])) continue; // workspace edited it: admin wins
    if (!same(current[p], next[p])) out[p] = next[p];
  }
  return out;
}

const objectData = (o: PackManifest['objects'][number]): ObjectData => ({
  labelSingular: o.labelSingular,
  labelPlural: o.labelPlural,
  icon: o.icon,
  description: o.description ?? null,
  primaryFieldKey: o.primaryFieldKey,
  showInNav: o.showInNav,
});
const fieldData = (f: FieldSpec): FieldData => ({
  label: f.label,
  helpText: f.helpText ?? null,
  required: f.required,
  unique: f.unique,
  access: f.access,
  config: f.config as Record<string, unknown>,
});
const stageData = (s: PackManifest['pipelines'][number]['stages'][number]): StageData => ({ name: s.name, type: s.type, probability: s.probability, color: s.color ?? null });
const roleData = (r: PackManifest['roles'][number]): RoleData => ({ name: r.name, kind: r.kind, dataScope: r.dataScope, permissions: [...r.permissions] });

/** All fields a manifest declares (object fields + core/object fields), for the enabled modes. */
export function manifestFields(m: PackManifest, modes: readonly string[]): Array<{ target: string; spec: FieldSpec }> {
  const objects = itemsForModes(m.objects, modes);
  const objectKeys = new Set(objects.map((o) => o.key));
  return [
    ...objects.flatMap((o) => o.fields.map((spec) => ({ target: `object:${o.key}`, spec }))),
    ...itemsForModes(m.fields, modes)
      .filter((f) => {
        const t = parseTarget(f.target);
        return t.kind === 'core' || objectKeys.has(t.key);
      })
      .map((f) => ({ target: f.target as string, spec: f.field })),
  ];
}

export function planPackInstall(state: WorkspacePackState, manifest: PackManifest, opts: PlanOptions): PackOp[] {
  const ops: PackOp[] = [];
  const pk = manifest.key;
  const prev = opts.previous ?? null;
  const modes = opts.modes;
  const prevModes = opts.previousModes ?? modes;
  /** Create a missing item / restore an archived one? False = the admin removed it after the previous install. */
  const adopt = (inPreviousInstall: boolean) => !prev || !!opts.reinstall || !inPreviousInstall;

  // ---------------------------------------------------------------- objects
  const desiredObjects = itemsForModes(manifest.objects, modes);
  const prevObjectKeys = new Set(prev ? itemsForModes(prev.objects, prevModes).map((o) => o.key) : []);
  const blockedObjects = new Set<string>();
  for (const o of desiredObjects) {
    const cur = state.objects.find((x) => x.key === o.key);
    if (!cur) {
      if (adopt(prevObjectKeys.has(o.key))) ops.push({ op: 'object.create', key: o.key, data: objectData(o) });
      else blockedObjects.add(o.key);
      continue;
    }
    if (cur.packKey !== pk) {
      blockedObjects.add(o.key);
      ops.push({ op: 'conflict', kind: 'object', key: o.key, reason: cur.packKey ? `Owned by pack ${cur.packKey}` : 'An object with this key already exists' });
      continue;
    }
    if (cur.archived) {
      if (!adopt(prevObjectKeys.has(o.key))) {
        blockedObjects.add(o.key);
        continue;
      }
      ops.push({ op: 'object.restore', id: cur.id, key: o.key });
    }
    const p = prev?.objects.find((x) => x.key === o.key);
    const data = threeWay(cur as unknown as ObjectData, p ? objectData(p) : undefined, objectData(o), ['labelSingular', 'labelPlural', 'icon', 'description', 'primaryFieldKey', 'showInNav']);
    if (Object.keys(data).length) ops.push({ op: 'object.update', id: cur.id, key: o.key, data });
  }
  const desiredObjectKeys = new Set(desiredObjects.map((o) => o.key));
  for (const cur of state.objects) {
    if (cur.packKey === pk && !cur.archived && !desiredObjectKeys.has(cur.key)) ops.push({ op: 'object.archive', id: cur.id, key: cur.key });
  }

  // ---------------------------------------------------------------- fields
  const desiredFields = manifestFields(manifest, modes).filter((f) => {
    const t = parseTarget(f.target);
    return t.kind === 'core' || !blockedObjects.has(t.key);
  });
  const prevFieldKeys = new Set(prev ? manifestFields(prev, prevModes).map((f) => `${f.target}.${f.spec.key}`) : []);
  const prevFieldSpecs = prev ? manifestFields(prev, prev.modes.map((m) => m.key)) : [];
  const nextOrder = new Map<string, number>();
  const orderFor = (target: string) => {
    const base = nextOrder.get(target) ?? Math.max(-1, ...state.fields.filter((f) => f.target === target).map((f) => f.order)) + 1;
    nextOrder.set(target, base + 1);
    return base;
  };
  for (const { target, spec } of desiredFields) {
    const id = `${target}.${spec.key}`;
    const cur = state.fields.find((x) => x.target === target && x.key === spec.key);
    if (!cur) {
      if (adopt(prevFieldKeys.has(id))) ops.push({ op: 'field.create', target, key: spec.key, spec, order: orderFor(target) });
      continue;
    }
    if (cur.packKey !== pk) {
      ops.push({ op: 'conflict', kind: 'field', key: id, reason: cur.packKey ? `Owned by pack ${cur.packKey}` : 'A field with this key already exists' });
      continue;
    }
    if (cur.type !== spec.type) {
      ops.push({ op: 'conflict', kind: 'field', key: id, reason: `Type cannot change from ${cur.type} to ${spec.type}` });
      continue;
    }
    if (cur.archived) {
      if (!adopt(prevFieldKeys.has(id))) continue;
      ops.push({ op: 'field.restore', id: cur.id, target, key: spec.key });
    }
    const p = prevFieldSpecs.find((x) => x.target === target && x.spec.key === spec.key);
    const data = threeWay(cur as unknown as FieldData, p ? fieldData(p.spec) : undefined, fieldData(spec), ['label', 'helpText', 'required', 'unique', 'access', 'config']);
    if (Object.keys(data).length) ops.push({ op: 'field.update', id: cur.id, target, key: spec.key, data });
  }
  const desiredFieldKeys = new Set(desiredFields.map((f) => `${f.target}.${f.spec.key}`));
  for (const cur of state.fields) {
    if (cur.packKey === pk && !cur.archived && !desiredFieldKeys.has(`${cur.target}.${cur.key}`)) ops.push({ op: 'field.archive', id: cur.id, target: cur.target, key: cur.key });
  }

  // ---------------------------------------------------------------- pipelines + stages
  const desiredPipelines = itemsForModes(manifest.pipelines, modes);
  const prevPipelineKeys = new Set(prev ? itemsForModes(prev.pipelines, prevModes).map((p) => p.key) : []);
  let defaultTaken = state.pipelines.some((p) => p.isDefault && !p.archived);
  for (const pl of desiredPipelines) {
    const cur = state.pipelines.find((x) => x.key === pl.key);
    if (!cur) {
      if (!adopt(prevPipelineKeys.has(pl.key))) continue;
      const isDefault = pl.isDefault && !defaultTaken;
      if (isDefault) defaultTaken = true;
      ops.push({ op: 'pipeline.create', key: pl.key, name: pl.name, isDefault, stages: pl.stages.map((s, order) => ({ key: s.key, order, ...stageData(s) })) });
      continue;
    }
    if (cur.packKey !== pk) {
      ops.push({ op: 'conflict', kind: 'pipeline', key: pl.key, reason: cur.packKey ? `Owned by pack ${cur.packKey}` : 'A pipeline with this key already exists' });
      continue;
    }
    if (cur.archived) {
      if (!adopt(prevPipelineKeys.has(pl.key))) continue;
      ops.push({ op: 'pipeline.restore', id: cur.id, key: pl.key });
    }
    const pp = prev?.pipelines.find((x) => x.key === pl.key);
    const pdata = threeWay({ name: cur.name }, pp ? { name: pp.name } : undefined, { name: pl.name }, ['name']);
    if (pdata.name) ops.push({ op: 'pipeline.update', id: cur.id, key: pl.key, data: { name: pdata.name } });

    const prevStageKeys = new Set(pp?.stages.map((s) => s.key) ?? []);
    let nextStageOrder = Math.max(-1, ...cur.stages.map((s) => s.order)) + 1;
    for (const s of pl.stages) {
      const cs = cur.stages.find((x) => x.key === s.key);
      if (!cs) {
        // New in this version, or a reinstall. Adopted pipelines (no previous install) keep the admin's stage list.
        if ((pp && !prevStageKeys.has(s.key)) || opts.reinstall) {
          ops.push({ op: 'stage.create', pipelineId: cur.id, pipelineKey: pl.key, key: s.key, data: stageData(s), order: nextStageOrder++ });
        }
        continue;
      }
      if (cs.archived) ops.push({ op: 'stage.restore', id: cs.id, pipelineKey: pl.key, key: s.key });
      const ps = pp?.stages.find((x) => x.key === s.key);
      const sdata = threeWay(cs as unknown as StageData, ps ? stageData(ps) : undefined, stageData(s), ['name', 'type', 'probability', 'color']);
      if (Object.keys(sdata).length) ops.push({ op: 'stage.update', id: cs.id, pipelineKey: pl.key, key: s.key, data: sdata });
    }
    // Stages the manifest removed (only those the previous version declared; admin-added stages stay).
    const desiredStageKeys = new Set(pl.stages.map((s) => s.key));
    for (const cs of cur.stages) {
      if (cs.archived || desiredStageKeys.has(cs.key) || !prevStageKeys.has(cs.key)) continue;
      if (cs.leadCount > 0) ops.push({ op: 'conflict', kind: 'stage', key: `${pl.key}.${cs.key}`, reason: `Kept because ${cs.leadCount} leads are in it` });
      else ops.push({ op: 'stage.archive', id: cs.id, pipelineKey: pl.key, key: cs.key });
    }
  }
  const desiredPipelineKeys = new Set(desiredPipelines.map((p) => p.key));
  for (const cur of state.pipelines) {
    if (cur.packKey === pk && !cur.archived && !desiredPipelineKeys.has(cur.key)) ops.push({ op: 'pipeline.archive', id: cur.id, key: cur.key });
  }

  // ---------------------------------------------------------------- roles
  const desiredRoles = itemsForModes(manifest.roles, modes);
  const prevRoleKeys = new Set(prev ? itemsForModes(prev.roles, prevModes).map((r) => r.key) : []);
  const sorted = (d: RoleData): RoleData => ({ ...d, permissions: [...d.permissions].sort() });
  for (const r of desiredRoles) {
    const cur = state.roles.find((x) => x.key === r.key);
    if (!cur) {
      if (adopt(prevRoleKeys.has(r.key))) ops.push({ op: 'role.create', key: r.key, data: roleData(r) });
      continue;
    }
    if (cur.packKey !== pk) {
      ops.push({ op: 'conflict', kind: 'role', key: r.key, reason: cur.isSystem ? 'System role' : cur.packKey ? `Owned by pack ${cur.packKey}` : 'A role with this key already exists' });
      continue;
    }
    if (cur.archived) {
      if (!adopt(prevRoleKeys.has(r.key))) continue;
      ops.push({ op: 'role.restore', id: cur.id, key: r.key });
    }
    const p = prev?.roles.find((x) => x.key === r.key);
    const curData = sorted({ name: cur.name, kind: cur.kind, dataScope: cur.dataScope, permissions: cur.permissions });
    const data = threeWay(curData, p ? sorted(roleData(p)) : undefined, sorted(roleData(r)), ['name', 'dataScope', 'permissions']);
    if (Object.keys(data).length) ops.push({ op: 'role.update', id: cur.id, key: r.key, data });
  }
  const desiredRoleKeys = new Set(desiredRoles.map((r) => r.key));
  for (const cur of state.roles) {
    if (cur.packKey === pk && !cur.archived && !desiredRoleKeys.has(cur.key)) ops.push({ op: 'role.archive', id: cur.id, key: cur.key });
  }

  // ---------------------------------------------------------------- WhatsApp template suggestions (create only, never updated or removed)
  const prevTemplates = new Set(prev ? itemsForModes(prev.whatsappTemplates, prevModes).map((t) => `${t.name}:${t.language}`) : []);
  for (const t of itemsForModes(manifest.whatsappTemplates, modes)) {
    if (state.templates.some((x) => x.name === t.name && x.language === t.language)) continue;
    if (!adopt(prevTemplates.has(`${t.name}:${t.language}`))) continue;
    ops.push({ op: 'template.create', name: t.name, language: t.language, data: { category: t.category, body: t.body, variables: t.variables } });
  }

  // ---------------------------------------------------------------- labels (three-way per label key)
  const nextLabels: LabelOverrides = { ...state.labelOverrides };
  const prevLabels: LabelOverrides = prev?.labels ?? {};
  for (const [k, v] of Object.entries(manifest.labels) as Array<[LabelKey, NonNullable<LabelOverrides[LabelKey]>]>) {
    const cur = state.labelOverrides[k];
    if (cur === undefined ? !(k in prevLabels) || !!opts.reinstall : same(cur, prevLabels[k])) nextLabels[k] = v;
  }
  for (const k of Object.keys(prevLabels) as LabelKey[]) {
    if (!(k in manifest.labels) && same(state.labelOverrides[k], prevLabels[k])) delete nextLabels[k];
  }
  if (!same(nextLabels, state.labelOverrides)) ops.push({ op: 'labels.set', overrides: nextLabels });

  return ops;
}

export class CorePackError extends Error {
  constructor(key: string) {
    super(`${key} is a core pack and cannot be uninstalled`);
    this.name = 'CorePackError';
  }
}

/** Archive everything the pack owns and revert its labels. Throws CorePackError for core packs. */
export function planPackUninstall(state: WorkspacePackState, manifest: PackManifest): PackOp[] {
  if (manifest.core) throw new CorePackError(manifest.key);
  const pk = manifest.key;
  const ops: PackOp[] = [];
  for (const o of state.objects) if (o.packKey === pk && !o.archived) ops.push({ op: 'object.archive', id: o.id, key: o.key });
  for (const f of state.fields) if (f.packKey === pk && !f.archived) ops.push({ op: 'field.archive', id: f.id, target: f.target, key: f.key });
  for (const p of state.pipelines) if (p.packKey === pk && !p.archived) ops.push({ op: 'pipeline.archive', id: p.id, key: p.key });
  for (const r of state.roles) if (r.packKey === pk && !r.archived) ops.push({ op: 'role.archive', id: r.id, key: r.key });
  const next: LabelOverrides = { ...state.labelOverrides };
  for (const [k, v] of Object.entries(manifest.labels) as Array<[LabelKey, unknown]>) if (same(next[k], v)) delete next[k];
  if (!same(next, state.labelOverrides)) ops.push({ op: 'labels.set', overrides: next });
  return ops;
}

export const writeOps = (ops: readonly PackOp[]): PackWriteOp[] => ops.filter((o): o is PackWriteOp => o.op !== 'conflict');

/** Counts by op type, e.g. { "field.create": 2, conflict: 1 } (previews, install log). */
export function summarizeOps(ops: readonly PackOp[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of ops) out[o.op] = (out[o.op] ?? 0) + 1;
  return out;
}

/**
 * Apply ops to an in-memory state (tests, previews). Mirrors what the API executor writes, with
 * generated ids. The real executor must produce the same resulting state.
 */
export function applyPlanToState(state: WorkspacePackState, ops: readonly PackOp[], packKey: string, newId: () => string): WorkspacePackState {
  const s: WorkspacePackState = structuredClone(state);
  for (const o of ops) {
    switch (o.op) {
      case 'object.create':
        s.objects.push({ id: newId(), key: o.key, ...o.data, packKey, archived: false });
        break;
      case 'object.update':
        Object.assign(s.objects.find((x) => x.id === o.id)!, o.data);
        break;
      case 'object.archive':
      case 'object.restore':
        s.objects.find((x) => x.id === o.id)!.archived = o.op === 'object.archive';
        break;
      case 'field.create':
        s.fields.push({
          id: newId(),
          target: o.target,
          key: o.key,
          type: o.spec.type,
          order: o.order,
          packKey,
          archived: false,
          ...fieldData(o.spec),
        });
        break;
      case 'field.update':
        Object.assign(s.fields.find((x) => x.id === o.id)!, o.data);
        break;
      case 'field.archive':
      case 'field.restore':
        s.fields.find((x) => x.id === o.id)!.archived = o.op === 'field.archive';
        break;
      case 'pipeline.create':
        s.pipelines.push({
          id: newId(),
          key: o.key,
          name: o.name,
          isDefault: o.isDefault,
          packKey,
          archived: false,
          stages: o.stages.map((st) => ({ id: newId(), key: st.key, name: st.name, type: st.type, probability: st.probability, color: st.color, order: st.order, archived: false, leadCount: 0 })),
        });
        break;
      case 'pipeline.update':
        Object.assign(s.pipelines.find((x) => x.id === o.id)!, o.data);
        break;
      case 'pipeline.archive':
      case 'pipeline.restore':
        s.pipelines.find((x) => x.id === o.id)!.archived = o.op === 'pipeline.archive';
        break;
      case 'stage.create':
        s.pipelines.find((x) => x.id === o.pipelineId)!.stages.push({ id: newId(), key: o.key, ...o.data, order: o.order, archived: false, leadCount: 0 });
        break;
      case 'stage.update':
      case 'stage.archive':
      case 'stage.restore': {
        const st = s.pipelines.flatMap((p) => p.stages).find((x) => x.id === o.id)!;
        if (o.op === 'stage.update') Object.assign(st, o.data);
        else st.archived = o.op === 'stage.archive';
        break;
      }
      case 'role.create':
        s.roles.push({ id: newId(), key: o.key, ...o.data, isSystem: false, packKey, archived: false });
        break;
      case 'role.update':
        Object.assign(s.roles.find((x) => x.id === o.id)!, o.data);
        break;
      case 'role.archive':
      case 'role.restore':
        s.roles.find((x) => x.id === o.id)!.archived = o.op === 'role.archive';
        break;
      case 'template.create':
        s.templates.push({ id: newId(), name: o.name, language: o.language, packKey });
        break;
      case 'labels.set':
        s.labelOverrides = { ...o.overrides };
        break;
      case 'conflict':
        break;
    }
  }
  return s;
}
