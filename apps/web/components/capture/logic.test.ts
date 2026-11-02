import { describe, expect, it } from 'vitest';
import { builderProblems, normaliseAnswers, slugKey, validateAnswers, type RenderField } from './logic';

const f = (patch: Partial<RenderField> & Pick<RenderField, 'id' | 'label' | 'type'>): RenderField => ({ required: false, placeholder: null, helpText: null, options: [], param: null, defaultValue: null, mapTo: null, ...patch });

describe('capture form builder rules', () => {
  it('accepts a form with a name and a phone mapping', () => {
    expect(builderProblems([f({ id: 'name', label: 'Name', type: 'text', mapTo: 'name' }), f({ id: 'phone', label: 'Phone', type: 'phone', mapTo: 'phone' })])).toEqual({});
  });

  it('needs a name mapping and a phone or email mapping', () => {
    expect(builderProblems([f({ id: 'phone', label: 'Phone', type: 'phone', mapTo: 'phone' })]).fields).toMatch(/lead name/);
    expect(builderProblems([f({ id: 'name', label: 'Name', type: 'text', mapTo: 'name' })]).fields).toMatch(/phone or the email/);
  });

  it('flags duplicate keys, empty choice lists and fields mapped twice', () => {
    const e = builderProblems([
      f({ id: 'name', label: 'Name', type: 'text', mapTo: 'name' }),
      f({ id: 'name', label: 'Other', type: 'text', mapTo: 'city' }),
      f({ id: 'size', label: 'Size', type: 'select' }),
      f({ id: 'phone', label: 'Phone', type: 'phone', mapTo: 'phone' }),
      f({ id: 'phone2', label: 'Phone 2', type: 'phone', mapTo: 'phone' }),
    ]);
    expect(e['fields.1.id']).toMatch(/unique/);
    expect(e['fields.2.options']).toMatch(/option/);
    expect(e.fields).toMatch(/mapped once/);
  });

  it('turns labels into keys', () => {
    expect(slugKey('Your City?')).toBe('your_city');
    expect(slugKey('2nd phone')).toBe('f_2nd_phone');
  });
});

describe('visitor answers', () => {
  const fields = [f({ id: 'name', label: 'Name', type: 'text', required: true }), f({ id: 'phone', label: 'Mobile', type: 'phone', required: true }), f({ id: 'email', label: 'Email', type: 'email' }), f({ id: 'qty', label: 'Quantity', type: 'number' }), f({ id: 'src', label: 'Source', type: 'hidden', required: true })];

  it('checks required fields, emails, phones and numbers (hidden fields are never asked)', () => {
    const e = validateAnswers(fields, { name: '', phone: '12345', email: 'nope', qty: 'ten' });
    expect(Object.keys(e).sort()).toEqual(['email', 'name', 'phone', 'qty']);
  });

  it('normalises phones and numbers and drops empty answers', () => {
    expect(normaliseAnswers(fields, { name: ' Asha ', phone: '98765 43210', email: '', qty: '12', src: 'diwali' })).toEqual({ name: 'Asha', phone: '+919876543210', qty: 12, src: 'diwali' });
  });
});
