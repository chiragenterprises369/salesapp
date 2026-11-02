import { z } from 'zod';
import { ContactPointLabelSchema, StageTypeSchema } from '../enums.js';
import { LineItemInputSchema, LineItemSchema } from './catalog.js';
import {
  CursorPaginationQuerySchema,
  CustomFieldValuesSchema,
  IdSchema,
  InrSchema,
  IsoDateTimeSchema,
  PhoneSchema,
  queryArray,
  SortDirSchema,
} from './common.js';
import { UserSummarySchema } from './workspace.js';

/**
 * CONTACTS, ACCOUNTS AND DEALS (change #19 wave B, SPEC 29.9).
 * - Contact = a person (Prisma `Contact`), Account = a company (Prisma `Company`; "Company" in the
 *   Super Admin means a workspace, so the CRM calls it Account everywhere outside the database).
 * - Links: Lead.contactId -> Contact.companyId (account). Leads keep their own contact/account ids;
 *   POST /leads/{id}/convert creates or links the contact, the account and a deal in one step.
 * - Data scope (own | team | all) applies through ownerId. A contact or account is ALSO visible when
 *   one of its leads is visible to the caller (so employees see the people behind their leads).
 * - Custom fields: targets `contact`, `company` (accounts) and `deal` of the flexible data layer (SPEC 22).
 * - Deals live on a deal pipeline (Pipeline.entity = 'deal'; default key `deals`, created on first use)
 *   and are ordered on the Deals board by a fractional `position` like leads.
 */

// ---------------------------------------------------------------- Indian states (GST state codes)

/** GST state codes (first two digits of a GSTIN). 97 = other territory (exports and SEZ use IGST). */
export const INDIAN_STATES = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
] as const;
export type IndianStateCode = (typeof INDIAN_STATES)[number]['code'];
const STATE_CODES = new Set<string>(INDIAN_STATES.map((s) => s.code));

export const isStateCode = (code: string): code is IndianStateCode => STATE_CODES.has(code);
export const StateCodeSchema = z.string().refine(isStateCode, { error: 'Pick a state' });
export const stateName = (code: string | null | undefined): string | null => INDIAN_STATES.find((s) => s.code === code)?.name ?? null;
/** Case-insensitive state name -> code ("maharashtra" -> "27"). */
export function stateCodeFromName(name: string | null | undefined): IndianStateCode | null {
  const n = name?.trim().toLowerCase();
  if (!n) return null;
  return INDIAN_STATES.find((s) => s.name.toLowerCase() === n)?.code ?? null;
}

// ---------------------------------------------------------------- GSTIN, PAN

export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Check digit of the first 14 GSTIN characters (mod 36, alternating weights 1 and 2). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

/** Format, a known state code and the check digit. */
export function isValidGstin(value: string): boolean {
  const v = value.trim().toUpperCase();
  return GSTIN_RE.test(v) && isStateCode(v.slice(0, 2)) && gstinCheckChar(v.slice(0, 14)) === v[14];
}
export const stateCodeFromGstin = (gstin: string | null | undefined): IndianStateCode | null => {
  const code = gstin?.trim().slice(0, 2) ?? '';
  return isStateCode(code) ? code : null;
};
export const panFromGstin = (gstin: string | null | undefined): string | null => (gstin && GSTIN_RE.test(gstin) ? gstin.slice(2, 12) : null);

export const GstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidGstin, { error: 'Enter a valid 15-character GSTIN' });
export const PanSchema = z.string().trim().toUpperCase().regex(PAN_RE, { error: 'Enter a valid 10-character PAN' });

// ---------------------------------------------------------------- addresses and contact points

/**
 * Postal address. `stateCode` decides CGST+SGST versus IGST on documents; it is required for Indian
 * addresses. `state` is filled from the code by the server when omitted.
 */
export const AddressSchema = z
  .object({
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).nullable().default(null),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().max(80).nullable().default(null),
    stateCode: StateCodeSchema.nullable().default(null),
    pincode: z.string().trim().max(12).nullable().default(null),
    country: z.string().trim().length(2).toUpperCase().default('IN'),
  })
  .superRefine((a, ctx) => {
    if (a.country !== 'IN') return;
    if (!a.stateCode) ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'Pick the state (needed for GST)' });
    if (a.pincode && !/^[1-9]\d{5}$/.test(a.pincode)) ctx.addIssue({ code: 'custom', path: ['pincode'], message: 'A PIN code has 6 digits' });
  });
export type Address = z.infer<typeof AddressSchema>;

