import { describe, expect, it } from 'vitest';
import type { FieldType } from '../fields.js';
import { formatFieldValue, validateCustomValues, visibleValues } from '../values.js';

const ID = '0190f5a0-0000-7000-8000-000000000001';
const ID2 = '0190f5a0-0000-7000-8000-000000000002';

const def = (key: string, type: FieldType, config: Record<string, unknown> = {}, extra: Partial<{ required: boolean; hiddenFor: string[]; readOnlyFor: string[]; archived: boolean }> = {}) => ({
  key,
  label: key,
  type,
  config,
  required: extra.required ?? false,
  access: { hiddenFor: extra.hiddenFor ?? [], readOnlyFor: extra.readOnlyFor ?? [] },
  archivedAt: extra.archived ? '2026-11-01T10:00:00.000Z' : null,
});

const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }];

const one = (d: ReturnType<typeof def>, value: unknown) => validateCustomValues([d], { [d.key]: value }, { mode: 'update' });
const ok = (d: ReturnType<typeof def>, value: unknown) => expect(one(d, value)).toMatchObject({ ok: true });
const bad = (d: ReturnType<typeof def>, value: unknown, message?: string) => {
  const r = one(d, value);
  expect(r.ok).toBe(false);
  if (!r.ok && message) expect(r.errors[0]!.message).toBe(message);
};

describe('validateCustomValues: field types', () => {
  it('text: length and pattern', () => {
    ok(def('t', 'text', { maxLength: 5 }), 'abcde');
    bad(def('t', 'text', { maxLength: 5 }), 'abcdef', 'At most 5 characters');
    const gst = def('gst', 'text', { maxLength: 15, pattern: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$', patternMessage: 'Invalid GSTIN' });
    ok(gst, '24ABCDE1234F1Z5');
    bad(gst, '24abcde1234f1z5', 'Invalid GSTIN');
    bad(def('t', 'text'), 42);
  });

  it('number: min, max, integer', () => {
    const n = def('n', 'number', { min: 1, max: 10, integer: true });
    ok(n, 5);
    bad(n, 0, 'At least 1');
    bad(n, 11, 'At most 10');
    bad(n, 2.5, 'Enter a whole number');
    bad(n, '5');
  });

  it('money: whole rupees', () => {
    ok(def('m', 'money'), 150000);
    bad(def('m', 'money'), 10.5, 'Use whole rupees');
    bad(def('m', 'money', { min: 0 }), -1);
  });

  it('date and date-time', () => {
    ok(def('d', 'date'), '2026-11-01');
    bad(def('d', 'date'), '01-11-2026');
    ok(def('dt', 'date', { withTime: true }), '2026-11-01T10:15:00.000+05:30');
    bad(def('dt', 'date', { withTime: true }), '2026-11-01');
  });

  it('select and multi-select', () => {
    ok(def('s', 'select', { options }), 'a');
    bad(def('s', 'select', { options }), 'z', 'Choose one of the listed options');
    ok(def('ms', 'multi_select', { options }), ['a', 'b']);
    bad(def('ms', 'multi_select', { options }), ['a', 'a'], 'Each option can be chosen once');
    bad(def('ms', 'multi_select', { options, maxSelected: 2 }), ['a', 'b', 'c'], 'Choose at most 2');
    bad(def('ms', 'multi_select', { options }), 'a');
  });

  it('user, relation and file hold ids', () => {
    ok(def('u', 'user'), ID);
    bad(def('u', 'user'), [ID]);
    ok(def('u', 'user', { multiple: true }), [ID, ID2]);
    ok(def('r', 'relation', { target: 'object:project' }), ID);
    bad(def('r', 'relation', { target: 'object:project' }), 'not-an-id');
    ok(def('f', 'file', { multiple: true }), [ID]);
  });

  it('geo-point, boolean and url', () => {
    ok(def('g', 'geo_point'), { lat: 23.0225, lng: 72.5714 });
    bad(def('g', 'geo_point'), { lat: 100, lng: 72 });
    ok(def('b', 'boolean'), false);
    bad(def('b', 'boolean'), 'yes', 'Choose yes or no');
    ok(def('w', 'url'), 'https://vistar.example');
    bad(def('w', 'url'), 'vistar');
  });
});

describe('validateCustomValues: rules', () => {
  const defs = [def('name', 'text', {}, { required: true }), def('note', 'text'), def('old', 'text', {}, { archived: true })];

  it('create requires required fields; update does not', () => {
    expect(validateCustomValues(defs, {}, { mode: 'create' })).toEqual({ ok: false, errors: [{ path: 'customFields.name', message: 'name is required' }] });
    expect(validateCustomValues(defs, { note: 'x' }, { mode: 'update' })).toEqual({ ok: true, values: { note: 'x' } });
  });

  it('a required field cannot be cleared; optional fields clear to null', () => {
    expect(validateCustomValues(defs, { name: '' }, { mode: 'update' }).ok).toBe(false);
    expect(validateCustomValues(defs, { note: '' }, { mode: 'update' })).toEqual({ ok: true, values: { note: null } });
  });

  it('rejects unknown keys and archived fields', () => {
    const r = validateCustomValues(defs, { nope: 1, old: 'x' }, { mode: 'update', pathPrefix: 'values' });
    expect(r).toEqual({
      ok: false,
      errors: [
        { path: 'values.nope', message: 'Unknown field' },
        { path: 'values.old', message: 'old is archived and cannot be changed' },
      ],
    });
  });

  it('enforces per-role read-only and hidden fields', () => {
    const roleDefs = [def('margin', 'money', {}, { hiddenFor: ['employee'] }), def('discount', 'number', {}, { readOnlyFor: ['employee'], required: true })];
    expect(validateCustomValues(roleDefs, { discount: 5 }, { mode: 'update', roleKey: 'employee' }).ok).toBe(false);
    expect(validateCustomValues(roleDefs, { margin: 5 }, { mode: 'update', roleKey: 'employee' }).ok).toBe(false);
    // Required applies only to fields the caller can write.
    expect(validateCustomValues(roleDefs, {}, { mode: 'create', roleKey: 'employee' }).ok).toBe(true);
    expect(validateCustomValues(roleDefs, { discount: 5 }, { mode: 'create', roleKey: 'company_admin' }).ok).toBe(true);
    expect(visibleValues(roleDefs, { margin: 1000, discount: 5, legacy: 'kept' }, 'employee')).toEqual({ discount: 5, legacy: 'kept' });
    expect(visibleValues(roleDefs, { margin: 1000 }, null)).toEqual({ margin: 1000 });
  });
});

describe('formatFieldValue', () => {
  it('renders values as plain text', () => {
    expect(formatFieldValue(def('m', 'money'), 150000)).toBe('₹1,50,000');
    expect(formatFieldValue(def('s', 'select', { options }), 'b')).toBe('Beta');
    expect(formatFieldValue(def('ms', 'multi_select', { options }), ['a', 'c'])).toBe('Alpha, Gamma');
    expect(formatFieldValue(def('b', 'boolean'), true)).toBe('Yes');
    expect(formatFieldValue(def('g', 'geo_point'), { lat: 23.0225, lng: 72.5714 })).toBe('23.02250, 72.57140');
    expect(formatFieldValue(def('t', 'text'), null)).toBe('');
  });
});
