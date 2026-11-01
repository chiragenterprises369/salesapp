import {
  applyPlanToState,
  GENERIC_SALES_MANIFEST,
  GENERIC_SALES_PACK_KEY,
  PackManifestSchema,
  planPackInstall,
  writeOps,
  type PackManifest,
  type PackManifestInput,
  type WorkspacePackState,
} from '@vistar/shared';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { tenantClient } from '../../infra/prisma/tenant.js';
import { writeLabelOverrides } from '../customization/labels.store.js';
import { WorkspaceProvisioner } from '../auth/workspace-provisioner.js';
import type { PrismaService } from '../../infra/prisma/prisma.service.js';
import { executePlan, installPack, loadPackState, uninstallPack, type PackRunResult } from './pack-installer.js';
import { loadManifest, PackRegistryError, registerManifest, syncRegistry } from './pack-registry.js';
import { comparableState, createBareWorkspace, deleteTestWorkspace, newTestPrisma, testSuffix } from './testing.js';

/**
 * Executor tests against TEMP workspaces in the dev database (slug test-packs-*). Seeded companies are
 * never touched. A fixture pack (random key) is registered for the run and removed afterwards.
 */

const sfx = testSuffix();
const FX = `test-fx-${sfx}`;

function fixture(version: '1.0.0' | '1.1.0'): PackManifest {
  const v2 = version === '1.1.0';
  const input: PackManifestInput = {
    schemaVersion: 1,
    key: FX,
    name: 'Test fixture',
    version,
    description: 'Executor test fixture (not a real pack)',
    industry: 'Test',
    modes: [
      { key: 'developer', label: 'Developer', default: true },
      { key: 'broker', label: 'Broker' },
    ],
    labels: { lead: v2 ? { singular: 'Buyer', plural: 'Buyers' } : { singular: 'Enquiry', plural: 'Enquiries' } },
    objects: [
      {
        key: 'project',
        labelSingular: 'Project',
        labelPlural: 'Projects',
        primaryFieldKey: 'name',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'parent', label: 'Parent project', type: 'relation', config: { target: 'object:project' } },
          { key: 'buyer', label: 'Buyer', type: 'relation', config: { target: 'lead' } },
        ],
        modes: ['developer'],
      },
      { key: 'listing', labelSingular: 'Listing', labelPlural: 'Listings', primaryFieldKey: 'title', fields: [{ key: 'title', label: 'Title', type: 'text' }], modes: ['broker'] },
    ],
    fields: [
      { target: 'lead', field: { key: 'budget', label: v2 ? 'Budget (INR)' : 'Budget', type: 'money' } },
      v2
        ? { target: 'lead', field: { key: 'possession', label: 'Possession by', type: 'date' } }
        : { target: 'lead', field: { key: 'bhk', label: 'BHK', type: 'select', config: { options: [{ value: 'two', label: '2 BHK' }, { value: 'three', label: '3 BHK' }] } } },
    ],
    pipelines: [
      {
        key: 'homes',
        name: 'Home sales',
        stages: [
          { key: 'enquiry', name: 'Enquiry', type: 'open', probability: 10 },
          { key: 'site_visit', name: v2 ? 'Site visit done' : 'Site visit', type: 'open', probability: 30 },
          ...(v2 ? [{ key: 'token_paid', name: 'Token paid', type: 'open' as const, probability: 80 }] : [{ key: 'negotiation', name: 'Negotiation', type: 'open' as const, probability: 60 }]),
          { key: 'booked', name: 'Booked', type: 'won', probability: 100 },
          { key: 'dropped', name: 'Dropped', type: 'lost', probability: 0 },
        ],
      },
    ],
    roles: [{ key: 'site_executive', name: 'Site executive', kind: 'employee', dataScope: 'own', permissions: ['leads.read', 'records.read'] }],
    whatsappTemplates: [{ name: `visit_confirm_${sfx}`, category: 'utility', body: 'Hi {{1}}, your site visit is confirmed.', variables: ['lead.firstName'] }],
    navigation: [{ id: 'inventory', label: 'Inventory', icon: 'Building2', page: 'inventory', group: 'work', component: `${FX}.InventoryPage`, modes: ['developer'] }],
  };
  return PackManifestSchema.parse(input);
}

let prisma: PrismaClient;
const workspaces: string[] = [];
let ws: { id: string };
let db: ReturnType<typeof tenantClient>;

let n = 0;
const ids = () => `expected-${++n}`;

