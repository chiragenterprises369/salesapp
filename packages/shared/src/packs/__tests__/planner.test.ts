import { describe, expect, it } from 'vitest';
import { GENERIC_SALES_MANIFEST } from '../generic-sales.js';
import {
  applyPlanToState,
  CorePackError,
  emptyPackState,
  planPackInstall,
  planPackUninstall,
  summarizeOps,
  writeOps,
  type PackOp,
  type WorkspacePackState,
} from '../planner.js';
import { describeOp } from '../runtime.js';
import { HOMES_V1, homesV2, idGen, migratedWorkspaceState } from './fixtures.js';

const DEV = ['developer'];

function install(state: WorkspacePackState = emptyPackState(), modes = DEV): { state: WorkspacePackState; ops: PackOp[] } {
  const ops = planPackInstall(state, HOMES_V1, { modes });
  return { state: applyPlanToState(state, ops, HOMES_V1.key, idGen('h')), ops };
}

const field = (s: WorkspacePackState, target: string, key: string) => s.fields.find((f) => f.target === target && f.key === key);
const stage = (s: WorkspacePackState, pipelineKey: string, key: string) => s.pipelines.find((p) => p.key === pipelineKey)?.stages.find((x) => x.key === key);

describe('planPackInstall: first install', () => {
  it('creates every item for the enabled modes', () => {
    const { ops, state } = install();
    expect(summarizeOps(ops)).toEqual({
      'object.create': 2,
      'field.create': 8,
      'pipeline.create': 1,
      'role.create': 1,
      'template.create': 1,
      'labels.set': 1,
    });
    expect(state.objects.map((o) => o.key)).toEqual(['project', 'unit']);
    expect(state.fields.filter((f) => f.target === 'lead').map((f) => f.key)).toEqual(['budget', 'bhk', 'site_visit_on']);
    expect(state.fields.every((f) => f.packKey === 'test-homes' && !f.archived)).toBe(true);
    expect(state.pipelines[0]!.stages.map((s) => s.key)).toEqual(['enquiry', 'site_visit', 'negotiation', 'booked', 'dropped']);
    expect(state.labelOverrides.lead).toEqual({ singular: 'Enquiry', plural: 'Enquiries' });
  });

  it('is idempotent: planning again changes nothing (with or without the previous manifest)', () => {
    const { state } = install();
    expect(writeOps(planPackInstall(state, HOMES_V1, { modes: DEV }))).toEqual([]);
    expect(writeOps(planPackInstall(state, HOMES_V1, { modes: DEV, previous: HOMES_V1 }))).toEqual([]);
    const again = applyPlanToState(state, planPackInstall(state, HOMES_V1, { modes: DEV, previous: HOMES_V1 }), 'test-homes', idGen('x'));
    expect(again).toEqual(state);
  });

  it('marks the pipeline default only when the workspace has no default pipeline', () => {
    const { ops } = install();
    const create = ops.find((o) => o.op === 'pipeline.create');
    expect(create && create.op === 'pipeline.create' && create.isDefault).toBe(false);

    const ops2 = planPackInstall(emptyPackState(), { ...HOMES_V1, pipelines: [{ ...HOMES_V1.pipelines[0]!, isDefault: true }] }, { modes: DEV });
    const c2 = ops2.find((o) => o.op === 'pipeline.create');
    expect(c2 && c2.op === 'pipeline.create' && c2.isDefault).toBe(true);
  });

  it('continues field order after existing fields of the same target', () => {
    const s = emptyPackState();
    s.fields.push({ id: 'f0', target: 'lead', key: 'own_field', label: 'Own', type: 'text', config: {}, helpText: null, required: false, unique: false, access: { hiddenFor: [], readOnlyFor: [] }, order: 4, packKey: null, archived: false });
    const { state } = install(s);
    expect(field(state, 'lead', 'budget')!.order).toBe(5);
    expect(field(state, 'lead', 'bhk')!.order).toBe(6);
  });
});

