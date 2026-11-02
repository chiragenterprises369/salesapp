import { z } from 'zod';
import {
  DocumentKindSchema,
  InvoiceStatusSchema,
  PaymentModeSchema,
  QuotationStatusSchema,
  TaxModeSchema,
  type InvoiceStatus,
  type QuotationStatus,
} from '../enums.js';
import { DOCUMENT_PREFIX_RE } from '../gst.js';
import { WorkspaceBrandingSchema } from './branding.js';
import { LineItemInputSchema, LineItemSchema } from './catalog.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateSchema, IsoDateTimeSchema, PaiseSchema, PhoneSchema, queryArray, SignedPaiseSchema, SortDirSchema } from './common.js';
import { AccountSummarySchema, AddressSchema, ContactSummarySchema, GstinSchema, LeadRefSchema, PanSchema, StateCodeSchema } from './crm.js';
import { UserSummarySchema } from './workspace.js';

/**
 * QUOTATIONS AND INVOICES (change #19 wave B, SPEC 29.9; D-067).
 * - Money in paise; totals by computeDocument() in gst.ts (CGST + SGST when the seller's state code
 *   equals the place of supply, else IGST; round-off to the rupee; amount in words, Indian numbering).
 * - Numbering per workspace, kind and financial year: `<prefix>/<FY>/<seq>` (QT/2026-27/0001,
 *   INV/2026-27/0001). Quotations get their number on create; invoices on issue (drafts have none, so
 *   issued invoice numbers have no gaps, as GST requires).
 * - Seller and buyer details are snapshots on the document (frozen when a quotation is sent or an
 *   invoice is issued; drafts refresh them on every save).
 * - Lines are editable in draft only. Status flows: QUOTATION_TRANSITIONS and INVOICE_TRANSITIONS.
 * - Share links: a random token (SHA-256 stored), hosted page `/d/<token>` on the web and the PDF at
 *   GET /public/documents/{token}/pdf; creating a link rotates the old one.
 */

// ---------------------------------------------------------------- seller profile (Setting key billing.sellerProfile)

export const BankDetailsSchema = z.object({
  accountName: z.string().trim().max(120).nullable().default(null),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/).nullable().default(null),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, { error: 'Enter an 11-character IFSC' }).nullable().default(null),
  bankName: z.string().trim().max(120).nullable().default(null),
  branch: z.string().trim().max(120).nullable().default(null),
  upiId: z.string().trim().regex(/^[\w.-]{2,64}@[A-Za-z]{2,64}$/, { error: 'Enter a UPI id like name@bank' }).nullable().default(null),
});
export type BankDetails = z.infer<typeof BankDetailsSchema>;

/** The company's own billing identity on quotations and invoices. `address.stateCode` decides intra vs inter-state. */
export const SellerProfileSchema = z.object({
  legalName: z.string().trim().min(1).max(160),
  tradeName: z.string().trim().max(160).nullable().default(null),
  gstin: GstinSchema.nullable().default(null).describe('null = not GST registered (documents then show no GST lines)'),
  pan: PanSchema.nullable().default(null),
  address: AddressSchema,
  phone: PhoneSchema.nullable().default(null),
  email: z.email().nullable().default(null),
  website: z.url().nullable().default(null),
  bank: BankDetailsSchema.default(BankDetailsSchema.parse({})),
  quotationPrefix: z.string().trim().toUpperCase().regex(DOCUMENT_PREFIX_RE).default('QT'),
  invoicePrefix: z.string().trim().toUpperCase().regex(DOCUMENT_PREFIX_RE).default('INV'),
  quotationValidityDays: z.number().int().min(1).max(365).default(15),
  paymentTermsDays: z.number().int().min(0).max(365).default(15),
  quotationTerms: z.string().trim().max(4000).nullable().default(null),
  invoiceTerms: z.string().trim().max(4000).nullable().default(null),
  signatureLabel: z.string().trim().max(80).default('Authorised signatory'),
});
export type SellerProfile = z.infer<typeof SellerProfileSchema>;

/** GET /billing/profile: `profile` null until a company admin saves it (documents can be drafted, not sent or issued). */
export const SellerProfileResponseSchema = z.object({
  profile: SellerProfileSchema.nullable(),
  /** The seller state code (address.stateCode) for live GST previews; null when no profile. */
  stateCode: z.string().nullable(),
  complete: z.boolean().describe('Legal name and a state code are set (needed to send quotations and issue invoices)'),
});
export type SellerProfileResponse = z.infer<typeof SellerProfileResponseSchema>;

