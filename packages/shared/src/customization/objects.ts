import { z } from 'zod';
import { CursorPaginationQuerySchema, CustomFieldValuesSchema, IdSchema, IsoDateTimeSchema, SortDirSchema } from '../schemas/common.js';
import { FieldDefinitionSchema, FieldKeySchema, FieldSpecSchema, ObjectKeySchema } from './fields.js';

/**
 * Custom objects (contract): workspace-defined record types with their own fields and relations
 * (e.g. Project, Unit, Site visit from a pack, or an admin-created "Supplier").
 * Records live in `CustomRecord`; values are validated like core custom fields.
 */
export const CustomObjectSchema = z.object({
  id: IdSchema,
  key: ObjectKeySchema,
  labelSingular: z.string(),
  labelPlural: z.string(),
  /** lucide-react icon name */
  icon: z.string(),
  description: z.string().nullable(),
  /** Text field used as the record title. */
  primaryFieldKey: FieldKeySchema,
  showInNav: z.boolean(),
  packKey: z.string().nullable(),
  archivedAt: IsoDateTimeSchema.nullable(),
  fields: z.array(FieldDefinitionSchema),
  recordCount: z.number().int().optional(),
  createdAt: IsoDateTimeSchema,
});
export type CustomObject = z.infer<typeof CustomObjectSchema>;

export const CustomObjectSpecSchema = z
  .object({
    key: ObjectKeySchema,
    labelSingular: z.string().trim().min(1).max(40),
    labelPlural: z.string().trim().min(1).max(40),
    icon: z.string().max(40).default('Box'),
    description: z.string().max(300).optional(),
    primaryFieldKey: FieldKeySchema,
    showInNav: z.boolean().default(true),
    fields: z.array(FieldSpecSchema).min(1).max(100),
  })
  .superRefine((o, ctx) => {
    const keys = o.fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Field keys must be unique' });
    const primary = o.fields.find((f) => f.key === o.primaryFieldKey);
    if (!primary) ctx.addIssue({ code: 'custom', path: ['primaryFieldKey'], message: 'The title field must be one of the fields' });
    else if (primary.type !== 'text') ctx.addIssue({ code: 'custom', path: ['primaryFieldKey'], message: 'The title field must be a text field' });
  });
export type CustomObjectSpec = z.output<typeof CustomObjectSpecSchema>;

export const CustomObjectCreateSchema = CustomObjectSpecSchema;
export const CustomObjectUpdateSchema = z
  .object({
    labelSingular: z.string().trim().min(1).max(40),
    labelPlural: z.string().trim().min(1).max(40),
    icon: z.string().max(40),
    description: z.string().max(300).nullable(),
    primaryFieldKey: FieldKeySchema,
    showInNav: z.boolean(),
  })
  .partial();

export const ObjectKeyParamSchema = z.object({ key: ObjectKeySchema });
export const RecordParamSchema = z.object({ key: ObjectKeySchema, id: IdSchema });

export const CustomRecordSchema = z.object({
  id: IdSchema,
  objectKey: ObjectKeySchema,
  /** Denormalised value of the object's primary (title) field. */
  title: z.string(),
  values: CustomFieldValuesSchema,
  ownerId: IdSchema.nullable(),
  version: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type CustomRecord = z.infer<typeof CustomRecordSchema>;

export const CustomRecordCreateSchema = z.object({
  values: CustomFieldValuesSchema,
  ownerId: IdSchema.optional().describe('Defaults to the caller'),
});
export type CustomRecordCreate = z.infer<typeof CustomRecordCreateSchema>;

export const CustomRecordUpdateSchema = z.object({
  values: CustomFieldValuesSchema.optional().describe('Patch: only the given keys change; null clears a value'),
  ownerId: IdSchema.nullable().optional(),
  expectedVersion: z.number().int().optional(),
});
export type CustomRecordUpdate = z.infer<typeof CustomRecordUpdateSchema>;

export const CustomRecordListQuerySchema = CursorPaginationQuerySchema.extend({
  q: z.string().trim().max(200).optional().describe('Searches the title'),
  ownerId: z.union([IdSchema, z.literal('me'), z.literal('unassigned')]).optional(),
  /** Reverse relation lookup: records whose relation field `<fieldKey>` contains `<id>`. */
  related: z.string().regex(/^[a-z][a-z0-9_]{0,39}:[0-9a-f-]{36}$/).optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'title']).default('createdAt'),
  dir: SortDirSchema.default('desc'),
});
export type CustomRecordListQuery = z.infer<typeof CustomRecordListQuerySchema>;
