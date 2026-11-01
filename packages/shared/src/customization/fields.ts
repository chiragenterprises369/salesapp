import { z } from 'zod';
import { ROLE_KINDS } from '../enums.js';
import { IdSchema, IsoDateTimeSchema } from '../schemas/common.js';

/**
 * FLEXIBLE DATA LAYER: field definitions (contract). Stored in the database (`CustomField`), never in code.
 * A field targets a core entity (`lead`, `contact`, ...) or a custom object (`object:<key>`).
 * Values are validated with `validateCustomValues()` (customization/values.ts) on every write.
 */
export const CORE_ENTITIES = ['lead', 'contact', 'company', 'deal', 'task', 'call'] as const;
export const CoreEntitySchema = z.enum(CORE_ENTITIES);
export type CoreEntity = z.infer<typeof CoreEntitySchema>;

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const FieldKeySchema = z.string().regex(KEY_RE, { error: 'Use lowercase letters, digits and _ (start with a letter)' });
export const ObjectKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, { error: 'Use lowercase letters, digits and _ (start with a letter)' });
/** Role reference by `Role.key` (system roles use the kind name; custom roles their slug). */
export const RoleKeyRefSchema = z.string().regex(/^[a-z0-9_]{1,60}$/);

export type ObjectTarget = `object:${string}`;
export type FieldTarget = CoreEntity | ObjectTarget;
export const OBJECT_TARGET_RE = /^object:[a-z][a-z0-9_]{1,39}$/;
export const FieldTargetSchema = z.union([CoreEntitySchema, z.string().regex(OBJECT_TARGET_RE)]) as z.ZodType<FieldTarget>;

export const objectTarget = (key: string): ObjectTarget => `object:${key}`;
export function parseTarget(target: string): { kind: 'core'; entity: CoreEntity } | { kind: 'object'; key: string } {
  if (target.startsWith('object:')) return { kind: 'object', key: target.slice('object:'.length) };
  return { kind: 'core', entity: target as CoreEntity };
}

/** Field types (spec 22.1) plus boolean and url kept from the earlier custom fields. */
export const FIELD_TYPES = [
  'text',
  'number',
  'money',
  'date',
  'select',
  'multi_select',
  'user',
  'relation',
  'file',
  'geo_point',
  'boolean',
  'url',
] as const;
export const FieldTypeSchema = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  number: 'Number',
  money: 'Money (INR)',
  date: 'Date',
  select: 'Single choice',
  multi_select: 'Multiple choice',
  user: 'Team member',
  relation: 'Link to record',
  file: 'File',
  geo_point: 'Location',
  boolean: 'Yes / no',
  url: 'Link (URL)',
};

export const SelectOptionSchema = z.object({
  value: z.string().regex(/^[a-z0-9_]{1,40}$/, { error: 'Option values use lowercase letters, digits and _' }),
  label: z.string().trim().min(1).max(60),
  color: z.enum(['neutral', 'indigo', 'blue', 'green', 'amber', 'grey', 'red']).optional(),
});
export type SelectOption = z.infer<typeof SelectOptionSchema>;

const options = z
  .array(SelectOptionSchema)
  .min(1, { error: 'Add at least one option' })
  .max(100)
  .refine((o) => new Set(o.map((x) => x.value)).size === o.length, { error: 'Option values must be unique' });

/** Per-type configuration. `parseFieldConfig(type, raw)` validates a stored config. */
export const FIELD_CONFIG_SCHEMAS = {
  text: z.object({
    maxLength: z.number().int().min(1).max(10_000).default(500),
    multiline: z.boolean().default(false),
    pattern: z.string().max(300).optional().describe('Regular expression the value must match'),
    patternMessage: z.string().max(120).optional(),
  }),
  number: z.object({ min: z.number().optional(), max: z.number().optional(), integer: z.boolean().default(false), unit: z.string().max(12).optional() }),
  money: z.object({ min: z.number().int().optional(), max: z.number().int().optional() }),
  date: z.object({ withTime: z.boolean().default(false) }),
  select: z.object({ options }),
  multi_select: z.object({ options, maxSelected: z.number().int().min(1).max(100).optional() }),
  user: z.object({ multiple: z.boolean().default(false), roleKinds: z.array(z.enum(ROLE_KINDS)).default([]) }),
  relation: z.object({
    target: FieldTargetSchema.describe('Core entity or object:<key> the field links to'),
    multiple: z.boolean().default(false),
    inverseLabel: z.string().max(60).optional().describe('Label shown on the linked record, e.g. "Units"'),
  }),
  file: z.object({ multiple: z.boolean().default(false), accept: z.array(z.string().max(80)).default([]), maxSizeMb: z.number().int().min(1).max(100).default(10) }),
  geo_point: z.object({}),
  boolean: z.object({}),
  url: z.object({}),
} as const satisfies Record<FieldType, z.ZodType>;

export type FieldConfig<T extends FieldType = FieldType> = z.output<(typeof FIELD_CONFIG_SCHEMAS)[T]>;