export const SellerSnapshotSchema = SellerProfileSchema.pick({ legalName: true, tradeName: true, gstin: true, pan: true, address: true, phone: true, email: true, website: true, bank: true, signatureLabel: true });
export type SellerSnapshot = z.infer<typeof SellerSnapshotSchema>;

// ---------------------------------------------------------------- buyer (party) snapshot

export const PartySchema = z.object({
  name: z.string().trim().min(1).max(160),
  gstin: GstinSchema.nullable().default(null),
  pan: PanSchema.nullable().default(null),
  phone: PhoneSchema.nullable().default(null),
  email: z.email().nullable().default(null),
  billingAddress: AddressSchema.nullable().default(null),
  shippingAddress: AddressSchema.nullable().default(null),
  contactName: z.string().trim().max(120).nullable().default(null),
});
export type Party = z.infer<typeof PartySchema>;

// ---------------------------------------------------------------- totals

export const TaxSummaryRowSchema = z.object({
  hsnSac: z.string().nullable(),
  gstRate: z.number().int(),
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
});

/** Same shape as GstTotals (gst.ts). */
export const DocumentTotalsSchema = z.object({
  taxMode: TaxModeSchema,
  subtotalPaise: PaiseSchema,
  discountPaise: PaiseSchema,
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  taxPaise: PaiseSchema,
  roundOffPaise: SignedPaiseSchema,
  totalPaise: PaiseSchema,
  amountInWords: z.string(),
  taxSummary: z.array(TaxSummaryRowSchema),
});
export type DocumentTotals = z.infer<typeof DocumentTotalsSchema>;

export const DocumentShareStateSchema = z.object({
  active: z.boolean(),
  expiresAt: IsoDateTimeSchema.nullable(),
  lastSharedAt: IsoDateTimeSchema.nullable(),
});

/** Returned once when a link is created (the token is not stored in plain text). */
export const DocumentShareSchema = z.object({
  url: z.string().describe('Hosted page on the web: <WEB_ORIGIN>/d/<token>'),
  pdfUrl: z.string().describe('<API_PUBLIC_URL>/api/v1/public/documents/<token>/pdf'),
  expiresAt: IsoDateTimeSchema,
  message: z.string().describe('Ready text for WhatsApp or email with the link'),
});
export type DocumentShare = z.infer<typeof DocumentShareSchema>;
export const DocumentShareCreateSchema = z.object({ expiresInDays: z.number().int().min(1).max(90).default(30) });
export type DocumentShareCreate = z.infer<typeof DocumentShareCreateSchema>;

// ---------------------------------------------------------------- shared document fields

const DocumentRefs = {
  owner: UserSummarySchema.nullable(),
  account: AccountSummarySchema.nullable(),
  contact: ContactSummarySchema.nullable(),
  dealId: IdSchema.nullable(),
  lead: LeadRefSchema.nullable(),
};

const DocumentDetail = {
  seller: SellerSnapshotSchema.nullable().describe('null while no seller profile exists'),
  buyer: PartySchema,
  placeOfSupplyStateCode: z.string().nullable(),
  priceListId: IdSchema.nullable(),
  lines: z.array(LineItemSchema),
  totals: DocumentTotalsSchema,
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  share: DocumentShareStateSchema,
};

/** Create input shared by quotations and invoices. Buyer defaults to the account (else the contact) details. */
const DocumentInputFields = z.object({
  accountId: IdSchema.nullable(),
  contactId: IdSchema.nullable(),
  dealId: IdSchema.nullable(),
  leadId: IdSchema.nullable(),
  ownerId: IdSchema.nullable(),
  buyer: PartySchema.describe('Explicit buyer details; omitted = from the account or contact'),
  placeOfSupplyStateCode: StateCodeSchema.nullable().describe('Default: buyer shipping state, else billing state, else the seller state'),
  issueDate: IsoDateSchema.describe('Default: today in the workspace timezone'),
  priceListId: IdSchema.nullable(),
  lines: z.array(LineItemInputSchema).min(1).max(200),
  notes: z.string().trim().max(4000).nullable(),
  terms: z.string().trim().max(4000).nullable().describe('Default: the seller profile terms'),
});

// ---------------------------------------------------------------- quotations

