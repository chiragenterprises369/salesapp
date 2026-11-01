import {
  CustomObjectCreateSchema,
  CustomObjectUpdateSchema,
  CustomRecordCreateSchema,
  CustomRecordListQuerySchema,
  CustomRecordUpdateSchema,
  FieldDefinitionCreateSchema,
  FieldDefinitionUpdateSchema,
  HexColorSchema,
  LabelOverridesSchema,
  objectTarget,
  parseFieldConfig,
  resolveLabels,
  StageCreateSchema,
  StageUpdateSchema,
  validateCustomValues,
  visibleValues,
  type CustomObject,
  type CustomRecord,
  type FieldDefinition,
  type FieldTarget,
  type InstalledField,
  type InstalledObject,
  type InstalledPipeline,
  type Permission,
  type Pipeline,
  type Stage,
} from '@vistar/shared';
import type { z } from 'zod';
import { ApiRequestError } from '../api-error';
import { mockId, readMockDb, updateMockDb, type MockDbData } from '../mock-db';
import { useSessionStore } from '../session/session';
import { mockLeadCountByStage } from '../leads/mock-source';
import type { CustomizationSource } from './source';

/**
 * Mock backend for the flexible data layer. Applies the same rules the API will: permissions,
 * data scope on records, field-level access by role key, validateCustomValues on every write,
 * unique fields, archive-only definitions, version checks.
 */
const delay = (ms = 90 + Math.random() * 120) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

function caller() {
  const s = useSessionStore.getState().session;
  if (!s || s.audience !== 'workspace') throw new ApiRequestError('AUTH_UNAUTHENTICATED', 'Sign in again');
  const { me } = s;
  const visible = me.role.dataScope === 'all' ? null : me.role.dataScope === 'own' ? [me.user.id] : [...new Set([me.user.id, ...me.teamMemberIds])];
  return { userId: me.user.id, roleKey: me.role.key, permissions: me.permissions, visible, canManage: me.permissions.includes('settings.manage') };
}

function requirePermission(p: Permission) {
  if (!caller().permissions.includes(p)) throw new ApiRequestError('FORBIDDEN', 'You do not have permission to do this');
}

function zodFail(error: z.ZodError, prefix = ''): never {
  const details = error.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].filter(Boolean).join('.'), message: i.message }));
  throw new ApiRequestError('VALIDATION_FAILED', details[0]?.message ?? 'Check the highlighted fields', details);
}

function parse<T extends z.ZodType>(schema: T, input: unknown, prefix?: string): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) zodFail(r.error, prefix);
  return r.data;
}

// ---------------------------------------------------------------- mappers

function toDef(db: MockDbData, f: InstalledField): FieldDefinition {
  const m = db.meta[f.id];
  return {
    id: f.id,
    target: f.target as FieldTarget,
    key: f.key,
    label: f.label,
    type: f.type,
    config: f.config,
    helpText: f.helpText,
    required: f.required,
    unique: f.unique,
    access: f.access,
    order: f.order,
    packKey: f.packKey,
    archivedAt: f.archived ? (m?.archivedAt ?? nowIso()) : null,
    createdAt: m?.createdAt ?? nowIso(),
  };
}

const defsFor = (db: MockDbData, target: string) =>
  db.state.fields
    .filter((f) => f.target === target)
    .sort((a, b) => a.order - b.order)
    .map((f) => toDef(db, f));

function toObject(db: MockDbData, o: InstalledObject, roleKey: string | null): CustomObject {
  const fields = defsFor(db, objectTarget(o.key)).filter((d) => roleKey === null || !d.access.hiddenFor.includes(roleKey));
  return {
    id: o.id,
    key: o.key,
    labelSingular: o.labelSingular,
    labelPlural: o.labelPlural,
    icon: o.icon,
    description: o.description,
    primaryFieldKey: o.primaryFieldKey,
    showInNav: o.showInNav,
    packKey: o.packKey,
    archivedAt: o.archived ? (db.meta[o.id]?.archivedAt ?? nowIso()) : null,
    fields,
    recordCount: db.records.filter((r) => r.objectKey === o.key).length,
    createdAt: db.meta[o.id]?.createdAt ?? nowIso(),
  };
}

function toPipeline(p: InstalledPipeline): Pipeline {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    isDefault: p.isDefault,
    packKey: p.packKey,
    stages: p.stages
      .filter((s) => !s.archived)
      .sort((a, b) => a.order - b.order)
      .map((s, order) => ({ id: s.id, pipelineId: p.id, key: s.key, name: s.name, type: s.type, order, color: s.color && HexColorSchema.safeParse(s.color).success ? s.color : null, probability: s.probability })),
  };
}

