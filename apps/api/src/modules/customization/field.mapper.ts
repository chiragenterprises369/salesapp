import {
  CustomFieldValuesSchema,
  DEFAULT_FIELD_ACCESS,
  FieldAccessSchema,
  FieldDefinitionSchema,
  type CustomFieldValues,
  type FieldDefinition,
} from '@vistar/shared';
import type { CustomField as FieldRow } from '../../generated/prisma/client.js';

/** Stored row -> FieldDefinition (API shape). Rows that no longer match the contract are skipped (null). */
export function toFieldDefinition(r: FieldRow): FieldDefinition | null {
  const access = FieldAccessSchema.safeParse(r.access ?? {});
  const parsed = FieldDefinitionSchema.safeParse({
    id: r.id,
    target: r.target,
    key: r.key,
    label: r.label,
    type: r.type,
    config: r.config && typeof r.config === 'object' && !Array.isArray(r.config) ? r.config : {},
    helpText: r.helpText,
    required: r.required,
    unique: r.isUnique,
    access: access.success ? access.data : DEFAULT_FIELD_ACCESS,
    order: r.order,
    packKey: r.packKey,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

export function toFieldDefinitions(rows: readonly FieldRow[]): FieldDefinition[] {
  return rows.map(toFieldDefinition).filter((d): d is FieldDefinition => d !== null);
}

/** Display order: order, then key (stable). */
export const FIELD_ORDER = [{ order: 'asc' as const }, { key: 'asc' as const }];

/** Stored JSON -> custom values ({} when the JSON is not a values object). */
export function parseValues(json: unknown): CustomFieldValues {
  const r = CustomFieldValuesSchema.safeParse(json);
  return r.success ? r.data : {};
}