export const QuotationListItemSchema = z.object({
  id: IdSchema,
  number: z.string(),
  status: QuotationStatusSchema,
  issueDate: IsoDateSchema,
  validUntil: IsoDateSchema.nullable(),
  buyerName: z.string(),
  ...DocumentRefs,
  taxMode: TaxModeSchema,
  totalPaise: PaiseSchema,
  /** Invoice made from this quotation (not cancelled), if any. */
  convertedInvoiceId: IdSchema.nullable(),
  sentAt: IsoDateTimeSchema.nullable(),
  version: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type QuotationListItem = z.infer<typeof QuotationListItemSchema>;

export const QuotationSchema = QuotationListItemSchema.extend({
  ...DocumentDetail,
  acceptedAt: IsoDateTimeSchema.nullable(),
  rejectedAt: IsoDateTimeSchema.nullable(),
  statusReason: z.string().nullable(),
});
export type Quotation = z.infer<typeof QuotationSchema>;

export const QuotationCreateSchema = DocumentInputFields.partial().extend({
  lines: z.array(LineItemInputSchema).min(1).max(200),
  validUntil: IsoDateSchema.nullable().optional().describe('Default: issue date + seller quotationValidityDays'),
});
export type QuotationCreate = z.infer<typeof QuotationCreateSchema>;
/** Draft only (DOCUMENT_STATE_INVALID otherwise). */
export const QuotationUpdateSchema = DocumentInputFields.partial().extend({
  validUntil: IsoDateSchema.nullable().optional(),
  expectedVersion: z.number().int().optional(),
});
export type QuotationUpdate = z.infer<typeof QuotationUpdateSchema>;

/** Allowed manual status changes. `sent` also comes from POST /quotations/{id}/send; expired is set daily after validUntil. */
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  draft: ['sent'],
  sent: ['accepted', 'rejected', 'expired', 'draft'],
  accepted: [],
  rejected: ['draft'],
  expired: ['draft', 'sent'],
};
export const QuotationStatusChangeSchema = z.object({
  status: QuotationStatusSchema,
  reason: z.string().trim().max(500).nullable().optional().describe('Shown on rejected / reopened quotations'),
  expectedVersion: z.number().int().optional(),
});
export type QuotationStatusChange = z.infer<typeof QuotationStatusChangeSchema>;

export const QUOTATION_SORT_FIELDS = ['issueDate', 'createdAt', 'updatedAt', 'totalPaise', 'number'] as const;
const DocumentListFilters = {
  q: z.string().trim().max(200).optional().describe('Number or buyer name'),
  ownerId: queryArray(z.union([IdSchema, z.literal('me')])),
  accountId: IdSchema.optional(),
  contactId: IdSchema.optional(),
  dealId: IdSchema.optional(),
  leadId: IdSchema.optional(),
  issuedFrom: IsoDateSchema.optional(),
  issuedTo: IsoDateSchema.optional(),
};
export const QuotationListQuerySchema = CursorPaginationQuerySchema.extend({
  ...DocumentListFilters,
  status: queryArray(QuotationStatusSchema),
  sort: z.enum(QUOTATION_SORT_FIELDS).default('issueDate'),
  dir: SortDirSchema.default('desc'),
});
export type QuotationListQuery = z.infer<typeof QuotationListQuerySchema>;

export const QuotationSendResultSchema = z.object({ quotation: QuotationSchema, share: DocumentShareSchema });
export type QuotationSendResult = z.infer<typeof QuotationSendResultSchema>;

// ---------------------------------------------------------------- invoices and payments

export const PaymentSchema = z.object({
  id: IdSchema,
  invoiceId: IdSchema,
  amountPaise: PaiseSchema,
  paidOn: IsoDateSchema,
  mode: PaymentModeSchema,
  reference: z.string().nullable().describe('UTR, cheque number, ...'),
  note: z.string().nullable(),
  recordedBy: UserSummarySchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Payment = z.infer<typeof PaymentSchema>;

/** `clientPaymentId` makes retries idempotent (same id = the same payment is returned, nothing is added). */
export const PaymentCreateSchema = z.object({
  amountPaise: PaiseSchema.refine((v) => v > 0, { error: 'Enter an amount' }),
  paidOn: IsoDateSchema.optional().describe('Default: today'),
  mode: PaymentModeSchema,
  reference: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  clientPaymentId: z.string().trim().min(8).max(64).optional(),
});
export type PaymentCreate = z.infer<typeof PaymentCreateSchema>;

export const InvoiceListItemSchema = z.object({
  id: IdSchema,
  number: z.string().nullable().describe('null while draft'),
  status: InvoiceStatusSchema,
  issueDate: IsoDateSchema,
  dueDate: IsoDateSchema.nullable(),
  buyerName: z.string(),
  ...DocumentRefs,
  quotationId: IdSchema.nullable(),
  taxMode: TaxModeSchema,
  totalPaise: PaiseSchema,
  paidPaise: PaiseSchema,
  balancePaise: PaiseSchema,
  overdue: z.boolean().describe('Issued or partially paid and past the due date'),
  issuedAt: IsoDateTimeSchema.nullable(),
  version: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type InvoiceListItem = z.infer<typeof InvoiceListItemSchema>;

export const InvoiceSchema = InvoiceListItemSchema.extend({
  ...DocumentDetail,
  payments: z.array(PaymentSchema),
  cancelledAt: IsoDateTimeSchema.nullable(),
  cancelReason: z.string().nullable(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const InvoiceCreateSchema = DocumentInputFields.partial().extend({
  lines: z.array(LineItemInputSchema).min(1).max(200),
  dueDate: IsoDateSchema.nullable().optional().describe('Default: issue date + seller paymentTermsDays'),
});
export type InvoiceCreate = z.infer<typeof InvoiceCreateSchema>;
export const InvoiceUpdateSchema = DocumentInputFields.partial().extend({
  dueDate: IsoDateSchema.nullable().optional(),
  expectedVersion: z.number().int().optional(),
});
export type InvoiceUpdate = z.infer<typeof InvoiceUpdateSchema>;

/** Manual transitions; issued -> partially_paid -> paid follow the payments automatically. */
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ['issued'],
  issued: ['cancelled'],
  partially_paid: ['cancelled'],
  paid: [],
  cancelled: [],
};
export const InvoiceIssueSchema = z.object({ issueDate: IsoDateSchema.optional().describe('Default: the draft issue date (today if earlier)'), expectedVersion: z.number().int().optional() });
export type InvoiceIssue = z.infer<typeof InvoiceIssueSchema>;
export const InvoiceCancelSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type InvoiceCancel = z.infer<typeof InvoiceCancelSchema>;

export const INVOICE_SORT_FIELDS = ['issueDate', 'dueDate', 'createdAt', 'updatedAt', 'totalPaise', 'number'] as const;
export const InvoiceListQuerySchema = CursorPaginationQuerySchema.extend({
  ...DocumentListFilters,
  status: queryArray(InvoiceStatusSchema),
  overdue: z.stringbool().optional(),
  quotationId: IdSchema.optional(),
  sort: z.enum(INVOICE_SORT_FIELDS).default('issueDate'),
  dir: SortDirSchema.default('desc'),
});
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;

export const InvoiceSendResultSchema = z.object({ invoice: InvoiceSchema, share: DocumentShareSchema });
export type InvoiceSendResult = z.infer<typeof InvoiceSendResultSchema>;

export const PaymentParamSchema = z.object({ id: IdSchema, paymentId: IdSchema });

// ---------------------------------------------------------------- public document (share link)

export const DocumentTokenParamSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/) });

/** GET /public/documents/{token}: everything the hosted page shows (no internal ids except the document id). */
export const PublicDocumentSchema = z.object({
  kind: DocumentKindSchema,
  id: IdSchema,
  number: z.string().nullable(),
  status: z.union([QuotationStatusSchema, InvoiceStatusSchema]),
  issueDate: IsoDateSchema,
  validUntil: IsoDateSchema.nullable().describe('Quotations'),
  dueDate: IsoDateSchema.nullable().describe('Invoices'),
  seller: SellerSnapshotSchema.nullable(),
  buyer: PartySchema,
  placeOfSupplyStateCode: z.string().nullable(),
  lines: z.array(LineItemSchema),
  totals: DocumentTotalsSchema,
  paidPaise: PaiseSchema.nullable().describe('Invoices'),
  balancePaise: PaiseSchema.nullable().describe('Invoices'),
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  branding: WorkspaceBrandingSchema,
  workspaceName: z.string(),
  pdfUrl: z.string(),
  expiresAt: IsoDateTimeSchema,
});
export type PublicDocument = z.infer<typeof PublicDocumentSchema>;

/** Web path of the hosted document page. */
export const documentHostedPath = (token: string): string => `/d/${token}`;
/** Query `download=1` asks for Content-Disposition: attachment. */
export const DocumentPdfQuerySchema = z.object({ download: z.stringbool().optional() });
