import { normalizeIndianPhone, type CaptureField } from '@vistar/shared';

/**
 * Pure rules of the lead capture builder and renderer (unit-tested): the same checks the API runs on
 * a form definition, and the visitor-side answer checks and normalisation.
 */
export type RenderField = Omit<CaptureField, 'mapTo'> & { mapTo?: CaptureField['mapTo'] };
export type FormValue = string | number | boolean | string[] | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Client-side checks that mirror the API (required, email, phone, number). */
export function validateAnswers(fields: readonly RenderField[], values: Record<string, FormValue>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.type === 'hidden') continue;
    const v = values[f.id];
    const empty = v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
    if (f.required && empty) {
      errors[f.id] = f.type === 'checkbox' ? 'Tick this box to continue.' : `Enter ${f.label.toLowerCase()}.`;
      continue;
    }
    if (empty) continue;
    if (f.type === 'email' && typeof v === 'string' && !EMAIL_RE.test(v.trim())) errors[f.id] = 'Enter an email like name@company.com.';
    if (f.type === 'phone' && typeof v === 'string' && !(normalizeIndianPhone(v) || /^\+[1-9]\d{6,14}$/.test(v.trim()))) errors[f.id] = 'Enter a 10-digit mobile number.';
    if (f.type === 'number' && typeof v === 'string' && !/^-?\d+(\.\d+)?$/.test(v.trim())) errors[f.id] = 'Enter a number.';
  }
  return errors;
}

/** Answers as the submit route expects them (phones normalised, numbers as numbers, trimmed text, empties dropped). */
export function normaliseAnswers(fields: readonly RenderField[], values: Record<string, FormValue>): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  for (const f of fields) {
    const v = values[f.id];
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (f.type === 'phone' && typeof v === 'string') out[f.id] = normalizeIndianPhone(v) ?? v.trim();
    else if (f.type === 'number' && typeof v === 'string') out[f.id] = Number(v);
    else if (typeof v === 'string') out[f.id] = v.trim();
    else out[f.id] = v;
  }
  return out;
}

/** Same rules as the API (unique keys, options for choices, one field for the name and one for phone or email, each lead field once). */
export function builderProblems(fields: ReadonlyArray<{ id: string; label: string; type: string; options: readonly unknown[]; mapTo?: string | null }>): Record<string, string> {
  const e: Record<string, string> = {};
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(f.id)) e[`fields.${i}.id`] = 'Keys start with a letter and use a-z, 0-9 and _.';
    else if (seen.has(f.id)) e[`fields.${i}.id`] = 'Field keys must be unique.';
    seen.add(f.id);
    if (!f.label.trim()) e[`fields.${i}.label`] = 'Enter a label.';
    if ((f.type === 'select' || f.type === 'multi_select') && !f.options.length) e[`fields.${i}.options`] = 'Add at least one option.';
  });
  const targets = fields.map((f) => f.mapTo).filter((t): t is string => !!t);
  if (!targets.includes('name')) e.fields = 'Map one field to the lead name.';
  else if (!targets.includes('phone') && !targets.includes('email')) e.fields = 'Map one field to the phone or the email.';
  const mapped = targets.filter((t) => t !== 'tags');
  if (new Set(mapped).size !== mapped.length) e.fields = 'Each lead field can be mapped once.';
  if (fields.length > 40) e.fields = 'A form has at most 40 fields.';
  return e;
}

/** Field key from a label ("Your city" -> "your_city"). */
export function slugKey(s: string): string {
  const v = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z]/.test(v) ? v : `f_${v}`.slice(0, 40);
}
