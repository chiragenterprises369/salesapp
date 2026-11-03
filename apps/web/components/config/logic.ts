import { configFieldDef, configFieldSchema, type ConfigFieldState, type ConfigGroup, type ConfigValue } from '@vistar/shared';

/**
 * Pure logic of the Super Admin > Config registry form (change #20): drafts per field, which fields
 * apply for the current values, and the save body (changed keys only; null clears a panel value).
 */

/**
 * Draft of one field. Non-secret fields edit the panel value (null = not saved in the panel, so the env
 * fallback or the default applies). Secrets never come back from the API: `secret` holds what the admin
 * types to replace it, `clearSecret` removes the stored one.
 */
export interface FieldDraft {
  /** Text as typed (numbers and lists are parsed on save). null = use env fallback / default. */
  text: string | null;
  bool: boolean | null;
  secret: string | null;
  clearSecret: boolean;
}

export type Drafts = Record<string, FieldDraft>;

export function valueToText(v: ConfigValue | null): string {
  if (v === null) return '';
  if (Array.isArray(v)) return v.join('\n');
  return String(v);
}

export function initialDraft(f: ConfigFieldState): FieldDraft {
  if (f.secret) return { text: null, bool: null, secret: null, clearSecret: false };
  if (f.type === 'boolean') return { text: null, bool: typeof f.panelValue === 'boolean' ? f.panelValue : null, secret: null, clearSecret: false };
  return { text: f.panelValue === null ? null : valueToText(f.panelValue), bool: null, secret: null, clearSecret: false };
}

export const initialDrafts = (g: Pick<ConfigGroup, 'fields'>): Drafts => Object.fromEntries(g.fields.map((f) => [f.key, initialDraft(f)]));

/** Value of a field as the form currently means it (draft first, else the effective value). */
function currentValue(f: ConfigFieldState, d: FieldDraft | undefined): unknown {
  if (!d) return f.value;
  if (f.type === 'boolean') return d.bool ?? f.value;
  return d.text ?? f.value;
}

/** The field's `when` condition holds for the values in the form (e.g. SMTP fields only for provider smtp). */
export function isFieldActive(f: ConfigFieldState, fields: readonly ConfigFieldState[], drafts: Drafts): boolean {
  if (!f.when) return true;
  const dep = fields.find((x) => x.key === f.when!.field);
  if (!dep) return f.active;
  const v = currentValue(dep, drafts[dep.key]);
  return typeof v === 'string' && f.when.in.includes(v);
}

function parseText(f: ConfigFieldState, text: string): ConfigValue | { error: string } {
  if (f.type === 'number') {
    const n = Number(text.trim().replace(/,/g, ''));
    return text.trim() !== '' && Number.isFinite(n) ? n : { error: 'Enter a number.' };
  }
  if (f.type === 'list')
    return text
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
  if (f.type === 'textarea') return text;
  return text.trim();
}

const isError = (v: unknown): v is { error: string } => typeof v === 'object' && v !== null && !Array.isArray(v) && 'error' in v;

/** Changed values only (omitted = unchanged, null = clear), plus field errors (shared field schemas). */
export function buildConfigBody(group: Pick<ConfigGroup, 'key' | 'fields'>, drafts: Drafts): { values: Record<string, ConfigValue | null>; errors: Record<string, string> } {
  const values: Record<string, ConfigValue | null> = {};
  const errors: Record<string, string> = {};
  for (const f of group.fields) {
    const d = drafts[f.key];
    if (!d) continue;
    const init = initialDraft(f);
    let next: ConfigValue | null | undefined;
    if (f.secret) {
      if (d.clearSecret) next = f.secretSet ? null : undefined;
      else if (d.secret !== null && d.secret.trim() !== '') next = d.secret.trim();
      else if (d.secret !== null && f.secretSet) errors[f.key] = 'Enter the new value, or keep the saved one.';
    } else if (f.type === 'boolean') {
      if (d.bool !== init.bool) next = d.bool;
    } else if (d.text !== init.text) {
      if (d.text === null) next = null;
      else {
        const parsed = parseText(f, d.text);
        if (isError(parsed)) errors[f.key] = parsed.error;
        else if (f.type === 'list' && Array.isArray(parsed) && parsed.length === 0 && init.text === null) next = undefined;
        else next = parsed;
      }
    }
    if (next === undefined || errors[f.key]) continue;
    if (next !== null) {
      const def = configFieldDef(group.key, f.key);
      const check = def ? configFieldSchema(def).safeParse(next) : null;
      if (check && !check.success) {
        errors[f.key] = check.error.issues[0]?.message ?? 'Check this value.';
        continue;
      }
    }
    values[f.key] = next;
  }
  return { values, errors };
}
