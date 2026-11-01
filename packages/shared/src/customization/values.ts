import { z } from 'zod';
import type { FieldError } from '../errors.js';
import { GeoPointSchema, IdSchema, IsoDateTimeSchema, type CustomFieldValue, type CustomFieldValues } from '../schemas/common.js';
import { fieldAccessFor, parseFieldConfig, type FieldDefinition } from './fields.js';

/**
 * Value validation for custom fields (contract). The API runs this on EVERY write to a core entity's
 * `customFields` or a custom object record; the web uses it for inline form errors.
 */
type Def = Pick<FieldDefinition, 'key' | 'label' | 'type' | 'config' | 'required' | 'access' | 'archivedAt'>;

/** Schema for one non-null value of a field. */
export function fieldValueSchema(def: Pick<Def, 'type' | 'config'>): z.ZodType<CustomFieldValue> {
  switch (def.type) {
    case 'text': {
      const c = parseFieldConfig('text', def.config);
      let s = z.string().max(c.maxLength, { error: `At most ${c.maxLength} characters` });
      if (c.pattern) {
        let re: RegExp | null = null;
        try {
          re = new RegExp(c.pattern);
        } catch {
          re = null;
        }
        if (re) s = s.regex(re, { error: c.patternMessage ?? 'This value is not in the expected format' });
      }
      return s;
    }
    case 'number': {
      const c = parseFieldConfig('number', def.config);
      let s = z.number({ error: 'Enter a number' });
      if (c.integer) s = s.int({ error: 'Enter a whole number' });
      if (c.min !== undefined) s = s.min(c.min, { error: `At least ${c.min}` });
      if (c.max !== undefined) s = s.max(c.max, { error: `At most ${c.max}` });
      return s;
    }
    case 'money': {
      const c = parseFieldConfig('money', def.config);
      let s = z.number({ error: 'Enter an amount in rupees' }).int({ error: 'Use whole rupees' });
      if (c.min !== undefined) s = s.min(c.min, { error: `At least ₹${c.min}` });
      if (c.max !== undefined) s = s.max(c.max, { error: `At most ₹${c.max}` });
      return s;
    }
    case 'date': {
      const c = parseFieldConfig('date', def.config);
      return c.withTime ? IsoDateTimeSchema : z.iso.date({ error: 'Use a date like 2026-11-01' });
    }
    case 'select': {
      const c = parseFieldConfig('select', def.config);
      const values = c.options.map((o) => o.value);
      return z.string().refine((v) => values.includes(v), { error: 'Choose one of the listed options' });
    }
    case 'multi_select': {
      const c = parseFieldConfig('multi_select', def.config);
      const values = c.options.map((o) => o.value);
      let s = z
        .array(z.string().refine((v) => values.includes(v), { error: 'Choose from the listed options' }))
        .refine((a) => new Set(a).size === a.length, { error: 'Each option can be chosen once' });
      if (c.maxSelected) s = s.refine((a) => a.length <= (c.maxSelected as number), { error: `Choose at most ${c.maxSelected}` });
      return s;
    }
    case 'user':
    case 'relation':
    case 'file': {
      const c = parseFieldConfig(def.type, def.config) as { multiple: boolean };
      return c.multiple ? z.array(IdSchema).max(200) : IdSchema;
    }
    case 'geo_point':
      return GeoPointSchema;
    case 'boolean':
      return z.boolean({ error: 'Choose yes or no' });
    case 'url':
      return z.url({ error: 'Enter a full link starting with https://' });
  }
}

export interface ValidateOptions {
  /** create: required fields must be present; update: partial patch. */
  mode: 'create' | 'update';
  /** Caller's Role.key for field permissions; null/undefined = system (no field restrictions). */
  roleKey?: string | null;
  /** Error path prefix, e.g. "customFields" or "values". */
  pathPrefix?: string;
}

export type ValidateResult = { ok: true; values: CustomFieldValues } | { ok: false; errors: FieldError[] };

/**
 * Validate custom values against definitions. Rejects unknown keys, archived fields, wrong types,
 * missing required fields (create), clearing required fields (update) and writes to fields the role
 * cannot write. Returns the parsed values (patch in update mode).
 */
export function validateCustomValues(defs: readonly Def[], input: Record<string, unknown> | null | undefined, opts: ValidateOptions): ValidateResult {
  const prefix = opts.pathPrefix ?? 'customFields';
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const errors: FieldError[] = [];
  const out: CustomFieldValues = {};
  const values = input ?? {};

  for (const [key, raw] of Object.entries(values)) {
    const path = `${prefix}.${key}`;
    const def = byKey.get(key);
    if (!def) {
      errors.push({ path, message: 'Unknown field' });
      continue;
    }
    if (def.archivedAt) {
      errors.push({ path, message: `${def.label} is archived and cannot be changed` });
      continue;
    }
    if (fieldAccessFor(def, opts.roleKey) !== 'write') {
      errors.push({ path, message: `You cannot change ${def.label}` });
      continue;
    }
    if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
      if (def.required) errors.push({ path, message: `${def.label} is required` });
      else out[key] = null;
      continue;
    }
    let schema: z.ZodType<CustomFieldValue>;
    try {
      schema = fieldValueSchema(def);
    } catch {
      errors.push({ path, message: `${def.label} has an invalid configuration` });
      continue;
    }
    const r = schema.safeParse(raw);
    if (r.success) out[key] = r.data;
    else errors.push({ path, message: r.error.issues[0]?.message ?? 'Invalid value' });
  }

  if (opts.mode === 'create') {
    for (const def of defs) {
      if (!def.required || def.archivedAt || def.key in values) continue;
      // Required applies only to fields the caller can write.
      if (fieldAccessFor(def, opts.roleKey) !== 'write') continue;
      errors.push({ path: `${prefix}.${def.key}`, message: `${def.label} is required` });
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, values: out };
}

/** Strip values of fields hidden for the role (reads). Unknown/archived keys are kept (data is never lost). */
export function visibleValues(defs: readonly Pick<Def, 'key' | 'access'>[], values: CustomFieldValues | null | undefined, roleKey?: string | null): CustomFieldValues {
  if (!values) return {};
  if (!roleKey) return { ...values };
  const hidden = new Set(defs.filter((d) => fieldAccessFor(d, roleKey) === 'hidden').map((d) => d.key));
  return Object.fromEntries(Object.entries(values).filter(([k]) => !hidden.has(k)));
}

/** Plain-text rendering of a value (exports, previews, notifications). Ids are returned as-is. */
export function formatFieldValue(def: Pick<Def, 'type' | 'config'>, value: CustomFieldValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (def.type === 'boolean') return value ? 'Yes' : 'No';
  if (def.type === 'money' && typeof value === 'number') return `₹${new Intl.NumberFormat('en-IN').format(value)}`;
  if ((def.type === 'select' || def.type === 'multi_select') && def.config) {
    const opts = (def.config as { options?: Array<{ value: string; label: string }> }).options ?? [];
    const label = (v: string) => opts.find((o) => o.value === v)?.label ?? v;
    return Array.isArray(value) ? value.map(label).join(', ') : label(String(value));
  }
  if (def.type === 'geo_point' && typeof value === 'object' && !Array.isArray(value)) return `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`;
  return Array.isArray(value) ? value.join(', ') : String(value);
}
