import { z } from 'zod';

/** All entity ids are UUIDv7 strings (Prisma `@default(uuid(7)) @db.Uuid`). */
export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

/** ISO-8601 timestamp with offset, e.g. 2026-11-01T10:15:00.000Z. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
/** Calendar date YYYY-MM-DD (workspace timezone). */
export const IsoDateSchema = z.iso.date();

/** Whole rupees (no paise). Deal and revenue values are integers in INR. */
export const InrSchema = z.number().int().min(0).max(2_000_000_000);

/**
 * Money in paise (1 rupee = 100 paise) for products, price lists, quotations, invoices and payments
 * (D-067: GST needs paise; the document total is rounded to the rupee with a round-off line).
 * Stored as BigInt columns; the API returns JSON numbers (safe integers).
 */
export const PaiseSchema = z.number().int().min(0).max(1_000_000_000_000_000);
/** Signed paise (round-off can be negative). */
export const SignedPaiseSchema = z.number().int().min(-1_000_000_000_000_000).max(1_000_000_000_000_000);

/** Marketing attribution captured by lead capture forms (URL params utm_*, gclid, fbclid). */
export const UtmSchema = z.object({
  source: z.string().trim().max(200).optional(),
  medium: z.string().trim().max(200).optional(),
  campaign: z.string().trim().max(200).optional(),
  term: z.string().trim().max(200).optional(),
  content: z.string().trim().max(200).optional(),
  gclid: z.string().trim().max(300).optional(),
  fbclid: z.string().trim().max(300).optional(),
});
export type Utm = z.infer<typeof UtmSchema>;
/** URL query param -> UtmSchema key. */
export const UTM_PARAMS = { utm_source: 'source', utm_medium: 'medium', utm_campaign: 'campaign', utm_term: 'term', utm_content: 'content', gclid: 'gclid', fbclid: 'fbclid' } as const;

/** E.164 phone. Indian numbers are normalised with normalizeIndianPhone(). */
export const PhoneSchema = z.string().regex(/^\+[1-9]\d{6,14}$/, { error: 'Use E.164 format, e.g. +919876543210' });

export const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/** Comma-separated or repeated query params become arrays. */
export const queryArray = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (Array.isArray(v)) return v;
    return String(v).split(',').filter(Boolean);
  }, z.array(item).optional());

export const CursorPaginationQuerySchema = z.object({
  cursor: z.string().optional().describe('Opaque cursor from the previous page nextCursor'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;

/** Cursor page envelope used by every list endpoint. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().optional().describe('Present only when cheap to compute or requested'),
  });
export type Page<T> = { items: T[]; nextCursor: string | null; total?: number };

export const SortDirSchema = z.enum(['asc', 'desc']);

export const DateRangeQuerySchema = z.object({
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});

export const OkResponseSchema = z.object({ ok: z.literal(true) });

export const IdParamSchema = z.object({ id: IdSchema });

/** Geo-point value for `geo_point` custom fields. */
export const GeoPointSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export type GeoPoint = z.infer<typeof GeoPointSchema>;

/**
 * One stored custom field value (shape depends on the field type; see customization/values.ts):
 * text/date/select/url = string, number/money = number, boolean, multi_select/multiple user|relation|file = string[],
 * geo_point = { lat, lng }, null = cleared.
 */
export const CustomFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), GeoPointSchema]);
export type CustomFieldValue = z.infer<typeof CustomFieldValueSchema>;

/** Custom field values on core entities and custom object records. Keys are field keys. */
export const CustomFieldValuesSchema = z.record(z.string(), CustomFieldValueSchema);
export type CustomFieldValues = z.infer<typeof CustomFieldValuesSchema>;
