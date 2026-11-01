import { PackManifestSchema, type PackManifest } from '@vistar/shared';

/**
 * MOCK-ONLY demo pack ("Suppliers (demo)") so Settings > Industry, the Super Admin registry and the
 * extension points (nav item, pack page, widget slot, custom object) can be exercised before a real
 * non-core pack exists. Not in `packs/`, never synced to the API registry, not an industry pack.
 */
export const DEMO_PACK_KEY = 'demo-suppliers';

export const DEMO_PACK_MANIFEST: PackManifest = PackManifestSchema.parse({
  schemaVersion: 1,
  key: DEMO_PACK_KEY,
  name: 'Suppliers (demo)',
  version: '0.1.0',
  description: 'Mock-data demo of an add-on pack: a Suppliers object, a lead field, a page and a dashboard widget.',
  industry: 'Demo',
  icon: 'Truck',
  modes: [
    { key: 'basic', label: 'Basic', description: 'Supplier list only', default: true },
    { key: 'ratings', label: 'Ratings', description: 'Adds supplier ratings' },
  ],
  labels: {},
  objects: [
    {
      key: 'supplier',
      labelSingular: 'Supplier',
      labelPlural: 'Suppliers',
      icon: 'Truck',
      primaryFieldKey: 'name',
      showInNav: false,
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true, unique: true },
        { key: 'city', label: 'City', type: 'text' },
        { key: 'gst_number', label: 'GST number', type: 'text', config: { maxLength: 15 } },
        { key: 'monthly_volume', label: 'Monthly volume', type: 'money' },
        { key: 'categories', label: 'Categories', type: 'multi_select', config: { options: [{ value: 'raw', label: 'Raw material' }, { value: 'packaging', label: 'Packaging' }, { value: 'logistics', label: 'Logistics' }] } },
      ],
    },
  ],
  fields: [
    { target: 'lead', field: { key: 'preferred_supplier', label: 'Preferred supplier', type: 'relation', config: { target: 'object:supplier' } } },
    { target: 'object:supplier', field: { key: 'rating', label: 'Rating', type: 'number', config: { min: 1, max: 5, integer: true } }, modes: ['ratings'] },
  ],
  navigation: [
    { id: 'suppliers', label: 'Suppliers', icon: 'Truck', page: 'suppliers', group: 'work', panels: ['company'], anyOf: ['records.read'], component: 'demo-suppliers.SuppliersPage' },
  ],
  dashboardWidgets: [{ key: 'supplier_count', title: 'Suppliers', slot: 'dashboard.side', component: 'demo-suppliers.SupplierCount', size: 'sm', anyOf: ['records.read'] }],
});
