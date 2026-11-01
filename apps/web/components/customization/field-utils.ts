import {
  fieldValueSchema,
  parseFieldConfig,
  parseTarget,
  validateCustomValues,
  type CustomFieldValue,
  type CustomFieldValues,
  type FieldConfig,
  type FieldDefinition,
  type FieldTarget,
  type FieldType,
} from '@vistar/shared';

/** The parts of a field definition the inputs and displays need. */
export type FieldDef = Pick<
  FieldDefinition,
  | 'id'
  | 'key'
  | 'label'
  | 'type'
  | 'config'
  | 'helpText'
  | 'required'
  | 'unique'
  | 'access'
  | 'archivedAt'
  | 'target'
>;

/** Parsed config for a field, or the type defaults when the stored config is invalid (never throws). */
export function configOf<T extends FieldType>(def: { type: T; config: unknown }): FieldConfig<T> {
  try {
    return parseFieldConfig(def.type, def.config);
  } catch {
    try {
      return parseFieldConfig(def.type, {});
    } catch {
      return {} as FieldConfig<T>;
    }
  }
}

export const isEmptyValue = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** 1234567 -> "12,34,567" (Indian digit grouping). */
export const groupIndian = (n: number): string =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 6 }).format(n);

/** Target of a relation field (core entity or object:<key>), or null when the config is broken. */
export function relationTargetOf(def: Pick<FieldDef, 'type' | 'config'>): FieldTarget | null {
  if (def.type !== 'relation') return null;
  try {
    return parseFieldConfig('relation', def.config).target;
  } catch {
    return null;
  }
}

/** Object key of an `object:<key>` target, else null. */
export function objectKeyOf(target: FieldTarget | null): string | null {
  if (!target) return null;
  const t = parseTarget(target);
  return t.kind === 'object' ? t.key : null;
}

const isGeoLike = (v: unknown): v is { lat: unknown; lng: unknown } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'lat' in v && 'lng' in v;

/**
 * Client-side check of one value (same rules as the API: fieldValueSchema + required), with
 * friendlier messages where the raw schema message is technical. Returns null when valid.
 */
export function fieldError(
  def: Pick<FieldDef, 'label' | 'type' | 'config' | 'required'>,
  value: CustomFieldValue | undefined,
): string | null {
  if (isEmptyValue(value)) return def.required ? `${def.label} is required` : null;
  if (def.type === 'geo_point' && isGeoLike(value)) {
    const lat = value.lat;
    const lng = value.lng;
    if (
      typeof lat !== 'number' ||
      Number.isNaN(lat) ||
      typeof lng !== 'number' ||
      Number.isNaN(lng)
    )
      return 'Enter both latitude and longitude as numbers';
    if (lat < -90 || lat > 90) return 'Latitude must be between -90 and 90';
    if (lng < -180 || lng > 180) return 'Longitude must be between -180 and 180';
    return null;
  }
  try {
    const r = fieldValueSchema(def).safeParse(value);
    return r.success ? null : (r.error.issues[0]?.message ?? 'Check this value');
  } catch {
    return `${def.label} has an invalid configuration`;
  }
}

/** Keys whose value differs from the initial values (JSON comparison; empty values are equal). */
export function changedKeys(initial: CustomFieldValues, next: CustomFieldValues): string[] {
  const keys = new Set([...Object.keys(initial), ...Object.keys(next)]);
  return [...keys].filter((k) => {
    const a = initial[k];
    const b = next[k];
    if (isEmptyValue(a) && isEmptyValue(b)) return false;
    return JSON.stringify(a) !== JSON.stringify(b);
  });
}

/**
 * Final client gate before a write: validateCustomValues (the same function the API runs) on the
 * payload. Returns field errors keyed by field key.
 */
export function validatePayload(
  defs: readonly FieldDef[],
  payload: CustomFieldValues,
  opts: { mode: 'create' | 'update'; roleKey?: string | null },
): Record<string, string> {
  const r = validateCustomValues(defs, payload, { ...opts, pathPrefix: 'v' });
  if (r.ok) return {};
  return Object.fromEntries(r.errors.map((e) => [e.path.replace(/^v\./, ''), e.message]));
}

/**
 * Server field errors (ApiRequestError details via fieldErrorMap) keyed by field key.
 * Accepts `values.<key>` (records) and `customFields.<key>` (core entities).
 */
export function serverFieldErrors(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, message] of Object.entries(map)) {
    const m = /^(?:values|customFields)\.([a-z][a-z0-9_]*)/.exec(path);
    if (m?.[1]) out[m[1]] = message;
  }
  return out;
}

/** Safe external href: only http(s) links are rendered as links. */
export function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Short, human-readable reference for ids we cannot resolve ("…3f2a1c"). */
export const shortId = (id: string) => `…${id.replace(/-/g, '').slice(-6)}`;