export const LabeledPhoneSchema = z.object({ label: ContactPointLabelSchema, value: PhoneSchema });
export type LabeledPhone = z.infer<typeof LabeledPhoneSchema>;
export const LabeledEmailSchema = z.object({ label: ContactPointLabelSchema, value: z.email() });
export type LabeledEmail = z.infer<typeof LabeledEmailSchema>;

// ---------------------------------------------------------------- summaries (embedded in other records)

export const AccountSummarySchema = z.object({ id: IdSchema, name: z.string(), gstin: z.string().nullable(), city: z.string().nullable() });
export type AccountSummary = z.infer<typeof AccountSummarySchema>;
export const ContactSummarySchema = z.object({ id: IdSchema, name: z.string(), phone: z.string().nullable(), email: z.string().nullable(), accountId: IdSchema.nullable() });
export type ContactSummary = z.infer<typeof ContactSummarySchema>;
export const DealSummarySchema = z.object({ id: IdSchema, title: z.string(), valueInr: InrSchema, stageId: IdSchema.nullable(), status: StageTypeSchema });
export type DealSummary = z.infer<typeof DealSummarySchema>;
export const LeadRefSchema = z.object({ id: IdSchema, name: z.string() });
export type LeadRef = z.infer<typeof LeadRefSchema>;

// ---------------------------------------------------------------- contacts

export const ContactListItemSchema = z.object({
  id: IdSchema,
  name: z.string(),
  title: z.string().nullable().describe('Designation, e.g. "Purchase manager"'),
  phone: PhoneSchema.nullable().describe('Primary phone (unique per workspace)'),
  email: z.email().nullable(),
  account: AccountSummarySchema.nullable(),
  city: z.string().nullable(),
  stateCode: z.string().nullable(),
  owner: UserSummarySchema.nullable(),
  tags: z.array(z.string()),
  whatsappOptIn: z.boolean().nullable().describe('null = unknown'),
  dnd: z.boolean(),
  leadCount: z.number().int(),
  openDealCount: z.number().int(),
  lastActivityAt: IsoDateTimeSchema.nullable(),
  version: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ContactListItem = z.infer<typeof ContactListItemSchema>;

export const ContactSchema = ContactListItemSchema.extend({
  additionalPhones: z.array(LabeledPhoneSchema),
  additionalEmails: z.array(LabeledEmailSchema),
  gstin: z.string().nullable(),
  pan: z.string().nullable(),
  billingAddress: AddressSchema.nullable(),
  shippingAddress: AddressSchema.nullable(),
  customFields: CustomFieldValuesSchema,
  mergedIntoId: IdSchema.nullable(),
});
export type Contact = z.infer<typeof ContactSchema>;

/** Input fields without defaults (Zod 4 `.partial()` keeps defaults; Update is built from this). */
const ContactInputFields = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(80).nullable(),
  phone: PhoneSchema.nullable(),
  email: z.email().nullable(),
  additionalPhones: z.array(LabeledPhoneSchema).max(10),
  additionalEmails: z.array(LabeledEmailSchema).max(10),
  accountId: IdSchema.nullable(),
  city: z.string().trim().max(80).nullable(),
  gstin: GstinSchema.nullable(),
  pan: PanSchema.nullable(),
  billingAddress: AddressSchema.nullable(),
  shippingAddress: AddressSchema.nullable(),
  ownerId: IdSchema.nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  dnd: z.boolean(),
  customFields: CustomFieldValuesSchema,
});

/** ownerId defaults to the caller for own/team scope (like leads); assigning others needs contacts.update + leads.assign. */
export const ContactCreateSchema = ContactInputFields.partial().extend({
  name: z.string().trim().min(1).max(120),
  additionalPhones: z.array(LabeledPhoneSchema).max(10).default([]),
  additionalEmails: z.array(LabeledEmailSchema).max(10).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  customFields: CustomFieldValuesSchema.default({}),
});
export type ContactCreate = z.infer<typeof ContactCreateSchema>;
export const ContactUpdateSchema = ContactInputFields.partial().extend({
  expectedVersion: z.number().int().optional().describe('If set and stale, server returns VERSION_CONFLICT'),
});
export type ContactUpdate = z.infer<typeof ContactUpdateSchema>;

const OwnerFilter = queryArray(z.union([IdSchema, z.literal('unassigned'), z.literal('me')])).describe('Omit = everyone in scope');

