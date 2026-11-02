import type { CustomFieldValues, CustomRecord, FieldDefinition, FieldError, FieldType } from '@vistar/shared';
import { CITIES, COMPANY_PREFIXES, COMPANY_SUFFIXES, createRng, DAY_MS, hashSeed, int, iso, istDate, mockGstin, mockUsers, pick, worldUuid } from '@vistar/shared/fixtures';

/**
 * Sample records for a custom object (mock DB v2 seed). Values are built from each field's type and
 * config, then checked with the same validator the API uses; values that do not validate are left
 * out, and a record whose required fields cannot be filled is skipped. Deterministic per object key.
 */
type Def = Pick<FieldDefinition, 'key' | 'label' | 'type' | 'config' | 'required' | 'access' | 'archivedAt'> & { unique?: boolean };
type Validate = (defs: readonly Def[], values: Record<string, unknown>) => { ok: true; values: CustomFieldValues } | { ok: false; errors: FieldError[] };

const COORDS: Record<string, { lat: number; lng: number }> = {
  Mumbai: { lat: 19.076, lng: 72.8777 },
  Pune: { lat: 18.5204, lng: 73.8567 },
  Delhi: { lat: 28.7041, lng: 77.1025 },
  Ahmedabad: { lat: 23.0225, lng: 72.5714 },
  Bengaluru: { lat: 12.9716, lng: 77.5946 },
  Chennai: { lat: 13.0827, lng: 80.2707 },
  Ludhiana: { lat: 30.901, lng: 75.8573 },
  Jaipur: { lat: 26.9124, lng: 75.7873 },
};
const PHRASES = ['Bulk supply', 'Monthly contract', 'Priority vendor', 'Under review', 'Approved', 'Trial order', 'Repeat order'];
const RECORDS_PER_OBJECT = 12;

function valueFor(rng: () => number, def: Def, n: number, isPrimary: boolean, used: Set<string>): unknown {
  const c = (def.config ?? {}) as Record<string, unknown>;
  const key = def.key.toLowerCase();
  const city = pick(rng, CITIES);
  const type: FieldType = def.type;
  switch (type) {
    case 'text': {
      const max = typeof c.maxLength === 'number' ? c.maxLength : 500;
      let v: string;
      if (key.includes('gst')) v = mockGstin(rng, city.state);
      else if (c.pattern) return undefined;
      else if (isPrimary || key.includes('name')) {
        v = `${pick(rng, COMPANY_PREFIXES)} ${pick(rng, COMPANY_SUFFIXES)}`;
        if (used.has(v)) v = `${v} ${city.city}`;
        if (used.has(v)) v = `${v} ${n + 1}`;
        used.add(v);
      } else if (key.includes('city')) v = city.city;
      else if (key.includes('state')) v = city.state;
      else if (key.includes('phone') || key.includes('mobile')) v = `+9198${String(int(rng, 10_000_000, 99_999_999))}`;
      else if (key.includes('email')) v = `contact${n + 1}@example.in`;
      else v = pick(rng, PHRASES);
      return v.slice(0, max);
    }
    case 'number': {
      const min = typeof c.min === 'number' ? c.min : 1;
      const max = typeof c.max === 'number' ? c.max : Math.max(min + 1, 100);
      const v = min + rng() * (max - min);
      return c.integer ? Math.round(v) : Math.round(v * 10) / 10;
    }
    case 'money': {
      const min = typeof c.min === 'number' ? c.min : 10_000;
      const max = typeof c.max === 'number' ? c.max : 10_00_000;
      return Math.min(max, Math.max(min, Math.round((min + rng() * (max - min)) / 500) * 500));
    }
    case 'date': {
      const t = Date.now() + int(rng, -60, 45) * DAY_MS;
      return c.withTime ? iso(t) : istDate(t);
    }
    case 'select': {
      const options = (c.options as Array<{ value: string }> | undefined) ?? [];
      return options.length ? pick(rng, options).value : undefined;
    }
    case 'multi_select': {
      const options = (c.options as Array<{ value: string }> | undefined) ?? [];
      if (!options.length) return undefined;
      const max = Math.min(options.length, typeof c.maxSelected === 'number' ? c.maxSelected : 2, 2);
      return [...new Set(Array.from({ length: int(rng, 1, max) }, () => pick(rng, options).value))];
    }
    case 'boolean':
      return rng() < 0.5;
    case 'url':
      return `https://www.example.in/${def.key}/${n + 1}`;
    case 'user': {
      const id = pick(rng, mockUsers().filter((u) => u.role === 'employee' || u.role === 'manager')).id;
      return c.multiple ? [id] : id;
    }
    case 'geo_point':
      return COORDS[city.city] ?? COORDS.Mumbai;
    default:
      // relation and file values need other records or uploads; left empty.
      return undefined;
  }
}

export function seedRecordsFor(objectKey: string, primaryFieldKey: string, defs: readonly Def[], existing: readonly CustomRecord[], validate: Validate): CustomRecord[] {
  const rng = createRng(hashSeed(`records:${objectKey}`));
  const owners = mockUsers().filter((u) => u.role === 'employee' || u.role === 'manager');
  const used = new Set(existing.map((r) => r.title));
  const out: CustomRecord[] = [];
  for (let n = 0; n < RECORDS_PER_OBJECT; n++) {
    let values: Record<string, unknown> = {};
    for (const def of defs) {
      const v = valueFor(rng, def, n, def.key === primaryFieldKey, used);
      if (v !== undefined) values[def.key] = v;
    }
    let result = validate(defs, values);
    if (!result.ok) {
      const bad = new Set(result.errors.map((e) => e.path.split('.').at(-1)));
      values = Object.fromEntries(Object.entries(values).filter(([k]) => !bad.has(k)));
      result = validate(defs, values);
    }
    if (!result.ok) continue;
    const title = result.values[primaryFieldKey];
    const at = Date.now() - int(rng, 1, 40) * DAY_MS - int(rng, 0, 600) * 60_000;
    out.push({
      id: worldUuid(rng),
      objectKey,
      title: typeof title === 'string' ? title : title === null || title === undefined ? '' : String(title),
      values: result.values,
      ownerId: pick(rng, owners).id,
      version: 1,
      createdAt: iso(at),
      updatedAt: iso(at + int(rng, 0, 5) * DAY_MS),
    });
  }
  return out;
}