describe('planPackInstall: conflicts', () => {
  it('reports a field key the workspace already uses and writes nothing for it', () => {
    const s = emptyPackState();
    s.fields.push({ id: 'f0', target: 'lead', key: 'budget', label: 'My budget', type: 'number', config: {}, helpText: null, required: false, unique: false, access: { hiddenFor: [], readOnlyFor: [] }, order: 0, packKey: null, archived: false });
    const ops = planPackInstall(s, HOMES_V1, { modes: DEV });
    expect(ops).toContainEqual({ op: 'conflict', kind: 'field', key: 'lead.budget', reason: 'A field with this key already exists' });
    expect(ops.some((o) => o.op === 'field.create' && o.key === 'budget')).toBe(false);
    expect(ops.some((o) => o.op === 'field.update')).toBe(false);
  });

  it('skips an object owned by another pack together with its fields', () => {
    const s = emptyPackState();
    s.objects.push({ id: 'o0', key: 'project', labelSingular: 'Project', labelPlural: 'Projects', icon: 'Box', description: null, primaryFieldKey: 'name', showInNav: true, packKey: 'other-pack', archived: false });
    const ops = planPackInstall(s, HOMES_V1, { modes: DEV });
    expect(ops).toContainEqual({ op: 'conflict', kind: 'object', key: 'project', reason: 'Owned by pack other-pack' });
    expect(ops.some((o) => o.op === 'field.create' && o.target === 'object:project')).toBe(false);
    expect(ops.some((o) => o.op === 'object.create' && o.key === 'unit')).toBe(true);
  });

  it('never changes a field type', () => {
    const { state } = install();
    field(state, 'lead', 'budget')!.type = 'number';
    const ops = planPackInstall(state, HOMES_V1, { modes: DEV, previous: HOMES_V1 });
    expect(ops).toContainEqual({ op: 'conflict', kind: 'field', key: 'lead.budget', reason: 'Type cannot change from number to money' });
  });

  it('never takes over a system role', () => {
    const s = migratedWorkspaceState();
    const ops = planPackInstall(s, { ...HOMES_V1, roles: [{ ...HOMES_V1.roles[0]!, key: 'employee' }] }, { modes: DEV });
    expect(ops).toContainEqual({ op: 'conflict', kind: 'role', key: 'employee', reason: 'System role' });
  });
});

describe('planPackInstall: upgrade (three-way)', () => {
  it('applies only what the manifest changed', () => {
    const { state } = install();
    const v2 = homesV2();
    const ops = planPackInstall(state, v2, { modes: DEV, previous: HOMES_V1 });
    expect(summarizeOps(ops)).toEqual({
      'field.update': 1,
      'field.archive': 1,
      'field.create': 1,
      'stage.update': 1,
      'stage.create': 1,
      'stage.archive': 1,
      'labels.set': 1,
    });
    expect(ops).toContainEqual(expect.objectContaining({ op: 'field.update', key: 'budget', data: { label: 'Budget (INR)' } }));
    expect(ops).toContainEqual(expect.objectContaining({ op: 'field.archive', key: 'bhk' }));
    expect(ops).toContainEqual(expect.objectContaining({ op: 'stage.update', key: 'site_visit', data: { name: 'Site visit done' } }));
    expect(ops).toContainEqual(expect.objectContaining({ op: 'stage.archive', key: 'negotiation' }));

    const upgraded = applyPlanToState(state, ops, 'test-homes', idGen('u'));
    expect(stage(upgraded, 'homes', 'token_paid')).toMatchObject({ order: 5, archived: false });
    expect(upgraded.labelOverrides.lead).toEqual({ singular: 'Buyer', plural: 'Buyers' });
    expect(writeOps(planPackInstall(upgraded, v2, { modes: DEV, previous: v2 }))).toEqual([]);
  });

  it('keeps admin edits', () => {
    const { state } = install();
    field(state, 'lead', 'budget')!.label = 'Budget in lakhs';
    stage(state, 'homes', 'site_visit')!.name = 'Visited';
    state.labelOverrides = { lead: { singular: 'Client', plural: 'Clients' } };
    const ops = planPackInstall(state, homesV2(), { modes: DEV, previous: HOMES_V1 });
    expect(ops.some((o) => o.op === 'field.update' && o.key === 'budget')).toBe(false);
    expect(ops.some((o) => o.op === 'stage.update' && o.key === 'site_visit')).toBe(false);
    expect(ops.some((o) => o.op === 'labels.set')).toBe(false);
  });

  it('keeps a removed stage that still holds leads and reports it', () => {
    const { state } = install();
    stage(state, 'homes', 'negotiation')!.leadCount = 3;
    const ops = planPackInstall(state, homesV2(), { modes: DEV, previous: HOMES_V1 });
    expect(ops.some((o) => o.op === 'stage.archive')).toBe(false);
    expect(ops).toContainEqual({ op: 'conflict', kind: 'stage', key: 'homes.negotiation', reason: 'Kept because 3 leads are in it' });
  });

  it('does not restore or re-create what the admin removed after install', () => {
    const { state } = install();
    field(state, 'lead', 'bhk')!.archived = true;
    const pipeline = state.pipelines[0]!;
    pipeline.stages = pipeline.stages.filter((s) => s.key !== 'negotiation');
    state.roles = [];
    expect(writeOps(planPackInstall(state, HOMES_V1, { modes: DEV, previous: HOMES_V1 }))).toEqual([]);
  });

  it('leaves stages the admin added alone', () => {
    const { state } = install();
    state.pipelines[0]!.stages.push({ id: 'own', key: 'loan', name: 'Loan', type: 'open', probability: 70, color: null, order: 9, archived: false, leadCount: 0 });
    const ops = planPackInstall(state, homesV2(), { modes: DEV, previous: HOMES_V1 });
    expect(ops.some((o) => 'key' in o && o.key === 'loan')).toBe(false);
  });
});