export const CONTACT_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'lastActivityAt'] as const;
export const ContactListQuerySchema = CursorPaginationQuerySchema.extend({
  q: z.string().trim().max(200).optional().describe('Name, phone, email, GSTIN or account name'),
  ownerId: OwnerFilter,
  accountId: IdSchema.optional(),
  tag: queryArray(z.string()),
  city: z.string().trim().max(80).optional(),
  stateCode: queryArray(StateCodeSchema),
  createdFrom: IsoDateTimeSchema.optional(),
  createdTo: IsoDateTimeSchema.optional(),
  sort: z.enum(CONTACT_SORT_FIELDS).default('createdAt'),
  dir: SortDirSchema.default('desc'),
});
export type ContactListQuery = z.infer<typeof ContactListQuerySchema>;

// ---------------------------------------------------------------- accounts

export const AccountListItemSchema = z.object({
  id: IdSchema,
  name: z.string(),
  industry: z.string().nullable(),
  gstin: z.string().nullable(),
  phone: PhoneSchema.nullable(),
  email: z.email().nullable(),
  website: z.string().nullable(),
  city: z.string().nullable(),
  stateCode: z.string().nullable(),
  owner: UserSummarySchema.nullable(),
  tags: z.array(z.string()),
  contactCount: z.number().int(),
  openDealCount: z.number().int(),
  openDealValueInr: InrSchema,
  lastActivityAt: IsoDateTimeSchema.nullable(),
  version: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type AccountListItem = z.infer<typeof AccountListItemSchema>;

export const AccountSchema = AccountListItemSchema.extend({
  pan: z.string().nullable(),
  additionalPhones: z.array(LabeledPhoneSchema),
  additionalEmails: z.array(LabeledEmailSchema),
  billingAddress: AddressSchema.nullable(),
  shippingAddress: AddressSchema.nullable(),
  customFields: CustomFieldValuesSchema,
  mergedIntoId: IdSchema.nullable(),
});
export type Account = z.infer<typeof AccountSchema>;

const AccountInputFields = z.object({
  name: z.string().trim().min(1).max(160),
  industry: z.string().trim().max(80).nullable(),
  website: z.url().max(300).nullable(),
  phone: PhoneSchema.nullable(),
  email: z.email().nullable(),
  additionalPhones: z.array(LabeledPhoneSchema).max(10),
  additionalEmails: z.array(LabeledEmailSchema).max(10),
  gstin: GstinSchema.nullable(),
  pan: PanSchema.nullable(),
  billingAddress: AddressSchema.nullable(),
  shippingAddress: AddressSchema.nullable(),
  ownerId: IdSchema.nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  customFields: CustomFieldValuesSchema,
});

/** With a GSTIN and no PAN, the PAN is taken from the GSTIN; the billing state code must match the GSTIN state when both are set. */
export const AccountCreateSchema = AccountInputFields.partial().extend({
  name: z.string().trim().min(1).max(160),
  additionalPhones: z.array(LabeledPhoneSchema).max(10).default([]),
  additionalEmails: z.array(LabeledEmailSchema).max(10).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  customFields: CustomFieldValuesSchema.default({}),
});
export type AccountCreate = z.infer<typeof AccountCreateSchema>;
export const AccountUpdateSchema = AccountInputFields.partial().extend({ expectedVersion: z.number().int().optional() });
export type AccountUpdate = z.infer<typeof AccountUpdateSchema>;

export const ACCOUNT_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'lastActivityAt'] as const;
export const AccountListQuerySchema = CursorPaginationQuerySchema.extend({
  q: z.string().trim().max(200).optional().describe('Name, GSTIN, phone, email or website'),
  ownerId: OwnerFilter,
  tag: queryArray(z.string()),
  industry: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  stateCode: queryArray(StateCodeSchema),
  createdFrom: IsoDateTimeSchema.optional(),
  createdTo: IsoDateTimeSchema.optional(),
  sort: z.enum(ACCOUNT_SORT_FIELDS).default('createdAt'),
  dir: SortDirSchema.default('desc'),
});
export type AccountListQuery = z.infer<typeof AccountListQuerySchema>;

// ---------------------------------------------------------------- merge and bulk (contacts, accounts)

/** Duplicates are soft-deleted with mergedIntoId; their leads, deals, documents and meetings move to the primary. */
export const CrmMergeSchema = z.object({
  primaryId: IdSchema,
  duplicateIds: z.array(IdSchema).min(1).max(10),
  /** Field -> record id whose value wins. Unlisted fields keep the primary's value (empty primary values are filled). */
  fieldWinners: z.record(z.string(), IdSchema).default({}),
});
export type CrmMerge = z.infer<typeof CrmMergeSchema>;

export const CrmBulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), ids: z.array(IdSchema).min(1).max(500), ownerId: IdSchema.nullable() }),
  z.object({ action: z.literal('add_tags'), ids: z.array(IdSchema).min(1).max(500), tags: z.array(z.string().trim().min(1).max(40)).min(1) }),
  z.object({ action: z.literal('remove_tags'), ids: z.array(IdSchema).min(1).max(500), tags: z.array(z.string()).min(1) }),
  z.object({ action: z.literal('delete'), ids: z.array(IdSchema).min(1).max(500) }),
]);
export type CrmBulkAction = z.infer<typeof CrmBulkActionSchema>;