/** The executor wrote exactly what the pure reference (applyPlanToState) predicts. */
async function expectMatchesReference(before: WorkspacePackState, r: PackRunResult, packKey: string): Promise<WorkspacePackState> {
  const after = await loadPackState(db);
  expect(comparableState(after)).toEqual(comparableState(applyPlanToState(before, r.ops, packKey, ids)));
  return after;
}

const field = (s: WorkspacePackState, target: string, key: string) => s.fields.find((f) => f.target === target && f.key === key);

beforeAll(async () => {
  prisma = newTestPrisma();
  await syncRegistry(prisma);
  await registerManifest(prisma, fixture('1.0.0'));
  await registerManifest(prisma, fixture('1.1.0'));
  ws = await createBareWorkspace(prisma, 'test-packs');
  workspaces.push(ws.id);
  db = tenantClient(prisma, ws.id);
});

afterAll(async () => {
  for (const id of workspaces) await deleteTestWorkspace(prisma, id);
  await prisma.packDefinition.deleteMany({ where: { key: { in: [FX, `test-reg-${sfx}`] } } });
  await prisma.$disconnect();
});

describe('generic-sales (core pack)', () => {
  it('installs into an empty workspace exactly like applyPlanToState, with draft template suggestions', async () => {
    const before = await loadPackState(db);
    const r = await installPack(prisma, ws.id, GENERIC_SALES_PACK_KEY);
    expect(r.status).toBe('success');
    expect(r.summary).toEqual({ 'pipeline.create': 1, 'field.create': 4, 'template.create': 7 });
    const after = await expectMatchesReference(before, r, GENERIC_SALES_PACK_KEY);
    expect(after.pipelines.map((p) => [p.key, p.isDefault, p.packKey])).toEqual([['sales', true, GENERIC_SALES_PACK_KEY]]);
    expect(new Set((await db.template.findMany({ select: { status: true } })).map((t) => t.status))).toEqual(new Set(['draft']));
    const row = await db.workspacePack.findUniqueOrThrow({ where: { workspaceId_packKey: { workspaceId: ws.id, packKey: GENERIC_SALES_PACK_KEY } } });
    expect(row).toMatchObject({ status: 'active', installedVersion: GENERIC_SALES_MANIFEST.version, lastError: null });
  });

  it('second install is a noop (no writes, noop log)', async () => {
    const r = await installPack(prisma, ws.id, GENERIC_SALES_PACK_KEY, { action: 'sync' });
    expect(r.noop).toBe(true);
    expect(writeOps(r.ops)).toEqual([]);
    const log = await db.packInstallLog.findUniqueOrThrow({ where: { id: r.logId } });
    expect(log).toMatchObject({ status: 'noop', action: 'sync' });
  });

  it('cannot be uninstalled', async () => {
    await expect(uninstallPack(prisma, ws.id, GENERIC_SALES_PACK_KEY)).rejects.toMatchObject({ code: 'PACK_CORE_LOCKED' });
  });
});

