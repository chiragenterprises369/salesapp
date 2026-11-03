import type { ConfigFieldState, ConfigGroup } from '@vistar/shared';
import { describe, expect, it } from 'vitest';
import { buildConfigBody, initialDraft, initialDrafts, isFieldActive, valueToText } from './logic';

/** Written for change #20; not run in this wave (static checks only). Run: pnpm --filter @vistar/web test components/config */

const field = (over: Partial<ConfigFieldState> & Pick<ConfigFieldState, 'key' | 'type'>): ConfigFieldState => ({
  label: over.key,
  secret: over.type === 'secret',
  help: null,
  placeholder: null,
  required: false,
  active: true,
  when: null,
  options: null,
  min: null,
  max: null,
  value: null,
  panelValue: null,
  source: 'none',
  envVar: null,
  defaultValue: null,
  secretSet: false,
  secretHint: null,
  ...over,
});

const email: Pick<ConfigGroup, 'key' | 'fields'> = {
  key: 'email',
  fields: [
    field({ key: 'provider', type: 'select', options: [{ value: 'smtp', label: 'SMTP' }, { value: 'resend', label: 'Resend' }], value: 'smtp', panelValue: 'smtp', source: 'panel' }),
    field({ key: 'smtpHost', type: 'text', when: { field: 'provider', in: ['smtp'] }, value: 'smtp.env.example', source: 'env', envVar: 'SMTP_HOST' }),
    field({ key: 'smtpPort', type: 'number', when: { field: 'provider', in: ['smtp'] }, value: 587, defaultValue: 587, source: 'default' }),
    field({ key: 'smtpPassword', type: 'secret', when: { field: 'provider', in: ['smtp'] }, secretSet: true, secretHint: '••••abcd', source: 'panel' }),
    field({ key: 'apiKey', type: 'secret', when: { field: 'provider', in: ['resend', 'sendgrid'] } }),
    field({ key: 'fromEmail', type: 'email', panelValue: 'no-reply@vistar.app', value: 'no-reply@vistar.app', source: 'panel' }),
  ],
};

describe('config registry drafts', () => {
  it('starts from panel values only (env and defaults stay fallbacks)', () => {
    const d = initialDrafts(email);
    expect(d.provider!.text).toBe('smtp');
    expect(d.smtpHost!.text).toBeNull();
    expect(d.smtpPort!.text).toBeNull();
    expect(d.smtpPassword).toEqual({ text: null, bool: null, secret: null, clearSecret: false });
  });

  it('lists as one item per line', () => {
    expect(valueToText(['10.0.0.0/8', '203.0.113.7'])).toBe('10.0.0.0/8\n203.0.113.7');
    expect(initialDraft(field({ key: 'allow', type: 'list', panelValue: ['1.2.3.4'] })).text).toBe('1.2.3.4');
  });

  it('shows fields whose condition holds for the draft, not only the saved value', () => {
    const d = initialDrafts(email);
    const smtpHost = email.fields[1]!;
    const apiKey = email.fields[4]!;
    expect(isFieldActive(smtpHost, email.fields, d)).toBe(true);
    expect(isFieldActive(apiKey, email.fields, d)).toBe(false);
    const switched = { ...d, provider: { ...d.provider!, text: 'resend' } };
    expect(isFieldActive(smtpHost, email.fields, switched)).toBe(false);
    expect(isFieldActive(apiKey, email.fields, switched)).toBe(true);
  });
});

describe('config save body', () => {
  it('is empty when nothing changed', () => {
    expect(buildConfigBody(email, initialDrafts(email))).toEqual({ values: {}, errors: {} });
  });

  it('sends changed keys only, numbers parsed, and null to clear a panel value', () => {
    const d = initialDrafts(email);
    d.smtpHost = { ...d.smtpHost!, text: ' smtp.zoho.in ' };
    d.smtpPort = { ...d.smtpPort!, text: '465' };
    d.fromEmail = { ...d.fromEmail!, text: null };
    expect(buildConfigBody(email, d)).toEqual({ values: { smtpHost: 'smtp.zoho.in', smtpPort: 465, fromEmail: null }, errors: {} });
  });

  it('never sends a secret unless a new value was typed or it was removed', () => {
    const d = initialDrafts(email);
    d.smtpPassword = { ...d.smtpPassword!, secret: '' };
    expect(buildConfigBody(email, d).errors.smtpPassword).toMatch(/new value/);
    d.smtpPassword = { ...d.smtpPassword!, secret: 'n3w-s3cret' };
    expect(buildConfigBody(email, d).values).toEqual({ smtpPassword: 'n3w-s3cret' });
    d.smtpPassword = { text: null, bool: null, secret: null, clearSecret: true };
    expect(buildConfigBody(email, d).values).toEqual({ smtpPassword: null });
  });

  it('validates with the shared field schema (port range, e-mail)', () => {
    const d = initialDrafts(email);
    d.smtpPort = { ...d.smtpPort!, text: '70000' };
    d.fromEmail = { ...d.fromEmail!, text: 'not-an-email' };
    const { values, errors } = buildConfigBody(email, d);
    expect(values).toEqual({});
    expect(Object.keys(errors).sort()).toEqual(['fromEmail', 'smtpPort']);
  });

  it('rejects text in number fields', () => {
    const d = initialDrafts(email);
    d.smtpPort = { ...d.smtpPort!, text: 'abc' };
    expect(buildConfigBody(email, d).errors.smtpPort).toBe('Enter a number.');
  });
});
