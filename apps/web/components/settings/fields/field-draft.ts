import {
  DEFAULT_FIELD_ACCESS,
  FieldSpecSchema,
  parseFieldConfig,
  type FieldAccess,
  type FieldDefinition,
  type FieldDefinitionUpdate,
  type FieldSpecInput,
  type FieldType,
  type RoleKind,
  type SelectOption,
} from '@vistar/shared';

/**
 * Editor state for one field (Settings > Custom fields, custom object create flow). Inputs keep
 * strings so half-typed numbers do not jump; `draftToSpec` builds the FieldSpec the API validates.
 */
export type AccessLevel = 'write' | 'read' | 'hidden';
export type OptionColor = NonNullable<SelectOption['color']>;

export interface OptionDraft {
  uid: string;
  value: string;
  label: string;
  color: OptionColor | '';
  /** Value typed by hand: stop following the label. */
  valueEdited: boolean;
  /** Saved option: its value is stored in records, so it cannot change. */
  locked: boolean;
}

export interface FieldDraft {
  label: string;
  key: string;
  keyEdited: boolean;
  type: FieldType;
  helpText: string;
  required: boolean;
  unique: boolean;
  /** Only roles that are not "write" are stored. */
  access: Record<string, AccessLevel>;
  text: { maxLength: string; multiline: boolean; pattern: string; patternMessage: string };
  number: { min: string; max: string; integer: boolean; unit: string };
  money: { min: string; max: string };
  date: { withTime: boolean };
  options: OptionDraft[];
  maxSelected: string;
  user: { multiple: boolean; roleKinds: RoleKind[] };
  relation: { target: string; multiple: boolean; inverseLabel: string };
  file: { multiple: boolean; accept: string; maxSizeMb: string };
}

/** Types where "unique" makes sense (one value that can be compared). */
export const UNIQUE_TYPES: ReadonlySet<FieldType> = new Set(['text', 'number', 'money', 'date', 'url']);

let uidSeq = 0;
export const optionUid = () => `opt-${(uidSeq += 1)}`;