// ---------------------------------------------------------------- deals

export const DealListItemSchema = z.object({
  id: IdSchema,
  title: z.string(),
  /** Whole rupees, before GST. With line items it is the sum of the line taxable values (rounded). */
  valueInr: InrSchema,
  pipelineId: IdSchema,
  stageId: IdSchema,
  /** open | won | lost, from the stage type. */
  status: StageTypeSchema,
  /** Fractional-index rank in the stage column (byte order). */
  position: z.string(),
  /** Effective win probability 0-100: the deal's override, else the stage probability. */
  probability: z.number().int().min(0).max(100),
  weightedValueInr: InrSchema,
  owner: UserSummarySchema.nullable(),
  account: AccountSummarySchema.nullable(),
  contact: ContactSummarySchema.nullable(),
  lead: LeadRefSchema.nullable(),
  expectedCloseAt: IsoDateTimeSchema.nullable(),
  closedAt: IsoDateTimeSchema.nullable(),
  lostReason: z.string().nullable(),
  lineCount: z.number().int(),
  version: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type DealListItem = z.infer<typeof DealListItemSchema>;

export const DealSchema = DealListItemSchema.extend({
  description: z.string().nullable(),
  /** Probability override (null = stage probability). */
  probabilityOverride: z.number().int().min(0).max(100).nullable(),
  lines: z.array(LineItemSchema).describe('Products of the deal (prices exclude GST; amounts per computeLine with the seller state)'),
  customFields: CustomFieldValuesSchema,
});
export type Deal = z.infer<typeof DealSchema>;

const DealInputFields = z.object({
  title: z.string().trim().min(1).max(160),
  valueInr: InrSchema.describe('Ignored when lines are given (value = sum of line taxable values)'),
  pipelineId: IdSchema.describe('Deal pipeline; default = the default deal pipeline'),
  stageId: IdSchema.describe('Default = first open stage of the pipeline'),
  ownerId: IdSchema.nullable(),
  accountId: IdSchema.nullable(),
  contactId: IdSchema.nullable(),
  leadId: IdSchema.nullable(),
  expectedCloseAt: IsoDateTimeSchema.nullable(),
  probability: z.number().int().min(0).max(100).nullable(),
  description: z.string().trim().max(4000).nullable(),
  lostReason: z.string().trim().max(300).nullable(),
  lines: z.array(LineItemInputSchema).max(200).describe('Replaces all lines when present'),
  customFields: CustomFieldValuesSchema,
});

export const DealCreateSchema = DealInputFields.partial().extend({
  title: z.string().trim().min(1).max(160),
  valueInr: InrSchema.default(0),
  lines: z.array(LineItemInputSchema).max(200).default([]),
  customFields: CustomFieldValuesSchema.default({}),
});
export type DealCreate = z.infer<typeof DealCreateSchema>;
/** Changing the stage here equals a move to the end of the column; changing ownerId needs leads.assign. */
export const DealUpdateSchema = DealInputFields.omit({ pipelineId: true }).partial().extend({ expectedVersion: z.number().int().optional() });
export type DealUpdate = z.infer<typeof DealUpdateSchema>;

/** Same semantics as LeadMoveSchema: no neighbours = end of the column. Moving into a lost stage may carry the reason. */
export const DealMoveSchema = z.object({
  stageId: IdSchema,
  beforeDealId: IdSchema.nullable().optional().describe('Deal directly above the moved card'),
  afterDealId: IdSchema.nullable().optional().describe('Deal directly below the moved card'),
  lostReason: z.string().trim().max(300).nullable().optional(),
  expectedVersion: z.number().int().optional(),
});
export type DealMove = z.infer<typeof DealMoveSchema>;

export const DEAL_SORT_FIELDS = ['createdAt', 'updatedAt', 'title', 'valueInr', 'expectedCloseAt', 'position'] as const;
/** Shared by the Deals board and table (the same filter state, like leads). */
export const DealFiltersSchema = z.object({
  q: z.string().trim().max(200).optional().describe('Title, account or contact name'),
  pipelineId: IdSchema.optional().describe('Default = the default deal pipeline'),
  stageId: queryArray(IdSchema),
  status: queryArray(StageTypeSchema),
  ownerId: OwnerFilter,
  accountId: IdSchema.optional(),
  contactId: IdSchema.optional(),
  leadId: IdSchema.optional(),
  valueMin: z.coerce.number().int().min(0).optional(),
  valueMax: z.coerce.number().int().min(0).optional(),
  expectedCloseFrom: IsoDateTimeSchema.optional(),
  expectedCloseTo: IsoDateTimeSchema.optional(),
});
export type DealFilters = z.infer<typeof DealFiltersSchema>;
export const DealListQuerySchema = CursorPaginationQuerySchema.extend(DealFiltersSchema.shape).extend({
  sort: z.enum(DEAL_SORT_FIELDS).default('createdAt'),
  dir: SortDirSchema.default('desc'),
});
export type DealListQuery = z.infer<typeof DealListQuerySchema>;
/** GET /deals/board: filters + per-column page size. */
export const DealBoardQuerySchema = DealFiltersSchema.extend({ perColumn: z.coerce.number().int().min(1).max(200).default(50) });
export type DealBoardQuery = z.infer<typeof DealBoardQuerySchema>;

export const DealBulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), ids: z.array(IdSchema).min(1).max(500), ownerId: IdSchema.nullable() }),
  z.object({ action: z.literal('change_stage'), ids: z.array(IdSchema).min(1).max(500), stageId: IdSchema }),
  z.object({ action: z.literal('delete'), ids: z.array(IdSchema).min(1).max(500) }),
]);
export type DealBulkAction = z.infer<typeof DealBulkActionSchema>;

