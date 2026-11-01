import { configOf, fieldError, type FieldDef } from '@/components/customization/field-utils';
import {
  LEAD_IMPORT_FIELDS,
  LEAD_SOURCES,
  LeadCreateSchema,
  normalizeIndianPhone,
  type CustomFieldValue,
  type LeadCreate,
  type LeadListItem,
  type LeadSource,
  type Stage,
} from '@vistar/shared';

/** Import column mapping helpers (client-side mock of POST /leads/import + commit). */
export type ImportField = (typeof LEAD_IMPORT_FIELDS)[number] | `custom.${string}`;

/** What the mapping needs from the workspace: live stages and the lead custom fields you can write. */
export interface MappingContext {
  stages: readonly Stage[];
  customFields: readonly FieldDef[];
}

export const FIELD_LABEL: Record<(typeof LEAD_IMPORT_FIELDS)[number], string> = {
  name: 'Name',
  companyName: 'Company',
  phone: 'Phone',
  email: 'Email',
  city: 'City',
  state: 'State',
  source: 'Source',
  sourceRef: 'Source reference',
  productInterest: 'Product interest',
  requirement: 'Requirement',
  valueInr: 'Deal value (₹)',
  tags: 'Tags',
  ownerEmail: 'Owner email',
  stageName: 'Stage',
};

export interface FieldOption {
  value: ImportField;
  label: string;
}

/** Core lead fields, then `custom.<key>` for every lead field definition (Settings > Fields). */
export function fieldOptions(customFields: readonly FieldDef[]): FieldOption[] {
  return [
    ...LEAD_IMPORT_FIELDS.map((f) => ({ value: f as ImportField, label: FIELD_LABEL[f] })),
    ...customFields
      .filter((f) => f.type !== 'file')
      .map((f) => ({ value: `custom.${f.key}` as ImportField, label: `${f.label} (custom)` })),
  ];
}

export const fieldLabel = (f: ImportField, options: readonly FieldOption[]) =>
  options.find((o) => o.value === f)?.label ?? f;

const SYNONYMS: Array<[ImportField, RegExp]> = [
  ['email', /e-?mail/],
  ['ownerEmail', /(owner|assignee|rep|salesperson).*(mail)|^owner$/],
  ['phone', /(phone|mobile|contact ?no|whatsapp|cell|number)/],
  ['companyName', /(company|firm|business|organi[sz]ation)/],
  ['name', /(^name$|full ?name|lead ?name|contact ?name|customer|buyer|sender ?name)/],
  ['city', /(city|town)/],
  ['state', /(state|province|region)/],
  ['sourceRef', /(query ?id|enquiry ?id|unique|ref)/],
  ['source', /(source|channel|origin)/],
  ['productInterest', /(product|item|interest|subject)/],
  ['requirement', /(requirement|message|enquiry|inquiry|details|description|query)/],
  ['valueInr', /(value|amount|deal|budget|price|inr|₹)/],
  ['tags', /(tag|label)/],
  ['stageName', /(stage|status)/],
];

/**
 * How well a header names a custom field: exact label/key 4, contains label/key 3, acronym
 * ("GST No") 2, starts with the first word of the label ("Delivery date") 1, else 0.
 */
function customScore(f: FieldDef, header: string): number {
  const label = f.label.toLowerCase();
  const keySpaced = f.key.replace(/_/g, ' ');
  if (header === label || header === keySpaced || header === f.key) return 4;
  if (header.includes(label) || header.includes(keySpaced)) return 3;
  const first = f.label.split(/\s+/)[0] ?? '';
  if (/^[A-Z]{2,5}$/.test(first) && new RegExp(`\\b${first.toLowerCase()}\\b`).test(header))
    return 2;
  if (first.length >= 4 && header.startsWith(first.toLowerCase())) return 1;
  return 0;
}

/**
 * Suggest a field for each header. Strong custom-field matches win, then the core synonyms, then
 * weak custom matches. A field is used at most once.
 */
export function suggestMapping(
  headers: string[],
  customFields: readonly FieldDef[] = [],
): Record<string, ImportField | null> {
  const used = new Set<ImportField>();
  const out: Record<string, ImportField | null> = {};
  for (const h of headers) {
    const key = h.trim().toLowerCase();
    let best: { field: ImportField; score: number } | null = null;
    for (const f of customFields) {
      const field = `custom.${f.key}` as ImportField;
      const score = used.has(field) ? 0 : customScore(f, key);
      if (score > (best?.score ?? 0)) best = { field, score };
    }
    const core = SYNONYMS.find(([field, re]) => !used.has(field) && re.test(key))?.[0] ?? null;
    const pick = best && best.score >= 2 ? best.field : (core ?? best?.field ?? null);
    out[h] = pick;
    if (pick) used.add(pick);
  }
  return out;
}

export interface MappedRow {
  index: number;
  input: LeadCreate | null;
  error: string | null;
  duplicateOf: (LeadListItem & { by: 'phone' | 'email' }) | null;
  /** Duplicate of an earlier row in the same file. */
  duplicateInFile: boolean;
}

function toSource(v: string): LeadSource {
  const s = v.trim().toLowerCase().replace(/\s+/g, '');
  return (LEAD_SOURCES as readonly string[]).includes(s)
    ? (s as LeadSource)
    : s.includes('indiamart')
      ? 'indiamart'
      : 'import';
}

