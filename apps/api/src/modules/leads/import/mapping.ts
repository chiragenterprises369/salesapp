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

export function parseCustomValue(type: string, raw: string): { ok: true; value: string | number | boolean } | { ok: false } {
  if (type === 'number') {
    const n = Number(raw.replace(/,/g, ''));
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
  }
  if (type === 'boolean') {
    const v = raw.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(v)) return { ok: true, value: true };
    if (['false', 'no', 'n', '0'].includes(v)) return { ok: true, value: false };
    return { ok: false };
  }
  return { ok: true, value: raw.slice(0, 500) };
}