describe('planPackUninstall', () => {
  it('archives everything the pack owns, reverts its labels and keeps templates', () => {
    const { state } = install();
    const ops = planPackUninstall(state, HOMES_V1);
    expect(summarizeOps(ops)).toEqual({ 'object.archive': 2, 'field.archive': 8, 'pipeline.archive': 1, 'role.archive': 1, 'labels.set': 1 });
    const after = applyPlanToState(state, ops, 'test-homes', idGen('x'));
    expect(after.labelOverrides).toEqual({});
    expect(after.templates).toHaveLength(1);
    expect(after.objects.every((o) => o.archived)).toBe(true);
    expect(writeOps(planPackUninstall(after, HOMES_V1))).toEqual([]);
  });

  it('keeps a label the admin changed', () => {
    const { state } = install();
    state.labelOverrides = { lead: { singular: 'Client', plural: 'Clients' } };
    expect(planPackUninstall(state, HOMES_V1).some((o) => o.op === 'labels.set')).toBe(false);
  });

  it('reinstall brings back exactly what was there', () => {
    const { state } = install();
    const removed = applyPlanToState(state, planPackUninstall(state, HOMES_V1), 'test-homes', idGen('x'));
    const ops = planPackInstall(removed, HOMES_V1, { modes: DEV, previous: HOMES_V1, reinstall: true });
    expect(ops.some((o) => o.op.endsWith('.create'))).toBe(false);
    expect(applyPlanToState(removed, ops, 'test-homes', idGen('y'))).toEqual(state);
  });

  it('refuses to uninstall a core pack', () => {
    expect(() => planPackUninstall(emptyPackState(), GENERIC_SALES_MANIFEST)).toThrow(CorePackError);
  });
});

describe('planPackInstall: modes', () => {
  it('switching modes archives items of the old mode and adds the new ones', () => {
    const { state } = install();
    const toBroker = planPackInstall(state, HOMES_V1, { modes: ['broker'], previous: HOMES_V1, previousModes: DEV });
    expect(summarizeOps(toBroker)).toEqual({ 'object.create': 1, 'object.archive': 2, 'field.create': 1, 'field.archive': 6 });
    const broker = applyPlanToState(state, toBroker, 'test-homes', idGen('b'));
    expect(broker.objects.filter((o) => !o.archived).map((o) => o.key)).toEqual(['listing']);

    const back = planPackInstall(broker, HOMES_V1, { modes: DEV, previous: HOMES_V1, previousModes: ['broker'] });
    expect(summarizeOps(back)).toEqual({ 'object.restore': 2, 'object.archive': 1, 'field.restore': 6, 'field.archive': 1 });
  });

  it('items without modes always apply', () => {
    const ops = planPackInstall(emptyPackState(), HOMES_V1, { modes: [] });
    expect(ops.some((o) => o.op === 'object.create')).toBe(false);
    expect(ops.filter((o) => o.op === 'field.create').map((o) => (o.op === 'field.create' ? o.key : ''))).toEqual(['budget', 'bhk']);
    expect(ops.some((o) => o.op === 'pipeline.create')).toBe(true);
  });
});

describe('generic-sales (core pack) and existing workspaces', () => {
  it('fresh workspace gets the default pipeline, fields and template suggestions', () => {
    const ops = planPackInstall(emptyPackState(), GENERIC_SALES_MANIFEST, { modes: [] });
    expect(summarizeOps(ops)).toEqual({ 'pipeline.create': 1, 'field.create': 4, 'template.create': 7 });
    const p = ops.find((o) => o.op === 'pipeline.create');
    expect(p).toMatchObject({ key: 'sales', isDefault: true });
    expect(p && p.op === 'pipeline.create' ? p.stages.map((s) => s.key) : []).toEqual(['new', 'contacted', 'interested', 'quote_sent', 'won', 'lost']);
  });

  it('migrated workspace: adopts the existing pipeline and templates, adds only the new fields', () => {
    const state = migratedWorkspaceState({ deletedStageKeys: ['interested'] });
    const ops = planPackInstall(state, GENERIC_SALES_MANIFEST, { modes: [] });
    expect(summarizeOps(ops)).toEqual({ 'field.create': 4 });
    const after = applyPlanToState(state, ops, 'generic-sales', idGen('g'));
    expect(after.pipelines[0]!.stages.map((s) => s.key)).toEqual(['new', 'contacted', 'quote_sent', 'won', 'lost']);
    expect(writeOps(planPackInstall(after, GENERIC_SALES_MANIFEST, { modes: [], previous: GENERIC_SALES_MANIFEST }))).toEqual([]);
  });

  it('every planned op has a readable description', () => {
    const { state, ops } = install();
    const all = [...ops, ...planPackInstall(state, homesV2(), { modes: DEV, previous: HOMES_V1 }), ...planPackUninstall(state, HOMES_V1)];
    for (const op of all) expect(describeOp(op).length).toBeGreaterThan(5);
  });
});
