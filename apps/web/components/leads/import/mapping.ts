import {
  LEAD_IMPORT_FIELDS,
  LEAD_SOURCES,
  LeadCreateSchema,
  normalizeIndianPhone,
  type LeadCreate,
  type LeadListItem,
  type LeadSource,
} from '@vistar/shared';
import { CUSTOM_FIELDS, STAGES } from '../lead-meta';

/** Import column mapping helpers (client-side mock of POST /leads/import + commit). */
export type ImportField = (typeof LEAD_IMPORT_FIELDS)[number] | `custom.${string}`;

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

export const FIELD_OPTIONS: Array<{ value: ImportField; label: string }> = [
  ...LEAD_IMPORT_FIELDS.map((f) => ({ value: f as ImportField, label: FIELD_LABEL[f] })),
  ...CUSTOM_FIELDS.map((f) => ({
    value: `custom.${f.key}` as ImportField,
    label: `${f.label} (custom)`,
  })),
];

export const fieldLabel = (f: ImportField) => FIELD_OPTIONS.find((o) => o.value === f)?.label ?? f;

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
  ['custom.gst_number', /gst/],
  ['custom.quantity', /(qty|quantity)/],
  ['custom.preferred_language', /language/],
  ['custom.delivery_by', /delivery/],
];

/** Suggest a field for each header (first match wins; a field is used at most once). */
export function suggestMapping(headers: string[]): Record<string, ImportField | null> {
  const used = new Set<ImportField>();
  const out: Record<string, ImportField | null> = {};
  for (const h of headers) {
    const key = h.trim().toLowerCase();
    const hit = SYNONYMS.find(([field, re]) => !used.has(field) && re.test(key));
    out[h] = hit ? hit[0] : null;
    if (hit) used.add(hit[0]);
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

/** Apply the mapping to one CSV row and validate it with LeadCreateSchema. */
export function mapRow(
  row: Record<string, string>,
  mapping: Record<string, ImportField | null>,
  owners: Array<{ id: string; email?: string }>,
): { input: LeadCreate | null; error: string | null } {
  const draft: Record<string, unknown> = {
    source: 'import',
    customFields: {} as Record<string, string>,
    tags: [],
  };
  const custom = draft.customFields as Record<string, string>;
  for (const [col, field] of Object.entries(mapping)) {
    if (!field) continue;
    const raw = (row[col] ?? '').trim();
    if (!raw) continue;
    if (field.startsWith('custom.')) {
      custom[field.slice(7)] = raw;
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
        const stage = STAGES.find(
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
  const parsed = LeadCreateSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = String(issue?.path[0] ?? 'row');
    return {
      input: null,
      error:
        path === 'email'
          ? `Email "${String(draft.email)}" is not valid`
          : `${fieldLabel(path as ImportField)}: ${issue?.message ?? 'invalid value'}`,
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