/** Turn a CSV cell into the typed value a custom field stores (labels of choices are accepted). */
function coerceCustom(def: FieldDef, raw: string): CustomFieldValue {
  switch (def.type) {
    case 'number':
    case 'money': {
      const n = Number(raw.replace(/[₹,\s]/g, ''));
      return Number.isFinite(n) ? n : raw;
    }
    case 'boolean': {
      const v = raw.toLowerCase();
      if (['yes', 'y', 'true', '1', 'haan', 'ha'].includes(v)) return true;
      if (['no', 'n', 'false', '0', 'nahi'].includes(v)) return false;
      return raw;
    }
    case 'select':
    case 'multi_select': {
      const { options } = configOf({ type: def.type, config: def.config });
      const match = (s: string) =>
        options.find(
          (o) => o.value === s.toLowerCase() || o.label.toLowerCase() === s.toLowerCase(),
        )?.value ?? s;
      if (def.type === 'select') return match(raw);
      return raw
        .split(/[;,|]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(match);
    }
    case 'date': {
      // 31/12/2026 or 31-12-2026 (Indian order) -> 2026-12-31
      const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
      return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : raw;
    }
    default:
      return raw;
  }
}

/** Apply the mapping to one CSV row and validate it with LeadCreateSchema and the field rules. */
export function mapRow(
  row: Record<string, string>,
  mapping: Record<string, ImportField | null>,
  owners: Array<{ id: string; email?: string }>,
  ctx: MappingContext,
): { input: LeadCreate | null; error: string | null } {
  const draft: Record<string, unknown> = {
    source: 'import',
    customFields: {} as Record<string, CustomFieldValue>,
    tags: [],
  };
  const custom = draft.customFields as Record<string, CustomFieldValue>;
  for (const [col, field] of Object.entries(mapping)) {
    if (!field) continue;
    const raw = (row[col] ?? '').trim();
    if (!raw) continue;
    if (field.startsWith('custom.')) {
      const def = ctx.customFields.find((f) => f.key === field.slice(7));
      if (!def) continue;
      const value = coerceCustom(def, raw);
      const problem = fieldError(def, value);
      if (problem) return { input: null, error: `${def.label}: ${problem}` };
      custom[def.key] = value;
      continue;
    }
    switch (field) {
      case 'phone': {
        const p = normalizeIndianPhone(raw);
        if (!p) return { input: null, error: `Phone "${raw}" is not a valid Indian mobile number` };
        draft.phone = p;
        break;
      }
      case 'valueInr': {
        const n = Number(raw.replace(/[₹,\s]/g, ''));
        if (!Number.isFinite(n) || n < 0)
          return { input: null, error: `Deal value "${raw}" is not a number` };
        draft.valueInr = Math.round(n);
        break;
      }
      case 'tags':
        draft.tags = raw
          .split(/[;,|]/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        break;
      case 'source':
        draft.source = toSource(raw);
        break;
      case 'stageName': {
        const stage = ctx.stages.find(
          (s) => s.name.toLowerCase() === raw.toLowerCase() || s.key === raw.toLowerCase(),
        );
        if (stage) draft.stageId = stage.id;
        break;
      }
      case 'ownerEmail': {
        const owner = owners.find((o) => o.email?.toLowerCase() === raw.toLowerCase());
        if (owner) draft.ownerId = owner.id;
        break;
      }
      case 'email':
        draft.email = raw.toLowerCase();
        break;
      default:
        draft[field] = raw;
    }
  }
  if (!draft.name) return { input: null, error: 'Name is empty' };
  const missing = ctx.customFields.find((f) => f.required && custom[f.key] === undefined);
  if (missing) return { input: null, error: `${missing.label} is required` };
  const parsed = LeadCreateSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = String(issue?.path[0] ?? 'row');
    return {
      input: null,
      error:
        path === 'email'
          ? `Email "${String(draft.email)}" is not valid`
          : `${FIELD_LABEL[path as keyof typeof FIELD_LABEL] ?? path}: ${issue?.message ?? 'invalid value'}`,
    };
  }
  return { input: parsed.data, error: null };
}

/** Duplicates: phone first, then email; against existing leads and earlier rows of the same file. */
export function detectDuplicates(
  rows: Array<{ input: LeadCreate | null; error: string | null }>,
  existing: LeadListItem[],
): MappedRow[] {
  const byPhone = new Map(existing.filter((l) => l.phone).map((l) => [l.phone!, l]));
  const byEmail = new Map(existing.filter((l) => l.email).map((l) => [l.email!.toLowerCase(), l]));
  const seenPhone = new Set<string>();
  const seenEmail = new Set<string>();
  return rows.map((r, index) => {
    if (!r.input)
      return { index, input: null, error: r.error, duplicateOf: null, duplicateInFile: false };
    const { phone, email } = r.input;
    const phoneHit = phone ? byPhone.get(phone) : undefined;
    const emailHit = !phoneHit && email ? byEmail.get(email.toLowerCase()) : undefined;
    const duplicateOf = phoneHit
      ? { ...phoneHit, by: 'phone' as const }
      : emailHit
        ? { ...emailHit, by: 'email' as const }
        : null;
    const duplicateInFile =
      (!!phone && seenPhone.has(phone)) || (!!email && seenEmail.has(email.toLowerCase()));
    if (phone) seenPhone.add(phone);
    if (email) seenEmail.add(email.toLowerCase());
    return { index, input: r.input, error: null, duplicateOf, duplicateInFile };
  });
}

export const SAMPLE_CSV = [
  'Name,Mobile,Email,Company,City,Product,Requirement,Value,Tags',
  'Rakesh Gupta,98765 43210,rakesh@ganeshtraders.in,Shree Ganesh Traders,Rajkot,SS pipes 2 inch,Need 500 m with GST,150000,bulk',
  'Sunita Reddy,+91 91234 56789,,Balaji Polymers,Hyderabad,HDPE granules,Monthly requirement 5 tonnes,425000,repeat-buyer',
].join('\n');
