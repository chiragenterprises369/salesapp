import { describe, expect, it } from 'vitest';
import { CustomObjectSpecSchema } from '../objects.js';
import { FieldDefinitionUpdateSchema, FieldSpecSchema, FieldTargetSchema, fieldAccessFor, parseTarget, visibleFields } from '../fields.js';
import { DEFAULT_LABELS, labelOf, resolveLabels } from '../labels.js';

describe('FieldSpecSchema', () => {
  it('applies defaults for config and access', () => {
    expect(FieldSpecSchema.parse({ key: 'note', label: 'Note', type: 'text' })).toEqual({
      key: 'note',
      label: 'Note',
      type: 'text',
      required: false,
      unique: false,
      access: { hiddenFor: [], readOnlyFor: [] },
      config: { maxLength: 500, multiline: false },
    });
  });

  it('requires options for choice fields and a target for relations', () => {
    expect(FieldSpecSchema.safeParse({ key: 'bhk', label: 'BHK', type: 'select' }).success).toBe(false);
    expect(FieldSpecSchema.safeParse({ key: 'bhk', label: 'BHK', type: 'select', config: { options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] } }).success).toBe(false);
    expect(FieldSpecSchema.safeParse({ key: 'unit', label: 'Unit', type: 'relation', config: {} }).success).toBe(false);
  });

  it('rejects bad keys', () => {
    expect(FieldSpecSchema.safeParse({ key: 'Bad Key', label: 'X', type: 'text' }).success).toBe(false);
    expect(FieldSpecSchema.safeParse({ key: '1abc', label: 'X', type: 'text' }).success).toBe(false);
  });

  it('PATCH body has no defaults', () => {
    expect(FieldDefinitionUpdateSchema.parse({ label: 'New' })).toEqual({ label: 'New' });
  });
});

describe('targets', () => {
  it('accepts core entities and object targets', () => {
    expect(FieldTargetSchema.safeParse('lead').success).toBe(true);
    expect(FieldTargetSchema.safeParse('object:site_visit').success).toBe(true);
    expect(FieldTargetSchema.safeParse('object:').success).toBe(false);
    expect(FieldTargetSchema.safeParse('invoice').success).toBe(false);
    expect(parseTarget('object:unit')).toEqual({ kind: 'object', key: 'unit' });
    expect(parseTarget('task')).toEqual({ kind: 'core', entity: 'task' });
  });
});

describe('field access and visibility', () => {
  const defs = [
    { target: 'lead', order: 2, archivedAt: null, access: { hiddenFor: [], readOnlyFor: [] }, key: 'b' },
    { target: 'lead', order: 1, archivedAt: null, access: { hiddenFor: ['viewer'], readOnlyFor: [] }, key: 'a' },
    { target: 'lead', order: 0, archivedAt: '2026-11-01T00:00:00.000Z', access: { hiddenFor: [], readOnlyFor: [] }, key: 'old' },
    { target: 'contact', order: 0, archivedAt: null, access: { hiddenFor: [], readOnlyFor: [] }, key: 'c' },
  ] as const;

  it('orders active fields of the target and hides per role', () => {
    expect(visibleFields(defs, 'lead').map((d) => d.key)).toEqual(['a', 'b']);
    expect(visibleFields(defs, 'lead', 'viewer').map((d) => d.key)).toEqual(['b']);
    expect(fieldAccessFor({ access: { hiddenFor: [], readOnlyFor: ['employee'] } }, 'employee')).toBe('read');
    expect(fieldAccessFor({ access: { hiddenFor: ['employee'], readOnlyFor: [] } }, null)).toBe('write');
  });
});

describe('custom objects', () => {
  it('needs a text title field among its fields', () => {
    const base = { key: 'supplier', labelSingular: 'Supplier', labelPlural: 'Suppliers', primaryFieldKey: 'name', fields: [{ key: 'name', label: 'Name', type: 'text' }] };
    expect(CustomObjectSpecSchema.safeParse(base).success).toBe(true);
    expect(CustomObjectSpecSchema.safeParse({ ...base, primaryFieldKey: 'gst' }).success).toBe(false);
    expect(CustomObjectSpecSchema.safeParse({ ...base, fields: [{ key: 'name', label: 'Name', type: 'number' }] }).success).toBe(false);
    expect(CustomObjectSpecSchema.safeParse({ ...base, fields: [...base.fields, ...base.fields] }).success).toBe(false);
  });
});

describe('labels', () => {
  it('merges overrides over defaults', () => {
    const labels = resolveLabels({ lead: { singular: 'Enquiry', plural: 'Enquiries' } });
    expect(labelOf(labels, 'lead')).toBe('Enquiry');
    expect(labelOf(labels, 'lead', { plural: true, lower: true })).toBe('enquiries');
    expect(labelOf(labels, 'deal')).toBe('Deal');
    expect(resolveLabels(null)).toEqual(DEFAULT_LABELS);
  });
});