describe('fixture pack: install, upgrade, uninstall, reinstall', () => {
  let recordId: string;
  let leadId: string;

  it('requires an entitlement (free plan, no grant)', async () => {
    await expect(installPack(prisma, ws.id, FX, { version: '1.0.0' })).rejects.toMatchObject({ code: 'PACK_NOT_ENTITLED' });
    await db.workspacePack.create({ data: { workspaceId: ws.id, packKey: FX, status: 'not_installed', platformOverride: 'grant', overrideReason: 'executor test' } });
  });

  it('installs v1 (developer mode): objects with relation fields, lead fields, pipeline, role, labels', async () => {
    const before = await loadPackState(db);
    const r = await installPack(prisma, ws.id, FX, { version: '1.0.0', modes: ['developer'] });
    expect(r.summary).toEqual({ 'object.create': 1, 'field.create': 5, 'pipeline.create': 1, 'role.create': 1, 'template.create': 1, 'labels.set': 1 });
    const after = await expectMatchesReference(before, r, FX);
    const project = await db.customObject.findFirstOrThrow({ where: { key: 'project' } });
    const fields = await db.customField.findMany({ where: { target: 'object:project' } });
    expect(fields.every((f) => f.customObjectId === project.id && f.packKey === FX)).toBe(true);
    expect(after.labelOverrides.lead).toEqual({ singular: 'Enquiry', plural: 'Enquiries' });
    // The pipeline is not the default: generic-sales already has one.
    expect(after.pipelines.find((p) => p.key === 'homes')).toMatchObject({ isDefault: false, packKey: FX });
  });

  it('reinstall with the same modes is a noop', async () => {
    const r = await installPack(prisma, ws.id, FX, { modes: ['developer'] });
    expect(r.noop).toBe(true);
    expect(writeOps(r.ops)).toEqual([]);
  });

  it('stores user data: a record and a lead value', async () => {
    const project = await db.customObject.findFirstOrThrow({ where: { key: 'project' } });
    const record = await db.customRecord.create({ data: { workspaceId: ws.id, objectId: project.id, title: 'Skyline', values: { name: 'Skyline' } } });
    recordId = record.id;
    const stage = await db.stage.findFirstOrThrow({ where: { key: 'enquiry', pipeline: { key: 'homes' } } });
    const lead = await db.lead.create({ data: { workspaceId: ws.id, name: 'Test buyer', pipelineId: stage.pipelineId, stageId: stage.id, position: 'a0', customFields: { budget: 4_500_000, bhk: 'two' } } });
    leadId = lead.id;
  });

  it('upgrade v1 -> v2 applies the manifest diff and keeps an admin label edit', async () => {
    await writeLabelOverrides(db, ws.id, { lead: { singular: 'Client', plural: 'Clients' } });
    const before = await loadPackState(db);
    const r = await installPack(prisma, ws.id, FX, { action: 'upgrade' });
    expect(r).toMatchObject({ fromVersion: '1.0.0', toVersion: '1.1.0', status: 'success' });
    expect(r.ops.some((o) => o.op === 'labels.set')).toBe(false);
    const after = await expectMatchesReference(before, r, FX);
    expect(after.labelOverrides.lead).toEqual({ singular: 'Client', plural: 'Clients' });
    expect(field(after, 'lead', 'budget')).toMatchObject({ label: 'Budget (INR)', archived: false });
    expect(field(after, 'lead', 'bhk')?.archived).toBe(true);
    expect(field(after, 'lead', 'possession')?.archived).toBe(false);
    const homes = after.pipelines.find((p) => p.key === 'homes')!;
    expect(homes.stages.find((s) => s.key === 'negotiation')?.archived).toBe(true);
    expect(homes.stages.find((s) => s.key === 'token_paid')?.archived).toBe(false);
    expect(homes.stages.find((s) => s.key === 'site_visit')?.name).toBe('Site visit done');
    const again = await installPack(prisma, ws.id, FX, { action: 'upgrade' });
    expect(again.noop).toBe(true);
  });

  it('uninstall archives what the pack owns and keeps records and lead values', async () => {
    const before = await loadPackState(db);
    const r = await uninstallPack(prisma, ws.id, FX);
    expect(r.status).toBe('success');
    const after = await expectMatchesReference(before, r, FX);
    expect(after.objects.filter((o) => o.packKey === FX).every((o) => o.archived)).toBe(true);
    expect(after.fields.filter((f) => f.packKey === FX).every((f) => f.archived)).toBe(true);
    expect(after.pipelines.find((p) => p.key === 'homes')?.archived).toBe(true);
    expect(after.roles.find((x) => x.key === 'site_executive')?.archived).toBe(true);
    // Admin-edited label stays; templates stay.
    expect(after.labelOverrides.lead).toEqual({ singular: 'Client', plural: 'Clients' });
    expect(after.templates.some((t) => t.name === `visit_confirm_${sfx}`)).toBe(true);
    const record = await db.customRecord.findUniqueOrThrow({ where: { id: recordId } });
    expect(record).toMatchObject({ deletedAt: null, values: { name: 'Skyline' } });
    const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead).toMatchObject({ deletedAt: null, customFields: { budget: 4_500_000, bhk: 'two' } });
    const row = await db.workspacePack.findUniqueOrThrow({ where: { workspaceId_packKey: { workspaceId: ws.id, packKey: FX } } });
    expect(row.status).toBe('uninstalled');
    expect((await uninstallPack(prisma, ws.id, FX)).noop).toBe(true);
  });

  it('reinstall restores everything it archived (no re-creates) and is a noop afterwards', async () => {
    const before = await loadPackState(db);
    const r = await installPack(prisma, ws.id, FX, { modes: ['developer'] });
    expect(r.status).toBe('success');
    expect(r.ops.some((o) => o.op.endsWith('.create'))).toBe(false);
    const after = await expectMatchesReference(before, r, FX);
    expect(after.objects.find((o) => o.key === 'project')?.archived).toBe(false);
    expect(after.pipelines.find((p) => p.key === 'homes')?.archived).toBe(false);
    expect(field(after, 'lead', 'budget')?.archived).toBe(false);
    expect((await db.customRecord.findUniqueOrThrow({ where: { id: recordId } })).values).toEqual({ name: 'Skyline' });
    expect((await installPack(prisma, ws.id, FX, { modes: ['developer'] })).noop).toBe(true);
  });

  it('switching modes archives the old mode items and adds the new ones', async () => {
    const before = await loadPackState(db);
    const r = await installPack(prisma, ws.id, FX, { modes: ['broker'] });
    const after = await expectMatchesReference(before, r, FX);
    expect(after.objects.filter((o) => !o.archived && o.packKey === FX).map((o) => o.key)).toEqual(['listing']);
    const back = await installPack(prisma, ws.id, FX, { modes: ['developer'] });
    expect(back.status).toBe('success');
  });

  it('rolls back on failure and records it (WorkspacePack failed + failed log)', async () => {
    const before = comparableState(await loadPackState(db));
    // Not schema-valid on purpose (two pipelines with the same key): the second insert violates the unique key.
    const bad = structuredClone(fixture('1.0.0'));
    bad.key = `${FX}-bad`;
    bad.pipelines = [
      { ...bad.pipelines[0]!, key: 'dup' },
      { ...bad.pipelines[0]!, key: 'dup' },
    ];
    bad.fields = [{ target: 'lead', field: { ...fixture('1.0.0').fields[0]!.field, key: 'bad_field' } }];
    await expect(
      executePlan(prisma, ws.id, bad.key, { action: 'install', manifest: bad, install: { manifest: bad, previous: null, previousModes: [], modes: [], reinstall: false }, actor: { type: 'system', id: null, name: 'test' } }),
    ).rejects.toMatchObject({ code: 'PACK_INSTALL_FAILED' });
    expect(comparableState(await loadPackState(db))).toEqual(before);
    const row = await db.workspacePack.findUniqueOrThrow({ where: { workspaceId_packKey: { workspaceId: ws.id, packKey: bad.key } } });
    expect(row.status).toBe('failed');
    expect(row.lastError).toMatch(/P2002/);
    const logs = await db.packInstallLog.findMany({ where: { packKey: bad.key } });
    expect(logs.map((l) => l.status)).toEqual(['failed']);
  });
});