export function emptyDraft(type: FieldType = 'text'): FieldDraft {
  return {
    label: '',
    key: '',
    keyEdited: false,
    type,
    helpText: '',
    required: false,
    unique: false,
    access: {},
    text: { maxLength: '500', multiline: false, pattern: '', patternMessage: '' },
    number: { min: '', max: '', integer: false, unit: '' },
    money: { min: '', max: '' },
    date: { withTime: false },
    options: [],
    maxSelected: '',
    user: { multiple: false, roleKinds: [] },
    relation: { target: 'lead', multiple: false, inverseLabel: '' },
    file: { multiple: false, accept: '', maxSizeMb: '10' },
  };
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

function accessToDraft(access: FieldAccess): Record<string, AccessLevel> {
  const out: Record<string, AccessLevel> = {};
  for (const k of access.readOnlyFor) out[k] = 'read';
  for (const k of access.hiddenFor) out[k] = 'hidden';
  return out;
}

export function draftToAccess(access: Record<string, AccessLevel>): FieldAccess {
  const entries = Object.entries(access);
  return { hiddenFor: entries.filter(([, v]) => v === 'hidden').map(([k]) => k), readOnlyFor: entries.filter(([, v]) => v === 'read').map(([k]) => k) };
}

/** Draft from a stored definition or an unsaved spec. `lockOptions` = options already saved. */
export function draftFrom(input: { key: string; label: string; type: FieldType; config?: unknown; helpText?: string | null; required?: boolean; unique?: boolean; access?: Partial<FieldAccess> }, lockOptions: boolean): FieldDraft {
  const d = emptyDraft(input.type);
  let c: Record<string, unknown> = {};
  try {
    c = parseFieldConfig(input.type, input.config ?? {}) as Record<string, unknown>;
  } catch {
    c = (input.config ?? {}) as Record<string, unknown>;
  }
  d.label = input.label;
  d.key = input.key;
  d.keyEdited = true;
  d.helpText = input.helpText ?? '';
  d.required = !!input.required;
  d.unique = !!input.unique;
  d.access = accessToDraft({ ...DEFAULT_FIELD_ACCESS, ...input.access });
  switch (input.type) {
    case 'text':
      d.text = { maxLength: str(c.maxLength ?? 500), multiline: !!c.multiline, pattern: str(c.pattern), patternMessage: str(c.patternMessage) };
      break;
    case 'number':
      d.number = { min: str(c.min), max: str(c.max), integer: !!c.integer, unit: str(c.unit) };
      break;
    case 'money':
      d.money = { min: str(c.min), max: str(c.max) };
      break;
    case 'date':
      d.date = { withTime: !!c.withTime };
      break;
    case 'select':
    case 'multi_select':
      d.options = ((c.options as SelectOption[] | undefined) ?? []).map((o) => ({ uid: optionUid(), value: o.value, label: o.label, color: o.color ?? '', valueEdited: true, locked: lockOptions }));
      d.maxSelected = str(c.maxSelected);
      break;
    case 'user':
      d.user = { multiple: !!c.multiple, roleKinds: (c.roleKinds as RoleKind[] | undefined) ?? [] };
      break;
    case 'relation':
      d.relation = { target: str(c.target) || 'lead', multiple: !!c.multiple, inverseLabel: str(c.inverseLabel) };
      break;
    case 'file':
      d.file = { multiple: !!c.multiple, accept: ((c.accept as string[] | undefined) ?? []).join(', '), maxSizeMb: str(c.maxSizeMb ?? 10) };
      break;
    default:
      break;
  }
  return d;
}

export const draftFromDefinition = (def: FieldDefinition) => draftFrom(def, true);

/** Optional number input: '' = not set. Invalid text becomes NaN so validation reports it. */
const optNum = (s: string) => (s.trim() === '' ? undefined : Number(s));
const optStr = (s: string) => (s.trim() === '' ? undefined : s.trim());

export function configOf(d: FieldDraft): Record<string, unknown> {
  switch (d.type) {
    case 'text':
      return { maxLength: optNum(d.text.maxLength) ?? 500, multiline: d.text.multiline, pattern: optStr(d.text.pattern), patternMessage: optStr(d.text.patternMessage) };
    case 'number':
      return { min: optNum(d.number.min), max: optNum(d.number.max), integer: d.number.integer, unit: optStr(d.number.unit) };
    case 'money':
      return { min: optNum(d.money.min), max: optNum(d.money.max) };
    case 'date':
      return { withTime: d.date.withTime };
    case 'select':
      return { options: d.options.map((o) => ({ value: o.value, label: o.label.trim(), ...(o.color ? { color: o.color } : {}) })) };
    case 'multi_select':
      return { options: d.options.map((o) => ({ value: o.value, label: o.label.trim(), ...(o.color ? { color: o.color } : {}) })), maxSelected: optNum(d.maxSelected) };
    case 'user':
      return { multiple: d.user.multiple, roleKinds: d.user.roleKinds };
    case 'relation':
      return { target: d.relation.target, multiple: d.relation.multiple, inverseLabel: optStr(d.relation.inverseLabel) };
    case 'file':
      return {
        multiple: d.file.multiple,
        accept: d.file.accept
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        maxSizeMb: optNum(d.file.maxSizeMb) ?? 10,
      };
    default:
      return {};
  }
}

/** Strip undefined so stored configs stay small. */
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function draftToSpec(d: FieldDraft): FieldSpecInput {
  return {
    key: d.key.trim(),
    label: d.label.trim(),
    type: d.type,
    config: clean(configOf(d)),
    helpText: optStr(d.helpText),
    required: d.required,
    unique: UNIQUE_TYPES.has(d.type) ? d.unique : false,
    access: draftToAccess(d.access),
  } as FieldSpecInput;
}

/** PATCH body for an existing field (key, type and target never change). */
export function specToPatch(spec: FieldSpecInput): FieldDefinitionUpdate {
  return {
    label: spec.label,
    helpText: spec.helpText ?? null,
    required: spec.required ?? false,
    unique: spec.unique ?? false,
    access: { hiddenFor: spec.access?.hiddenFor ?? [], readOnlyFor: spec.access?.readOnlyFor ?? [] },
    config: (spec.config ?? {}) as Record<string, unknown>,
  };
}

function friendly(path: string, message: string, d: FieldDraft): string {
  if (path === 'label') return 'Enter a label (up to 60 characters)';
  if (path === 'helpText') return 'Use up to 200 characters';
  if (/^config\.options\.\d+\.label$/.test(path)) return 'Enter a label for this option';
  if (path === 'config.maxLength') return 'Use a whole number from 1 to 10,000';
  if (path === 'config.maxSizeMb' || path === 'config.maxSelected') return 'Use a whole number from 1 to 100';
  if ((path === 'config.min' || path === 'config.max') && d.type === 'money') return 'Use a whole number of rupees';
  if (path === 'config.min' || path === 'config.max') return 'Enter a number';
  if (path === 'config.target') return 'Choose what this field links to';
  if (path === 'config.unit') return 'Use up to 12 characters';
  return message;
}

/** Client-side check with the shared schema plus rules the schema cannot express. Keys: dotted paths. */
export function validateDraft(d: FieldDraft, opts: { takenKeys?: readonly string[] } = {}): Record<string, string> {
  const errors: Record<string, string> = {};
  const spec = draftToSpec(d);
  const r = FieldSpecSchema.safeParse(spec);
  if (!r.success) {
    for (const issue of r.error.issues) {
      const path = issue.path.map(String).join('.');
      if (!errors[path]) errors[path] = friendly(path, issue.message, d);
    }
  }
  if (!d.key.trim()) errors.key = 'Enter a key';
  if (opts.takenKeys?.includes(d.key.trim())) errors.key = 'Another field already uses this key';
  if (d.type === 'text' && d.text.pattern.trim()) {
    try {
      new RegExp(d.text.pattern);
    } catch {
      errors['config.pattern'] = 'This is not a valid pattern';
    }
  }
  const range = d.type === 'number' ? d.number : d.type === 'money' ? d.money : null;
  if (range && !errors['config.min'] && !errors['config.max']) {
    const min = optNum(range.min);
    const max = optNum(range.max);
    if (min !== undefined && max !== undefined && min > max) errors['config.max'] = 'Must be at least the minimum';
  }
  if ((d.type === 'select' || d.type === 'multi_select') && !errors['config.options']) {
    const seen = new Set<string>();
    d.options.forEach((o, i) => {
      if (seen.has(o.value) && !errors[`config.options.${i}.value`]) errors[`config.options.${i}.value`] = 'Another option uses this value';
      seen.add(o.value);
    });
  }
  return errors;
}
