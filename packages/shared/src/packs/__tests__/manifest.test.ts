import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PACK_MANIFESTS, GENERIC_SALES_MANIFEST } from '../generic-sales.js';
import { compareSemver, defaultModes, itemsForModes, manifestSummary, PackManifestSchema, type PackManifestInput } from '../manifest.js';
import { HOMES_V1, HOMES_V1_INPUT } from './fixtures.js';

const issues = (input: PackManifestInput) => {
  const r = PackManifestSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};
const variant = (patch: (m: PackManifestInput) => void) => {
  const m = structuredClone(HOMES_V1_INPUT);
  patch(m);
  return m;
};

describe('built-in manifests', () => {
  it('packs/<key>/manifest.json files are up to date (run `pnpm --filter @vistar/shared packs`)', () => {
    for (const [key, manifest] of Object.entries(BUILTIN_PACK_MANIFESTS)) {
      const file = fileURLToPath(new URL(`../../../../../packs/${key}/manifest.json`, import.meta.url));
      const json: unknown = JSON.parse(readFileSync(file, 'utf8'));
      expect(json).toEqual(JSON.parse(JSON.stringify(manifest)));
      expect(PackManifestSchema.parse(json)).toEqual(manifest);
    }
  });

  it('generic-sales is a core pack with the default pipeline and shipped templates', () => {
    expect(GENERIC_SALES_MANIFEST.core).toBe(true);
    expect(manifestSummary(GENERIC_SALES_MANIFEST)).toMatchObject({ pipelines: 1, stages: 6, fields: 4, workflowTemplates: 4, whatsappTemplates: 7, importMappings: 1 });
  });
});

describe('PackManifestSchema validation', () => {
  it('accepts the fixture pack', () => {
    expect(issues(HOMES_V1_INPUT)).toEqual([]);
  });

  it('rejects duplicate keys', () => {
    expect(issues(variant((m) => m.fields!.push(m.fields![0]!)))).toContain('Duplicate key "lead.budget"');
  });

  it('rejects relations and fields on unknown objects', () => {
    expect(issues(variant((m) => m.fields!.push({ target: 'object:villa', field: { key: 'x', label: 'X', type: 'text' } })))).toContain('Unknown object "object:villa"');
    expect(
      issues(
        variant((m) => {
          m.objects![1]!.fields[1] = { key: 'project', label: 'Project', type: 'relation', config: { target: 'object:tower' } };
        }),
      ),
    ).toContain('Relation to unknown object "object:tower"');
  });

  it('requires a text title field and a geo_point map field', () => {
    expect(issues(variant((m) => (m.objects![0]!.primaryFieldKey = 'location')))).toContain('Title field must be a text field of the object');
    expect(issues(variant((m) => (m.mapLayers![0]!.geoField = 'name')))).toContain('geoField must be a geo_point field of the object');
  });

  it('rejects unknown modes and components of other packs', () => {
    expect(issues(variant((m) => (m.fields![0]!.modes = ['rental'])))).toContain('Unknown mode "rental"');
    expect(issues(variant((m) => (m.dashboardWidgets![0]!.component = 'other-pack.Widget')))).toContain('Component "other-pack.Widget" must start with "test-homes."');
  });

  it('rejects invalid workflow graphs and bad field configs', () => {
    expect(issues(variant((m) => (m.workflowTemplates ??= []).push({ key: 'empty', name: 'Empty', description: '', graph: { schemaVersion: 1, version: 0, nodes: [], edges: [] } }))).length).toBeGreaterThan(0);
    expect(issues(variant((m) => m.fields!.push({ target: 'lead', field: { key: 'x', label: 'X', type: 'select', config: { options: [] } } })))).toContain('Add at least one option');
  });
});

describe('manifest helpers', () => {
  it('filters items by mode', () => {
    expect(itemsForModes(HOMES_V1.objects, ['broker']).map((o) => o.key)).toEqual(['listing']);
    expect(itemsForModes(HOMES_V1.fields, []).map((f) => f.field.key)).toEqual(['budget', 'bhk']);
  });

  it('default modes are the marked ones, or all modes', () => {
    expect(defaultModes(HOMES_V1)).toEqual(['developer']);
    expect(defaultModes({ modes: [{ key: 'a', label: 'A', default: false }, { key: 'b', label: 'B', default: false }] })).toEqual(['a', 'b']);
  });

  it('compares semantic versions numerically', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('0.9.9', '1.0.0')).toBe(-1);
  });
});
