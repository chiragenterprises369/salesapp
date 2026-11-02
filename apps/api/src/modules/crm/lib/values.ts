import {
  AddressSchema,
  CustomFieldValuesSchema,
  LabeledEmailSchema,
  LabeledPhoneSchema,
  stateCodeFromName,
  stateName,
  type Address,
  type CustomFieldValues,
  type LabeledEmail,
  type LabeledPhone,
} from '@vistar/shared';
import { z } from 'zod';

/** BigInt / Decimal / number columns -> JSON numbers (paise stay integers; safe below 2^53). */
export const num = (v: bigint | number | { toString(): string } | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return Number(v.toString());
};
export const big = (v: number): bigint => BigInt(Math.round(v));

const Phones = z.array(LabeledPhoneSchema);
const Emails = z.array(LabeledEmailSchema);

export const parsePhones = (j: unknown): LabeledPhone[] => {
  const r = Phones.safeParse(j);
  return r.success ? r.data : [];
};
export const parseEmails = (j: unknown): LabeledEmail[] => {
  const r = Emails.safeParse(j);
  return r.success ? r.data : [];
};
export const parseAddress = (j: unknown): Address | null => {
  if (!j) return null;
  const r = AddressSchema.safeParse(j);
  return r.success ? r.data : null;
};
export const parseCustom = (j: unknown): CustomFieldValues => {
  const r = CustomFieldValuesSchema.safeParse(j);
  return r.success ? r.data : {};
};

/** Fill `state` from the state code (or the code from a known state name). */
export function normalizeAddress(a: Address | null | undefined): Address | null {
  if (!a) return null;
  const stateCode = a.stateCode ?? (a.country === 'IN' ? stateCodeFromName(a.state) : null);
  return { ...a, stateCode, state: (stateCode ? stateName(stateCode) : null) ?? a.state ?? null };
}

export const emptyToNull = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === '' ? null : v.trim());
export const normalizeTags = (tags: readonly string[]): string[] => [...new Set(tags.map((t) => t.trim()).filter(Boolean))];

/** Dedupe labelled values by value (first wins) and drop the primary value. */
export function dedupePoints<T extends { value: string }>(points: readonly T[], primary: string | null, norm: (v: string) => string = (v) => v): T[] {
  const seen = new Set<string>(primary ? [norm(primary)] : []);
  return points.filter((p) => {
    const k = norm(p.value);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** YYYY-MM-DD of a @db.Date column. */
export const dateOnly = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
/** YYYY-MM-DD -> Date at UTC midnight (for @db.Date columns). */
export const toDateCol = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