/** Validate a stored/incoming config for a type. Throws ZodError on invalid config. */
export function parseFieldConfig<T extends FieldType>(type: T, raw: unknown): FieldConfig<T> {
  return FIELD_CONFIG_SCHEMAS[type].parse(raw ?? {}) as FieldConfig<T>;
}

/**
 * Field-level access by role key. Hidden = not returned by the API for that role; read-only = returned,
 * never writable by that role. Record-level permissions still apply first.
 */
export const FieldAccessSchema = z.object({
  hiddenFor: z.array(RoleKeyRefSchema).default([]),
  readOnlyFor: z.array(RoleKeyRefSchema).default([]),
});
export type FieldAccess = z.infer<typeof FieldAccessSchema>;
export const DEFAULT_FIELD_ACCESS: FieldAccess = { hiddenFor: [], readOnlyFor: [] };

const common = {
  key: FieldKeySchema,
  label: z.string().trim().min(1).max(60),
  helpText: z.string().max(200).optional(),
  required: z.boolean().default(false),
  unique: z.boolean().default(false).describe('Value must be unique per target in the workspace'),
  access: FieldAccessSchema.prefault({}),
};
const spec = <T extends FieldType, C extends z.ZodType>(type: T, config: C) => z.object({ ...common, type: z.literal(type), config });

/** A field as authored (Settings, API create body, pack manifests). */
export const FieldSpecSchema = z.discriminatedUnion('type', [
  spec('text', FIELD_CONFIG_SCHEMAS.text.prefault({})),
  spec('number', FIELD_CONFIG_SCHEMAS.number.prefault({})),
  spec('money', FIELD_CONFIG_SCHEMAS.money.prefault({})),
  spec('date', FIELD_CONFIG_SCHEMAS.date.prefault({})),
  spec('select', FIELD_CONFIG_SCHEMAS.select),
  spec('multi_select', FIELD_CONFIG_SCHEMAS.multi_select),
  spec('user', FIELD_CONFIG_SCHEMAS.user.prefault({})),
  spec('relation', FIELD_CONFIG_SCHEMAS.relation),
  spec('file', FIELD_CONFIG_SCHEMAS.file.prefault({})),
  spec('geo_point', FIELD_CONFIG_SCHEMAS.geo_point.prefault({})),
  spec('boolean', FIELD_CONFIG_SCHEMAS.boolean.prefault({})),
  spec('url', FIELD_CONFIG_SCHEMAS.url.prefault({})),
]);
export type FieldSpec = z.output<typeof FieldSpecSchema>;
export type FieldSpecInput = z.input<typeof FieldSpecSchema>;

/** A persisted field definition (API response). `config` matches FIELD_CONFIG_SCHEMAS[type]. */
export const FieldDefinitionSchema = z.object({
  id: IdSchema,
  target: FieldTargetSchema,
  key: FieldKeySchema,
  label: z.string(),
  type: FieldTypeSchema,
  config: z.record(z.string(), z.unknown()),
  helpText: z.string().nullable(),
  required: z.boolean(),
  unique: z.boolean(),
  access: FieldAccessSchema,
  order: z.number().int(),
  /** Pack that created the field (null = created by the workspace). Pack fields keep key and type locked. */
  packKey: z.string().nullable(),
  archivedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const FieldDefinitionCreateSchema = z.object({ target: FieldTargetSchema, field: FieldSpecSchema });
export type FieldDefinitionCreate = z.input<typeof FieldDefinitionCreateSchema>;

/** PATCH body (no defaults). Key, type and target are immutable; config is re-validated for the type. */
export const FieldDefinitionUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    helpText: z.string().max(200).nullable(),
    required: z.boolean(),
    unique: z.boolean(),
    access: z.object({ hiddenFor: z.array(RoleKeyRefSchema), readOnlyFor: z.array(RoleKeyRefSchema) }),
    config: z.record(z.string(), z.unknown()),
  })
  .partial();
export type FieldDefinitionUpdate = z.infer<typeof FieldDefinitionUpdateSchema>;

export const FieldReorderSchema = z.object({ target: FieldTargetSchema, fieldIds: z.array(IdSchema).min(1) });

export const FieldListQuerySchema = z.object({
  target: FieldTargetSchema.optional(),
  includeArchived: z.stringbool().optional(),
});

/** Access of one role to one field. */
export function fieldAccessFor(def: Pick<FieldDefinition, 'access'>, roleKey: string | null | undefined): 'hidden' | 'read' | 'write' {
  if (!roleKey) return 'write';
  if (def.access.hiddenFor.includes(roleKey)) return 'hidden';
  if (def.access.readOnlyFor.includes(roleKey)) return 'read';
  return 'write';
}

/** Active (not archived) fields for a target, in display order, visible to the role. */
export function visibleFields<T extends Pick<FieldDefinition, 'target' | 'access' | 'archivedAt' | 'order'>>(
  defs: readonly T[],
  target: FieldTarget,
  roleKey?: string | null,
): T[] {
  return defs
    .filter((d) => d.target === target && !d.archivedAt && fieldAccessFor(d, roleKey) !== 'hidden')
    .sort((a, b) => a.order - b.order);
}