describe('workspace provisioner', () => {
  it('new workspaces get generic-sales: adopts the pipeline and templates, adds the lead fields', async () => {
    const provisioner = new WorkspaceProvisioner(prisma as unknown as PrismaService);
    const { workspaceId } = await provisioner.provision({
      ownerName: 'Test owner',
      email: `test-packs-${sfx}@example.test`,
      passwordHash: null,
      googleSub: null,
      workspaceName: `test-packs-prov-${sfx}`,
      timezone: 'Asia/Kolkata',
    });
    workspaces.push(workspaceId);
    const t = tenantClient(prisma, workspaceId);
    const row = await t.workspacePack.findUniqueOrThrow({ where: { workspaceId_packKey: { workspaceId, packKey: GENERIC_SALES_PACK_KEY } } });
    expect(row.status).toBe('active');
    const log = await t.packInstallLog.findFirstOrThrow({ where: { packKey: GENERIC_SALES_PACK_KEY } });
    expect(log.summary).toEqual({ 'field.create': 4 });
    expect(await t.pipeline.count()).toBe(1);
    expect(await t.template.count({ where: { status: 'approved' } })).toBe(7);
    const state = await loadPackState(t);
    const manifest = await loadManifest(prisma, GENERIC_SALES_PACK_KEY, row.installedVersion!);
    expect(writeOps(planPackInstall(state, manifest, { modes: [], previous: manifest }))).toEqual([]);
  });
});

describe('registry sync', () => {
  it('registers a manifest file once and refuses a changed manifest under the same version', async () => {
    const key = `test-reg-${sfx}`;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vistar-packs-'));
    try {
      mkdirSync(path.join(dir, key));
      const m = { ...fixture('1.0.0'), key, navigation: [] };
      writeFileSync(path.join(dir, key, 'manifest.json'), JSON.stringify(m));
      expect((await syncRegistry(prisma, { dir })).packs).toEqual([expect.objectContaining({ key, version: '1.0.0', status: 'created' })]);
      expect((await syncRegistry(prisma, { dir })).packs[0]?.status).toBe('unchanged');
      writeFileSync(path.join(dir, key, 'manifest.json'), JSON.stringify({ ...m, description: 'changed without a version bump' }));
      await expect(syncRegistry(prisma, { dir })).rejects.toBeInstanceOf(PackRegistryError);
      const def = await prisma.packDefinition.findUniqueOrThrow({ where: { key }, include: { versions: true } });
      expect(def.versions).toHaveLength(1);
      expect(def.description).toBe(m.description);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