// ---------------------------------------------------------------- lead conversion

/**
 * POST /leads/{id}/convert: link or create the contact (default: the lead's contact, else a new one
 * from the lead), optionally an account (default: create from lead.companyName when there is one) and a
 * deal (default on). Idempotent per lead for the contact and account; a second call creates another deal
 * only when `deal` is given again.
 */
export const LeadConvertSchema = z.object({
  contactId: IdSchema.optional().describe('Link this existing contact instead of the lead contact'),
  account: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('none') }),
      z.object({ mode: z.literal('existing'), accountId: IdSchema }),
      z.object({ mode: z.literal('create'), name: z.string().trim().min(1).max(160).optional(), gstin: GstinSchema.nullable().optional() }),
    ])
    .optional()
    .describe('Default: create from lead.companyName when set, else none'),
  deal: z
    .object({
      title: z.string().trim().min(1).max(160).optional(),
      stageId: IdSchema.optional(),
      valueInr: InrSchema.optional(),
      expectedCloseAt: IsoDateTimeSchema.nullable().optional(),
      ownerId: IdSchema.nullable().optional(),
    })
    .nullable()
    .default({})
    .describe('null = no deal'),
});
export type LeadConvert = z.infer<typeof LeadConvertSchema>;

// ---------------------------------------------------------------- notes and timeline

export const CrmNoteCreateSchema = z.object({ body: z.string().trim().min(1).max(10_000) });
export type CrmNoteCreate = z.infer<typeof CrmNoteCreateSchema>;

export const CRM_TIMELINE_KINDS = ['note', 'lead_activity', 'meeting', 'quotation', 'invoice', 'payment', 'deal', 'merged'] as const;
export const CRM_REF_TYPES = ['contact', 'account', 'deal', 'lead', 'quotation', 'invoice', 'meeting'] as const;
export const CrmRefSchema = z.object({ type: z.enum(CRM_REF_TYPES), id: IdSchema });
export type CrmRef = z.infer<typeof CrmRefSchema>;

/**
 * One entry of a contact, account or deal timeline: own notes, activities of linked leads, meetings,
 * quotations, invoices, payments and deals, newest first. Cursor = opaque (time + id).
 */
export const CrmTimelineItemSchema = z.object({
  id: z.string().describe('Unique within the timeline (kind + source id)'),
  kind: z.enum(CRM_TIMELINE_KINDS),
  at: IsoDateTimeSchema,
  actor: UserSummarySchema.nullable(),
  title: z.string().describe('e.g. "Quotation QT/2026-27/0004 sent"'),
  body: z.string().nullable(),
  ref: CrmRefSchema.nullable(),
});
export type CrmTimelineItem = z.infer<typeof CrmTimelineItemSchema>;
