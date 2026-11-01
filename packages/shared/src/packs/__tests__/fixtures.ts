import { DEFAULT_STAGES } from '../../schemas/pipeline.js';
import { WHATSAPP_TEMPLATE_FIXTURES } from '../../fixtures/india.js';
import { PackManifestSchema, type PackManifest, type PackManifestInput } from '../manifest.js';
import { emptyPackState, type WorkspacePackState } from '../planner.js';

/** Test-only pack with objects, relations, modes, a pipeline, a role, labels and runtime items. Not a real pack. */
export const HOMES_V1_INPUT: PackManifestInput = {
  schemaVersion: 1,
  key: 'test-homes',
  name: 'Test Homes',
  version: '1.0.0',
  description: 'Fixture pack for planner tests',
  industry: 'Test',
  modes: [
    { key: 'developer', label: 'Developer', default: true },
    { key: 'broker', label: 'Broker' },
  ],
  labels: { lead: { singular: 'Enquiry', plural: 'Enquiries' } },
  objects: [
    {
      key: 'project',
      labelSingular: 'Project',
      labelPlural: 'Projects',
      primaryFieldKey: 'name',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'location', label: 'Location', type: 'geo_point' },
      ],
      modes: ['developer'],
    },
    {
      key: 'unit',
      labelSingular: 'Unit',
      labelPlural: 'Units',
      primaryFieldKey: 'code',
      fields: [
        { key: 'code', label: 'Unit code', type: 'text', required: true },
        { key: 'project', label: 'Project', type: 'relation', config: { target: 'object:project' } },
        { key: 'price', label: 'Price', type: 'money' },
      ],
      modes: ['developer'],
    },
    {
      key: 'listing',
      labelSingular: 'Listing',
      labelPlural: 'Listings',
      primaryFieldKey: 'title',
      fields: [{ key: 'title', label: 'Title', type: 'text' }],
      modes: ['broker'],
    },
  ],
  fields: [
    { target: 'lead', field: { key: 'budget', label: 'Budget', type: 'money' } },
    {
      target: 'lead',
      field: {
        key: 'bhk',
        label: 'BHK',
        type: 'select',
        config: { options: [{ value: '1bhk', label: '1 BHK' }, { value: '2bhk', label: '2 BHK' }, { value: '3bhk', label: '3 BHK' }] },
      },
    },
    { target: 'lead', field: { key: 'site_visit_on', label: 'Site visit on', type: 'date' }, modes: ['developer'] },
  ],
  pipelines: [
    {
      key: 'homes',
      name: 'Home sales',
      stages: [
        { key: 'enquiry', name: 'Enquiry', type: 'open', probability: 10 },
        { key: 'site_visit', name: 'Site visit', type: 'open', probability: 30 },
        { key: 'negotiation', name: 'Negotiation', type: 'open', probability: 60 },
        { key: 'booked', name: 'Booked', type: 'won', probability: 100 },
        { key: 'dropped', name: 'Dropped', type: 'lost', probability: 0 },
      ],
    },
  ],
  roles: [{ key: 'site_executive', name: 'Site executive', kind: 'employee', dataScope: 'own', permissions: ['leads.read', 'records.read'] }],
  whatsappTemplates: [{ name: 'site_visit_confirm', category: 'utility', body: 'Hi {{1}}, your site visit is confirmed.', variables: ['lead.firstName'] }],
  navigation: [{ id: 'inventory', label: 'Inventory', icon: 'Building2', page: 'inventory', group: 'work', component: 'test-homes.InventoryPage', modes: ['developer'] }],
  dashboardWidgets: [{ key: 'visits_today', title: 'Site visits today', slot: 'dashboard.main', component: 'test-homes.VisitsToday' }],
  mapLayers: [{ key: 'projects', title: 'Projects', source: 'object:project', geoField: 'location', modes: ['developer'] }],
};

export const HOMES_V1: PackManifest = PackManifestSchema.parse(HOMES_V1_INPUT);

/**
 * v1.1.0: budget relabelled, BHK removed, possession date added, negotiation stage removed,
 * token_paid stage added, site_visit renamed, lead label changed.
 */
export function homesV2(): PackManifest {
  const m = structuredClone(HOMES_V1_INPUT);
  m.version = '1.1.0';
  m.labels = { lead: { singular: 'Buyer', plural: 'Buyers' } };
  m.fields = [
    { target: 'lead', field: { key: 'budget', label: 'Budget (INR)', type: 'money' } },
    { target: 'lead', field: { key: 'site_visit_on', label: 'Site visit on', type: 'date' }, modes: ['developer'] },
    { target: 'lead', field: { key: 'possession', label: 'Possession by', type: 'date' } },
  ];
  const stages = m.pipelines![0]!.stages;
  m.pipelines![0]!.stages = [
    stages[0]!,
    { ...stages[1]!, name: 'Site visit done' },
    { key: 'token_paid', name: 'Token paid', type: 'open', probability: 80 },
    stages[3]!,
    stages[4]!,
  ];
  return PackManifestSchema.parse(m);
}

export function idGen(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** A workspace created before packs existed, after migration 20261101180000 (pipeline adopted by generic-sales). */
export function migratedWorkspaceState(opts: { deletedStageKeys?: string[] } = {}): WorkspacePackState {
  const s = emptyPackState();
  s.pipelines.push({
    id: 'pipe-sales',
    key: 'sales',
    name: 'Sales',
    isDefault: true,
    packKey: 'generic-sales',
    archived: false,
    stages: DEFAULT_STAGES.filter((st) => !opts.deletedStageKeys?.includes(st.key)).map((st, order) => ({
      id: `stage-${st.key}`,
      key: st.key,
      name: st.name,
      type: st.type,
      probability: st.probability,
      color: null,
      order,
      archived: false,
      leadCount: 4,
    })),
  });
  s.templates.push(...WHATSAPP_TEMPLATE_FIXTURES.map((t, i) => ({ id: `tpl-${i}`, name: t.name, language: 'en', packKey: 'generic-sales' })));
  s.roles.push(
    ...(['company_admin', 'manager', 'employee', 'viewer'] as const).map((kind) => ({
      id: `role-${kind}`,
      key: kind,
      name: kind,
      kind,
      dataScope: 'all' as const,
      permissions: [],
      isSystem: true,
      packKey: null,
      archived: false,
    })),
  );
  return s;
}
