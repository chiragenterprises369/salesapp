import { LEAD_IMPORT_FIELDS, LEAD_SOURCES, normalizeIndianPhone, PhoneSchema, type LeadSource } from '@vistar/shared';
import { z } from 'zod';

type ImportField = (typeof LEAD_IMPORT_FIELDS)[number];
export type MappingTarget = ImportField | `custom.${string}`;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Header synonyms (normalised: lowercase, letters and digits only). */
const SYNONYMS: Record<ImportField, string[]> = {
  name: ['name', 'fullname', 'leadname', 'contactname', 'customername', 'contact', 'customer', 'contactperson', 'sendername', 'person'],
  companyName: ['company', 'companyname', 'organisation', 'organization', 'firm', 'firmname', 'business', 'businessname', 'sendercompany'],
  phone: ['phone', 'mobile', 'mobileno', 'mobilenumber', 'phoneno', 'phonenumber', 'contactnumber', 'contactno', 'whatsapp', 'whatsappnumber', 'cell', 'sendermobile', 'tel', 'telephone'],
  email: ['email', 'emailid', 'emailaddress', 'mail', 'senderemail'],
  city: ['city', 'town', 'sendercity', 'location'],
  state: ['state', 'region', 'province', 'senderstate'],
  source: ['source', 'leadsource', 'channel'],
  sourceRef: ['sourceref', 'reference', 'referenceid', 'refid', 'externalid', 'queryid', 'uniquequeryid', 'enquiryid'],
  productInterest: ['product', 'productname', 'productinterest', 'interestedin', 'queryproductname', 'item'],
  requirement: ['requirement', 'requirements', 'message', 'enquiry', 'inquiry', 'query', 'querymessage', 'description', 'remarks', 'notes', 'comment', 'comments'],
  valueInr: ['value', 'valueinr', 'amount', 'dealvalue', 'budget', 'expectedvalue', 'ordervalue', 'price'],
  tags: ['tags', 'tag', 'labels', 'label'],
  ownerEmail: ['owner', 'owneremail', 'assignedto', 'assignee', 'salesperson', 'executive', 'leadowner'],
  stageName: ['stage', 'stagename', 'status', 'leadstatus', 'pipelinestage'],
};

/** Suggested column -> field mapping. Each field is used at most once; unknown columns map to null. */
export function suggestMapping(columns: string[], customFields: Array<{ key: string; label: string }>): Record<string, MappingTarget | null> {
  const used = new Set<string>();
  const out: Record<string, MappingTarget | null> = {};
  for (const col of columns) {
    const n = norm(col.replace(/\s*\(\d+\)$/, ''));
    let target: MappingTarget | null = null;
    for (const field of LEAD_IMPORT_FIELDS) {
      if (!used.has(field) && SYNONYMS[field].includes(n)) {
        target = field;
        break;
      }
    }
    if (!target) {
      const cf = customFields.find((f) => !used.has(`custom.${f.key}`) && (norm(f.key) === n || norm(f.label) === n));
      if (cf) target = `custom.${cf.key}`;
    }
    if (target) used.add(target);
    out[col] = target;
  }
  return out;
}

export const normalizePhone = (raw: string): string | null => {
  const indian = normalizeIndianPhone(raw);
  if (indian) return indian;
  const compact = raw.replace(/[\s().-]/g, '');
  const e164 = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  return PhoneSchema.safeParse(e164).success ? e164 : null;
};

const EmailSchema = z.email();
export const isEmail = (v: string): boolean => EmailSchema.safeParse(v).success;

/** "₹1,25,000", "Rs. 5000", "12500.50" -> whole rupees; null when not a number. */
export function parseRupees(raw: string): number | null {
  const cleaned = raw.replace(/(₹|rs\.?|inr|,|\s)/gi, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(2_000_000_000, Math.round(n));
}

export const parseSource = (raw: string): LeadSource | null => {
  const v = raw.trim().toLowerCase().replace(/[\s-]/g, '');
  return (LEAD_SOURCES as readonly string[]).includes(v) ? (v as LeadSource) : null;
};

/** Coerce a CSV cell to the shape `validateCustomValues` expects for the field type (invalid input is passed through for a readable error). */
export function coerceCustomValue(def: { type: string; config: Record<string, unknown> }, raw: string): unknown {
  const v = raw.trim();
  const options = (def.config.options as Array<{ value: string; label: string }> | undefined) ?? [];
  const option = (s: string) => {
    const t = s.trim().toLowerCase();
    return options.find((o) => o.value === t || o.label.toLowerCase() === t)?.value ?? s.trim();
  };
  switch (def.type) {
    case 'number': {
      const n = Number(v.replace(/,/g, ''));
      return Number.isFinite(n) ? n : v;
    }
    case 'money':
      return parseRupees(v) ?? v;
    case 'boolean': {
      const b = v.toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(b)) return true;
      if (['false', 'no', 'n', '0'].includes(b)) return false;
      return v;
    }
    case 'select':
      return option(v);
    case 'multi_select':
      return v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean).map(option);
    case 'date': {
      // 25/12/2026 or 25-12-2026 (Indian order) -> 2026-12-25
      const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
      const iso = m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : v;
      if ((def.config as { withTime?: boolean }).withTime) {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? v : d.toISOString();
      }
      return iso;
    }
    case 'geo_point': {
      const parts = v.split(',').map((p) => Number(p.trim()));
      return parts.length === 2 && parts.every(Number.isFinite) ? { lat: parts[0], lng: parts[1] } : v;
    }
    default:
      return v;
  }
}