const toStage = (p: InstalledPipeline, stageId: string): Stage => toPipeline(p).stages.find((s) => s.id === stageId)!;

function findField(db: MockDbData, id: string) {
  const f = db.state.fields.find((x) => x.id === id);
  if (!f) throw new ApiRequestError('NOT_FOUND', 'Field not found');
  return f;
}
function findObject(db: MockDbData, key: string, opts: { active?: boolean } = {}) {
  const o = db.state.objects.find((x) => x.key === key);
  if (!o || (opts.active && o.archived)) throw new ApiRequestError('NOT_FOUND', 'Object not found');
  return o;
}
function findStage(db: MockDbData, stageId: string) {
  for (const p of db.state.pipelines) {
    const s = p.stages.find((x) => x.id === stageId && !x.archived);
    if (s) return { pipeline: p, stage: s };
  }
  throw new ApiRequestError('NOT_FOUND', 'Stage not found');
}

const slug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'stage';

// ---------------------------------------------------------------- records helpers

function recordTitle(o: InstalledObject, values: CustomRecord['values']): string {
  const v = values[o.primaryFieldKey];
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

function assertUnique(db: MockDbData, o: InstalledObject, values: CustomRecord['values'], selfId: string | null) {
  for (const def of defsFor(db, objectTarget(o.key))) {
    if (!def.unique || def.archivedAt) continue;
    const v = values[def.key];
    if (v === null || v === undefined || v === '') continue;
    const clash = db.records.some((r) => r.objectKey === o.key && r.id !== selfId && JSON.stringify(r.values[def.key]) === JSON.stringify(v));
    if (clash) throw new ApiRequestError('FIELD_VALUE_NOT_UNIQUE', `Another record already has this ${def.label}`, [{ path: `values.${def.key}`, message: `${def.label} must be unique` }]);
  }
}

function inScope(r: CustomRecord, visible: string[] | null) {
  return visible === null || (r.ownerId !== null && visible.includes(r.ownerId));
}

function readRecord(db: MockDbData, r: CustomRecord, roleKey: string): CustomRecord {
  return { ...r, values: visibleValues(defsFor(db, objectTarget(r.objectKey)), r.values, roleKey) };
}

// ---------------------------------------------------------------- source

export const mockCustomizationSource: CustomizationSource = {
  async listFields(query = {}) {
    await delay();
    const { roleKey, canManage } = caller();
    const db = readMockDb();
    return db.state.fields
      .filter((f) => (!query.target || f.target === query.target) && (query.includeArchived || !f.archived))
      .filter((f) => canManage || !f.access.hiddenFor.includes(roleKey))
      .sort((a, b) => a.target.localeCompare(b.target) || a.order - b.order)
      .map((f) => toDef(db, f));
  },

  async createField(body) {
    await delay();
    requirePermission('settings.manage');
    const { target, field } = parse(FieldDefinitionCreateSchema, body);
    let id = '';
    updateMockDb((db) => {
      if (target.startsWith('object:')) findObject(db, target.slice(7), { active: true });
      if (db.state.fields.some((f) => f.target === target && f.key === field.key)) {
        throw new ApiRequestError('FIELD_KEY_TAKEN', 'This key is already used (keys of archived fields cannot be reused)', [{ path: 'field.key', message: 'Choose another key' }]);
      }
      id = mockId();
      const order = Math.max(-1, ...db.state.fields.filter((f) => f.target === target).map((f) => f.order)) + 1;
      db.state.fields.push({
        id,
        target,
        key: field.key,
        label: field.label,
        type: field.type,
        config: field.config as Record<string, unknown>,
        helpText: field.helpText ?? null,
        required: field.required,
        unique: field.unique,
        access: field.access,
        order,
        packKey: null,
        archived: false,
      });
    });
    const db = readMockDb();
    return toDef(db, findField(db, id));
  },

  async updateField(id, patch) {
    await delay();
    requirePermission('settings.manage');
    const p = parse(FieldDefinitionUpdateSchema, patch);
    updateMockDb((db) => {
      const f = findField(db, id);
      if (p.config !== undefined) {
        const r = (() => {
          try {
            return { ok: true as const, config: parseFieldConfig(f.type, p.config) as Record<string, unknown> };
          } catch (e) {
            return { ok: false as const, error: e as z.ZodError };
          }
        })();
        if (!r.ok) zodFail(r.error, 'config');
        f.config = r.config;
      }
      if (p.label !== undefined) f.label = p.label;
      if (p.helpText !== undefined) f.helpText = p.helpText;
      if (p.required !== undefined) f.required = p.required;
      if (p.unique !== undefined) f.unique = p.unique;
      if (p.access !== undefined) f.access = p.access;
    });
    const db = readMockDb();
    return toDef(db, findField(db, id));
  },

  async archiveField(id) {
    await delay();
    requirePermission('settings.manage');
    updateMockDb((db) => {
      const f = findField(db, id);
      const owner = f.target.startsWith('object:') ? db.state.objects.find((o) => objectTarget(o.key) === f.target) : null;
      if (owner && owner.primaryFieldKey === f.key) throw new ApiRequestError('CONFLICT', 'This is the title field of the object. Pick another title field first');
      f.archived = true;
    });
    const db = readMockDb();
    return toDef(db, findField(db, id));
  },

  async restoreField(id) {
    await delay();
    requirePermission('settings.manage');
    updateMockDb((db) => {
      findField(db, id).archived = false;
    });
    const db = readMockDb();
    return toDef(db, findField(db, id));
  },

  async reorderFields(target, fieldIds) {
    await delay();
    requirePermission('settings.manage');
    updateMockDb((db) => {
      const own = db.state.fields.filter((f) => f.target === target);
      if (fieldIds.some((id) => !own.some((f) => f.id === id))) throw new ApiRequestError('VALIDATION_FAILED', 'Every field must belong to the same target');
      fieldIds.forEach((id, order) => {
        own.find((f) => f.id === id)!.order = order;
      });
    });
    return defsFor(readMockDb(), target);
  },

  async listObjects(query = {}) {
    await delay();
    requirePermission('records.read');
    const { roleKey, canManage } = caller();
    const db = readMockDb();
    return db.state.objects.filter((o) => query.includeArchived || !o.archived).map((o) => toObject(db, o, canManage ? null : roleKey));
  },

  async getObject(key) {
    await delay(60);
    requirePermission('records.read');
    const { roleKey, canManage } = caller();
    const db = readMockDb();
    return toObject(db, findObject(db, key), canManage ? null : roleKey);
  },

  async createObject(body) {
    await delay();
    requirePermission('settings.manage');
    const spec = parse(CustomObjectCreateSchema, body);
    updateMockDb((db) => {
      if (db.state.objects.some((o) => o.key === spec.key)) throw new ApiRequestError('CONFLICT', 'An object with this key already exists', [{ path: 'key', message: 'Choose another key' }]);
      db.state.objects.push({
        id: mockId(),
        key: spec.key,
        labelSingular: spec.labelSingular,
        labelPlural: spec.labelPlural,
        icon: spec.icon,
        description: spec.description ?? null,
        primaryFieldKey: spec.primaryFieldKey,
        showInNav: spec.showInNav,
        packKey: null,
        archived: false,
      });
      spec.fields.forEach((f, order) =>
        db.state.fields.push({
          id: mockId(),
          target: objectTarget(spec.key),
          key: f.key,
          label: f.label,
          type: f.type,
          config: f.config as Record<string, unknown>,
          helpText: f.helpText ?? null,
          required: f.required,
          unique: f.unique,
          access: f.access,
          order,
          packKey: null,
          archived: false,
        }),
      );
    });
    const db = readMockDb();
    return toObject(db, findObject(db, spec.key), null);
  },

  async updateObject(key, patch) {
    await delay();
    requirePermission('settings.manage');
    const p = parse(CustomObjectUpdateSchema, patch);
    updateMockDb((db) => {
      const o = findObject(db, key);
      if (p.primaryFieldKey !== undefined) {
        const f = db.state.fields.find((x) => x.target === objectTarget(key) && x.key === p.primaryFieldKey && !x.archived);
        if (!f || f.type !== 'text') throw new ApiRequestError('VALIDATION_FAILED', 'The title field must be an active text field', [{ path: 'primaryFieldKey', message: 'Pick a text field' }]);
        o.primaryFieldKey = p.primaryFieldKey;
        for (const r of db.records) if (r.objectKey === key) r.title = recordTitle(o, r.values);
      }
      if (p.labelSingular !== undefined) o.labelSingular = p.labelSingular;
      if (p.labelPlural !== undefined) o.labelPlural = p.labelPlural;
      if (p.icon !== undefined) o.icon = p.icon;
      if (p.description !== undefined) o.description = p.description;
      if (p.showInNav !== undefined) o.showInNav = p.showInNav;
    });
    const db = readMockDb();
    return toObject(db, findObject(db, key), null);
  },

  async archiveObject(key) {
    await delay();
    requirePermission('settings.manage');
    updateMockDb((db) => {
      findObject(db, key).archived = true;
    });
    const db = readMockDb();
    return toObject(db, findObject(db, key), null);
  },

  async restoreObject(key) {
    await delay();
    requirePermission('settings.manage');
    updateMockDb((db) => {
      findObject(db, key).archived = false;
    });
    const db = readMockDb();
    return toObject(db, findObject(db, key), null);
  },

  async listRecords(objectKey, query = {}) {
    await delay();
    requirePermission('records.read');
    const q = parse(CustomRecordListQuerySchema, query);
    const { roleKey, visible, userId } = caller();
    const db = readMockDb();
    findObject(db, objectKey);
    let rows = db.records.filter((r) => r.objectKey === objectKey && inScope(r, visible));
    if (q.q) rows = rows.filter((r) => r.title.toLowerCase().includes(q.q!.toLowerCase()));
    if (q.ownerId) rows = rows.filter((r) => (q.ownerId === 'me' ? r.ownerId === userId : q.ownerId === 'unassigned' ? r.ownerId === null : r.ownerId === q.ownerId));
    if (q.related) {
      const [fieldKey, id] = q.related.split(':') as [string, string];
      rows = rows.filter((r) => {
        const v = r.values[fieldKey];
        return v === id || (Array.isArray(v) && v.includes(id));
      });
    }
    const dir = q.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => (a[q.sort] < b[q.sort] ? -dir : a[q.sort] > b[q.sort] ? dir : 0));
    const start = q.cursor ? Number(q.cursor) || 0 : 0;
    const page = rows.slice(start, start + q.limit);
    return { items: page.map((r) => readRecord(db, r, roleKey)), nextCursor: start + q.limit < rows.length ? String(start + q.limit) : null, total: rows.length };
  },

  async getRecord(objectKey, id) {
    await delay(60);
    requirePermission('records.read');
    const { roleKey, visible } = caller();
    const db = readMockDb();
    const r = db.records.find((x) => x.id === id && x.objectKey === objectKey);
    if (!r || !inScope(r, visible)) throw new ApiRequestError('NOT_FOUND', 'Record not found');
    return readRecord(db, r, roleKey);
  },

  async createRecord(objectKey, body) {
    await delay();
    requirePermission('records.create');
    const input = parse(CustomRecordCreateSchema, body);
    const { roleKey, userId } = caller();
    let id = '';
    updateMockDb((db) => {
      const o = findObject(db, objectKey, { active: true });
      const v = validateCustomValues(defsFor(db, objectTarget(objectKey)), input.values, { mode: 'create', roleKey, pathPrefix: 'values' });
      if (!v.ok) throw new ApiRequestError('VALIDATION_FAILED', v.errors[0]!.message, v.errors);
      assertUnique(db, o, v.values, null);
      id = mockId();
      const at = nowIso();
      db.records.unshift({ id, objectKey, title: recordTitle(o, v.values), values: v.values, ownerId: input.ownerId ?? userId, version: 1, createdAt: at, updatedAt: at });
    });
    const db = readMockDb();
    return readRecord(db, db.records.find((r) => r.id === id)!, roleKey);
  },

  async updateRecord(objectKey, id, patch) {
    await delay();
    requirePermission('records.update');
    const input = parse(CustomRecordUpdateSchema, patch);
    const { roleKey, visible } = caller();
    updateMockDb((db) => {
      const o = findObject(db, objectKey, { active: true });
      const r = db.records.find((x) => x.id === id && x.objectKey === objectKey);
      if (!r || !inScope(r, visible)) throw new ApiRequestError('NOT_FOUND', 'Record not found');
      if (input.expectedVersion !== undefined && input.expectedVersion !== r.version) throw new ApiRequestError('VERSION_CONFLICT', 'Someone else changed this record. Reload and try again.');
      if (input.values) {
        const v = validateCustomValues(defsFor(db, objectTarget(objectKey)), input.values, { mode: 'update', roleKey, pathPrefix: 'values' });
        if (!v.ok) throw new ApiRequestError('VALIDATION_FAILED', v.errors[0]!.message, v.errors);
        const next = { ...r.values, ...v.values };
        assertUnique(db, o, next, r.id);
        r.values = next;
        r.title = recordTitle(o, next);
      }
      if (input.ownerId !== undefined) r.ownerId = input.ownerId;
      r.version += 1;
      r.updatedAt = nowIso();
    });
    const db = readMockDb();
    return readRecord(db, db.records.find((r) => r.id === id)!, roleKey);
  },

  async deleteRecord(objectKey, id) {
    await delay();
    requirePermission('records.delete');
    const { visible } = caller();
    updateMockDb((db) => {
      const r = db.records.find((x) => x.id === id && x.objectKey === objectKey);
      if (!r || !inScope(r, visible)) throw new ApiRequestError('NOT_FOUND', 'Record not found');
      db.records = db.records.filter((x) => x.id !== id);
    });
  },

  async getLabels() {
    await delay(40);
    const overrides = readMockDb().state.labelOverrides;
    return { labels: resolveLabels(overrides), overrides };
  },

  async updateLabels(overrides) {
    await delay();
    requirePermission('settings.manage');
    const parsed = parse(LabelOverridesSchema, overrides, 'overrides');
    updateMockDb((db) => {
      db.state.labelOverrides = parsed;
    });
    return { labels: resolveLabels(parsed), overrides: parsed };
  },

  async listPipelines() {
    await delay(60);
    return readMockDb().state.pipelines.filter((p) => !p.archived).map(toPipeline);
  },

  async createStage(pipelineId, body) {
    await delay();
    requirePermission('pipeline.manage');
    const input = parse(StageCreateSchema, body);
    let id = '';
    updateMockDb((db) => {
      const p = db.state.pipelines.find((x) => x.id === pipelineId && !x.archived);
      if (!p) throw new ApiRequestError('NOT_FOUND', 'Pipeline not found');
      const taken = new Set(p.stages.map((s) => s.key));
      let key = slug(input.name);
      for (let i = 2; taken.has(key); i++) key = `${slug(input.name)}_${i}`;
      const active = p.stages.filter((s) => !s.archived).sort((a, b) => a.order - b.order);
      const at = input.afterStageId === null ? 0 : input.afterStageId ? active.findIndex((s) => s.id === input.afterStageId) + 1 : active.length;
      id = mockId();
      active.splice(Math.max(0, at), 0, { id, key, name: input.name, type: input.type, probability: input.probability, color: input.color ?? null, order: 0, archived: false, leadCount: 0 });
      active.forEach((s, order) => (s.order = order));
      p.stages = [...active, ...p.stages.filter((s) => s.archived)];
    });
    const db = readMockDb();
    return toStage(findStage(db, id).pipeline, id);
  },

  async updateStage(stageId, patch) {
    await delay();
    requirePermission('pipeline.manage');
    const p = parse(StageUpdateSchema, patch);
    updateMockDb((db) => {
      const { stage } = findStage(db, stageId);
      if (p.name !== undefined) stage.name = p.name;
      if (p.type !== undefined) stage.type = p.type;
      if (p.probability !== undefined) stage.probability = p.probability;
      if (p.color !== undefined) stage.color = p.color ?? null;
    });
    const db = readMockDb();
    return toStage(findStage(db, stageId).pipeline, stageId);
  },

  async reorderStages(pipelineId, stageIds) {
    await delay();
    requirePermission('pipeline.manage');
    updateMockDb((db) => {
      const p = db.state.pipelines.find((x) => x.id === pipelineId);
      if (!p) throw new ApiRequestError('NOT_FOUND', 'Pipeline not found');
      const active = p.stages.filter((s) => !s.archived);
      if (stageIds.length !== active.length || stageIds.some((id) => !active.some((s) => s.id === id))) throw new ApiRequestError('VALIDATION_FAILED', 'Send every stage of the pipeline once');
      stageIds.forEach((id, order) => (active.find((s) => s.id === id)!.order = order));
    });
    return toPipeline(readMockDb().state.pipelines.find((x) => x.id === pipelineId)!);
  },

  async deleteStage(stageId) {
    await delay();
    requirePermission('pipeline.manage');
    const count = mockLeadCountByStage().get(stageId) ?? 0;
    if (count > 0) throw new ApiRequestError('STAGE_IN_USE', `Move the ${count} leads out of this stage first`);
    updateMockDb((db) => {
      const { pipeline } = findStage(db, stageId);
      if (pipeline.stages.filter((s) => !s.archived).length <= 2) throw new ApiRequestError('CONFLICT', 'A pipeline needs at least two stages');
      pipeline.stages = pipeline.stages.filter((s) => s.id !== stageId);
      pipeline.stages.filter((s) => !s.archived).sort((a, b) => a.order - b.order).forEach((s, order) => (s.order = order));
    });
  },
};
