import { WHATSAPP_TEMPLATE_FIXTURES } from '../fixtures/india.js';
import { DEFAULT_STAGES } from '../schemas/pipeline.js';
import { WORKFLOW_TEMPLATES } from '../workflow/templates.js';
import { PackManifestSchema, type PackManifest, type PackManifestInput } from './manifest.js';

/**
 * "Generic Sales": the core pack every workspace has. It describes what a new workspace gets today
 * (the "sales" pipeline with DEFAULT_STAGES, the shipped workflow templates and WhatsApp template
 * suggestions) plus a few common lead fields and the IndiaMART import mapping.
 *
 * Source of truth for `packs/generic-sales/manifest.json` (written by `pnpm --filter @vistar/shared packs`;
 * a test fails if the file is stale).
 */
export const GENERIC_SALES_PACK_KEY = 'generic-sales';
/** Key of the default pipeline in every workspace (backfilled for existing workspaces). */
export const DEFAULT_PIPELINE_KEY = 'sales';

export const GENERIC_SALES_MANIFEST_INPUT: PackManifestInput = {
  schemaVersion: 1,
  key: GENERIC_SALES_PACK_KEY,
  name: 'Generic Sales',
  version: '1.0.0',
  description: 'Lead pipeline, follow-up workflows and WhatsApp templates for any business that sells by phone and WhatsApp.',
  industry: 'General',
  icon: 'BriefcaseBusiness',
  core: true,
  modes: [],
  labels: {},
  objects: [],
  fields: [
    {
      target: 'lead',
      field: {
        key: 'gst_number',
        label: 'GST number',
        type: 'text',
        helpText: '15-character GSTIN of the buyer',
        config: {
          maxLength: 15,
          pattern: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$',
          patternMessage: 'Enter a valid 15-character GSTIN, e.g. 24ABCDE1234F1Z5',
        },
      },
    },
    { target: 'lead', field: { key: 'quantity', label: 'Quantity required', type: 'text', helpText: 'e.g. 500 kg or 20 pieces', config: { maxLength: 80 } } },
    {
      target: 'lead',
      field: {
        key: 'preferred_language',
        label: 'Preferred language',
        type: 'select',
        config: {
          options: [
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'Hindi' },
            { value: 'gu', label: 'Gujarati' },
            { value: 'mr', label: 'Marathi' },
            { value: 'ta', label: 'Tamil' },
            { value: 'te', label: 'Telugu' },
            { value: 'kn', label: 'Kannada' },
            { value: 'bn', label: 'Bengali' },
          ],
        },
      },
    },
    { target: 'lead', field: { key: 'delivery_by', label: 'Delivery by', type: 'date', config: {} } },
  ],
  pipelines: [
    {
      key: DEFAULT_PIPELINE_KEY,
      name: 'Sales',
      isDefault: true,
      stages: DEFAULT_STAGES.map((s) => ({ key: s.key, name: s.name, type: s.type, probability: s.probability })),
    },
  ],
  roles: [],
  workflowTemplates: WORKFLOW_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, graph: t.graph })),
  whatsappTemplates: WHATSAPP_TEMPLATE_FIXTURES.map((t) => ({ name: t.name, category: t.category, language: 'en', body: t.body, variables: [...t.variables] })),
  dashboardWidgets: [],
  reports: [],
  importMappings: [
    {
      key: 'indiamart_csv',
      name: 'IndiaMART enquiries',
      source: 'indiamart',
      target: 'lead',
      fields: [
        { from: 'UNIQUE_QUERY_ID', to: 'sourceRef', transform: 'trim' },
        { from: 'SENDER_NAME', to: 'name', transform: 'trim' },
        { from: 'SENDER_COMPANY', to: 'companyName', transform: 'trim' },
        { from: 'SENDER_MOBILE', to: 'phone', transform: 'phone_in' },
        { from: 'SENDER_EMAIL', to: 'email', transform: 'lower' },
        { from: 'SENDER_CITY', to: 'city', transform: 'trim' },
        { from: 'SENDER_STATE', to: 'state', transform: 'trim' },
        { from: 'QUERY_PRODUCT_NAME', to: 'productInterest', transform: 'trim' },
        { from: 'QUERY_MESSAGE', to: 'requirement', transform: 'none' },
        { from: 'QUERY_QUANTITY', to: 'custom.quantity', transform: 'trim' },
      ],
      defaults: { source: 'indiamart' },
    },
  ],
  navigation: [],
  mapLayers: [],
};

/** Parsed (defaults applied) Generic Sales manifest. */
export const GENERIC_SALES_MANIFEST: PackManifest = PackManifestSchema.parse(GENERIC_SALES_MANIFEST_INPUT);

/** Manifests shipped in this repo (`packs/<key>/manifest.json`), keyed by pack key. */
export const BUILTIN_PACK_MANIFESTS: Readonly<Record<string, PackManifest>> = {
  [GENERIC_SALES_PACK_KEY]: GENERIC_SALES_MANIFEST,
};
