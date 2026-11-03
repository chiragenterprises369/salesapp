import { z } from 'zod';
import {
  BillingCycleSchema,
  GstRateSchema,
  PaymentModeSchema,
  PaymentProviderSchema,
  PlanChangeStatusSchema,
  PlanSchema,
  PlatformInvoiceKindSchema,
  PlatformInvoiceStatusSchema,
  PlatformPaymentStatusSchema,
  SubscriptionStatusSchema,
  TaxModeSchema,
  UsageMetricSchema,
  WorkspaceStatusSchema,
} from '../enums.js';
import { DOCUMENT_PREFIX_RE } from '../gst.js';
import { CursorPaginationQuerySchema, HexColorSchema, IdSchema, IsoDateSchema, IsoDateTimeSchema, PaiseSchema, PhoneSchema } from './common.js';
import { AddressSchema, GstinSchema, StateCodeSchema } from './crm.js';
import { DocumentTotalsSchema, PartySchema, SellerProfileSchema, SellerSnapshotSchema } from './documents.js';
import { PlanDefinitionSchema } from './platform.js';
import { UserSummarySchema } from './workspace.js';

/**
 * Vistar subscription billing (change #19 wave C, SPEC 15.7 and 16, D-072). A company (workspace) has one
 * subscription; Vistar invoices it with GST (gst.ts, numbering VST/<FY>/<seq> across all companies, PDF with the
 * same writer as CRM documents); payments come from Razorpay checkout (or the dev mock provider) or are marked paid
 * by a Super Admin. Names carry "Platform" / "Billing" so they never clash with the CRM Invoice and Payment schemas.
 */

// ---------------------------------------------------------------- usage and limits

export const UsageMeterSchema = z.object({
  metric: UsageMetricSchema,
  label: z.string(),
  unit: z.enum(['count', 'mb']),
  window: z.enum(['total', 'month']).describe('total = current count; month = this calendar month (IST)'),
  used: z.number().int(),
  limit: z.number().int().nullable().describe('null = unlimited'),
  percent: z.number().nullable(),
  state: z.enum(['ok', 'warning', 'reached']).describe('warning from USAGE_WARNING_PERCENT (80), reached at 100 (creates answer 402)'),
});
export type UsageMeter = z.infer<typeof UsageMeterSchema>;

export const BillingUsageSchema = z.object({
  period: z.string().describe('YYYY-MM (IST) of the monthly meters'),
  meters: z.array(UsageMeterSchema),
  generatedAt: IsoDateTimeSchema,
});
export type BillingUsage = z.infer<typeof BillingUsageSchema>;

// ---------------------------------------------------------------- subscription

/** Who Vistar bills: name, GSTIN and address (state code = place of supply) printed on Vistar invoices. */
export const BillingContactSchema = z.object({
  name: z.string().trim().min(1).max(160).describe('Legal name on Vistar invoices'),
  email: z.email().nullable().default(null),
  phone: PhoneSchema.nullable().default(null),
  gstin: GstinSchema.nullable().default(null).describe('Lets the company claim input tax credit'),
  address: AddressSchema.nullable().default(null),
});
export type BillingContact = z.infer<typeof BillingContactSchema>;

export const ScheduledPlanChangeSchema = z.object({
  plan: PlanSchema,
  cycle: BillingCycleSchema,
  effectiveAt: IsoDateTimeSchema.describe('The current period end'),
});

export const SubscriptionSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  plan: PlanSchema,
  planName: z.string(),
  status: SubscriptionStatusSchema,
  cycle: BillingCycleSchema,
  seatsIncluded: z.number().int().nullable().describe('Seats in the plan (null = unlimited)'),
  extraSeats: z.number().int().min(0),
  seats: z.number().int().nullable().describe('Seat limit in effect = seatsIncluded + extraSeats'),
  pricePaise: PaiseSchema.describe('Price of one cycle before GST (plan plus extra seats)'),
  currentPeriodStart: IsoDateTimeSchema,
  currentPeriodEnd: IsoDateTimeSchema,
  trialEndsAt: IsoDateTimeSchema.nullable(),
  trialDaysLeft: z.number().int().nullable().describe('null when not trialing'),
  pastDueSince: IsoDateTimeSchema.nullable(),
  cancelledAt: IsoDateTimeSchema.nullable(),
  scheduledChange: ScheduledPlanChangeSchema.nullable().describe('A downgrade waiting for the period end'),
  billingContact: BillingContactSchema.nullable(),
  version: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

/** What the company's "Pay" and "Upgrade" buttons can do right now. */
export const CheckoutAvailabilitySchema = z.object({
  available: z.boolean().describe('false = no Razorpay config and not in development: show "Request change"'),
  provider: z.enum(['razorpay', 'mock']).nullable(),
  mode: z.enum(['test', 'live']).nullable(),
});
export type CheckoutAvailability = z.infer<typeof CheckoutAvailabilitySchema>;

export const PlanChangeRequestSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  companyName: z.string(),
  fromPlan: PlanSchema,
  toPlan: PlanSchema,
  cycle: BillingCycleSchema,
  status: PlanChangeStatusSchema,
  note: z.string().nullable(),
  requestedBy: UserSummarySchema.nullable(),
  decidedAt: IsoDateTimeSchema.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type PlanChangeRequest = z.infer<typeof PlanChangeRequestSchema>;

// ---------------------------------------------------------------- platform invoices and payments

export const PlatformInvoiceLineSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  sacCode: z.string().nullable(),
  quantity: z.number(),
  unitPricePaise: PaiseSchema,
  gstRate: GstRateSchema,
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  totalPaise: PaiseSchema,
});
export type PlatformInvoiceLine = z.infer<typeof PlatformInvoiceLineSchema>;

export const PlatformInvoiceLineInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).nullable().optional(),
  sacCode: z.string().trim().regex(/^\d{4,8}$/, { error: 'Enter a 4 to 8 digit SAC code' }).nullable().optional().describe('Default: the Vistar billing profile SAC'),
  quantity: z.number().positive().max(1_000_000).default(1),
  unitPricePaise: PaiseSchema,
  gstRate: GstRateSchema.optional().describe('Default: the Vistar billing profile rate (18)'),
});
export type PlatformInvoiceLineInput = z.input<typeof PlatformInvoiceLineInputSchema>;

export const PlatformPaymentSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  invoiceId: IdSchema,
  invoiceNumber: z.string().nullable(),
  amountPaise: PaiseSchema,
  status: PlatformPaymentStatusSchema,
  provider: PaymentProviderSchema,
  mode: PaymentModeSchema.nullable().describe('Manual payments only'),
  providerOrderId: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  paidOn: IsoDateSchema.nullable(),
  failureReason: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type PlatformPayment = z.infer<typeof PlatformPaymentSchema>;

export const PlatformInvoiceListItemSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  companyName: z.string(),
  number: z.string().nullable().describe('VST/<FY>/<seq>; null while draft'),
  kind: PlatformInvoiceKindSchema,
  status: PlatformInvoiceStatusSchema,
  issueDate: IsoDateSchema,
  dueDate: IsoDateSchema.nullable(),
  plan: PlanSchema.nullable(),
  cycle: BillingCycleSchema.nullable(),
  periodStart: IsoDateSchema.nullable(),
  periodEnd: IsoDateSchema.nullable(),
  taxMode: TaxModeSchema,
  totalPaise: PaiseSchema,
  paidPaise: PaiseSchema,
  balancePaise: PaiseSchema,
  overdue: z.boolean().describe('Issued and past the due date'),
  issuedAt: IsoDateTimeSchema.nullable(),
  paidAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type PlatformInvoiceListItem = z.infer<typeof PlatformInvoiceListItemSchema>;

export const PlatformInvoiceSchema = PlatformInvoiceListItemSchema.extend({
  seller: SellerSnapshotSchema.describe('Vistar, frozen at issue'),
  buyer: PartySchema.describe('The company, from its billing contact (frozen at issue)'),
  placeOfSupplyStateCode: z.string().nullable(),
  lines: z.array(PlatformInvoiceLineSchema),
  totals: DocumentTotalsSchema,
  notes: z.string().nullable(),
  payments: z.array(PlatformPaymentSchema),
  cancelledAt: IsoDateTimeSchema.nullable(),
  cancelReason: z.string().nullable(),
});
export type PlatformInvoice = z.infer<typeof PlatformInvoiceSchema>;

export const PlatformInvoiceListQuerySchema = CursorPaginationQuerySchema.extend({
  status: PlatformInvoiceStatusSchema.optional(),
  kind: PlatformInvoiceKindSchema.optional(),
  overdue: z.stringbool().optional(),
});
export const SuperInvoiceListQuerySchema = PlatformInvoiceListQuerySchema.extend({ workspaceId: IdSchema.optional() });

export const PlatformPaymentListQuerySchema = CursorPaginationQuerySchema.extend({ status: PlatformPaymentStatusSchema.optional() });

// ---------------------------------------------------------------- checkout (Razorpay or the dev mock)

/** Everything checkout.js needs (`new Razorpay({ key, order_id, amount, ... })`); the mock provider uses mock-pay instead. */
export const CheckoutSchema = z.object({
  provider: z.enum(['razorpay', 'mock']),
  mode: z.enum(['test', 'live']).nullable(),
  keyId: z.string().nullable().describe('Razorpay key id (public); null for mock'),
  scriptUrl: z.string().nullable().describe('RAZORPAY_CHECKOUT_SCRIPT; null for mock'),
  orderId: z.string(),
  amountPaise: PaiseSchema,
  currency: z.literal('INR'),
  invoiceId: IdSchema,
  invoiceNumber: z.string().nullable(),
  name: z.string().describe('Merchant name shown in the checkout'),
  description: z.string(),
  prefill: z.object({ name: z.string().nullable(), email: z.string().nullable(), contact: z.string().nullable() }),
  notes: z.record(z.string(), z.string()),
});
export type Checkout = z.infer<typeof CheckoutSchema>;

/** checkout.js success handler fields (razorpay_order_id, razorpay_payment_id, razorpay_signature). */
export const CheckoutVerifySchema = z.object({
  orderId: z.string().trim().min(1).max(64),
  paymentId: z.string().trim().min(1).max(64),
  signature: z.string().trim().regex(/^[0-9a-f]{64}$/, { error: 'Invalid signature' }),
});
export type CheckoutVerify = z.infer<typeof CheckoutVerifySchema>;

export const CheckoutResultSchema = z.object({ invoice: PlatformInvoiceSchema, subscription: SubscriptionSchema });
export type CheckoutResult = z.infer<typeof CheckoutResultSchema>;

/** Dev mock checkout: the server plays Razorpay and returns what checkout.js would hand to the success handler. */
export const MockCheckoutPaySchema = z.object({ orderId: z.string().trim().min(1).max(64), outcome: z.enum(['success', 'failure']).default('success') });
export const MockCheckoutPayResultSchema = z.object({
  orderId: z.string(),
  paymentId: z.string(),
  signature: z.string().nullable().describe('null when the outcome is failure'),
  error: z.string().nullable(),
});
export type MockCheckoutPayResult = z.infer<typeof MockCheckoutPayResultSchema>;

// ---------------------------------------------------------------- company billing page

export const PlanChangeCreateSchema = z.object({
  plan: PlanSchema,
  cycle: BillingCycleSchema.optional().describe('Default: the current cycle'),
  note: z.string().trim().max(500).optional(),
});
export type PlanChangeCreate = z.infer<typeof PlanChangeCreateSchema>;

/**
 * checkout = upgrade invoice issued, pay it now (`checkout` set); scheduled = downgrade at the period end;
 * requested = no checkout configured, a Super Admin decides; applied = took effect at once (no amount due).
 */
export const PlanChangeResultSchema = z.object({
  outcome: z.enum(['checkout', 'scheduled', 'requested', 'applied']),
  subscription: SubscriptionSchema,
  checkout: CheckoutSchema.nullable(),
  invoice: PlatformInvoiceListItemSchema.nullable(),
  request: PlanChangeRequestSchema.nullable(),
  warnings: z.array(z.string()).describe('e.g. usage above the limits of the lower plan'),
});
export type PlanChangeResult = z.infer<typeof PlanChangeResultSchema>;

export const BillingOverviewSchema = z.object({
  subscription: SubscriptionSchema,
  plan: PlanDefinitionSchema,
  usage: BillingUsageSchema,
  checkout: CheckoutAvailabilitySchema,
  pendingRequest: PlanChangeRequestSchema.nullable(),
  openInvoices: z.object({ count: z.number().int(), balancePaise: PaiseSchema, overdue: z.number().int() }),
  nextInvoiceAt: IsoDateTimeSchema.nullable().describe('Renewal or end of trial for paid plans; null on free'),
});
export type BillingOverview = z.infer<typeof BillingOverviewSchema>;

// ---------------------------------------------------------------- Super Admin

export const SubscriptionListQuerySchema = CursorPaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  status: SubscriptionStatusSchema.optional(),
  plan: PlanSchema.optional(),
  cycle: BillingCycleSchema.optional(),
  overdue: z.stringbool().optional().describe('Only companies with an overdue invoice'),
});

export const SubscriptionListItemSchema = z.object({
  company: z.object({ id: IdSchema, name: z.string(), slug: z.string(), status: WorkspaceStatusSchema }),
  subscription: SubscriptionSchema,
  mrrPaise: PaiseSchema.describe('Monthly value: cycle price (yearly / 12) while active or past due'),
  outstandingPaise: PaiseSchema,
  overdueInvoices: z.number().int(),
  seatsUsed: z.number().int(),
  lastPaymentAt: IsoDateTimeSchema.nullable(),
  pendingRequest: z.boolean(),
});
export type SubscriptionListItem = z.infer<typeof SubscriptionListItemSchema>;

/** Totals cover every company matching the filters, not only the page. */
export const SubscriptionListSchema = z.object({
  items: z.array(SubscriptionListItemSchema),
  nextCursor: z.string().nullable(),
  totals: z.object({
    companies: z.number().int(),
    mrrPaise: PaiseSchema,
    outstandingPaise: PaiseSchema,
    overdueCompanies: z.number().int(),
    byStatus: z.record(SubscriptionStatusSchema, z.number().int()),
    byPlan: z.record(PlanSchema, z.number().int()),
  }),
});
export type SubscriptionList = z.infer<typeof SubscriptionListSchema>;

export const CompanyBillingSchema = z.object({
  company: z.object({ id: IdSchema, name: z.string(), slug: z.string(), status: WorkspaceStatusSchema }),
  subscription: SubscriptionSchema,
  plan: PlanDefinitionSchema,
  usage: BillingUsageSchema,
  invoices: z.array(PlatformInvoiceListItemSchema).describe('Newest 50'),
  payments: z.array(PlatformPaymentSchema).describe('Newest 50'),
  requests: z.array(PlanChangeRequestSchema).describe('Newest 20'),
});
export type CompanyBilling = z.infer<typeof CompanyBillingSchema>;

export const ManualInvoiceCreateSchema = z.object({
  lines: z.array(PlatformInvoiceLineInputSchema).min(1).max(50),
  issueDate: IsoDateSchema.optional().describe('Default: today (IST)'),
  dueDate: IsoDateSchema.nullable().optional().describe('Default: issue date + profile paymentTermsDays'),
  placeOfSupplyStateCode: StateCodeSchema.nullable().optional().describe('Default: the billing contact state, else Vistar state'),
  notes: z.string().trim().max(2000).nullable().optional(),
  issue: z.boolean().default(true).describe('false keeps a draft (no number)'),
});
export type ManualInvoiceCreate = z.input<typeof ManualInvoiceCreateSchema>;

export const PlatformInvoiceMarkPaidSchema = z.object({
  mode: PaymentModeSchema,
  reference: z.string().trim().max(120).nullable().optional().describe('UTR, cheque number, ...'),
  paidOn: IsoDateSchema.optional().describe('Default: today (IST)'),
  note: z.string().trim().max(500).nullable().optional(),
  clientPaymentId: z.string().trim().min(8).max(64).optional().describe('Retry with the same id = no second payment'),
});
export type PlatformInvoiceMarkPaid = z.infer<typeof PlatformInvoiceMarkPaidSchema>;

export const PlatformInvoiceIssueSchema = z.object({ dueDate: IsoDateSchema.nullable().optional() });
export const PlatformInvoiceCancelSchema = z.object({ reason: z.string().trim().min(5).max(500) });

export const TrialExtendSchema = z.object({
  days: z.number().int().min(1).max(90),
  reason: z.string().trim().min(5).max(500),
});
export type TrialExtend = z.infer<typeof TrialExtendSchema>;

export const SuperPlanChangeSchema = z.object({
  plan: PlanSchema,
  cycle: BillingCycleSchema.optional().describe('Default: the current cycle'),
  extraSeats: z.number().int().min(0).max(10_000).optional(),
  effective: z.enum(['now', 'period_end']).default('now'),
  invoice: z.boolean().default(false).describe('Issue a prorated plan_change invoice when the change costs more now'),
  reason: z.string().trim().min(5).max(500),
});
export type SuperPlanChange = z.infer<typeof SuperPlanChangeSchema>;

export const PlanRequestListQuerySchema = z.object({ status: PlanChangeStatusSchema.optional() });
export const PlanRequestDecideSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional(),
  effective: z.enum(['now', 'period_end']).default('now'),
  invoice: z.boolean().default(true).describe('On approve: issue the prorated invoice (paid later by checkout or manually)'),
});
export type PlanRequestDecide = z.infer<typeof PlanRequestDecideSchema>;

/** Vistar's own GST identity on its invoices (PlatformSetting billing.vistarProfile). */
export const PlatformBillingProfileSchema = SellerProfileSchema.pick({ legalName: true, tradeName: true, gstin: true, pan: true, address: true, phone: true, email: true, website: true, bank: true, signatureLabel: true }).extend({
  invoicePrefix: z.string().trim().toUpperCase().regex(DOCUMENT_PREFIX_RE).default('VST'),
  sacCode: z.string().trim().regex(/^\d{4,8}$/).default('998314'),
  gstRate: GstRateSchema.default(18),
  paymentTermsDays: z.number().int().min(0).max(60).default(7),
  invoiceTerms: z.string().trim().max(4000).nullable().default(null),
  brandColor: HexColorSchema.nullable().default(null),
});
export type PlatformBillingProfile = z.infer<typeof PlatformBillingProfileSchema>;

export const PlatformBillingProfileResponseSchema = z.object({
  profile: PlatformBillingProfileSchema.nullable(),
  complete: z.boolean().describe('Legal name and state code set: needed to issue invoices (renewals wait until then)'),
});
export type PlatformBillingProfileResponse = z.infer<typeof PlatformBillingProfileResponseSchema>;

// ---------------------------------------------------------------- Razorpay config (Super Admin > Config)

export const RazorpayModeSchema = z.enum(['test', 'live']);
export type RazorpayMode = z.infer<typeof RazorpayModeSchema>;

/** Secrets are write-only: omit them to keep the stored ones (both are required on the first save). */
export const RazorpayConfigUpdateSchema = z
  .object({
    mode: RazorpayModeSchema,
    keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]{6,32}$/, { error: 'Enter a Razorpay key id (rzp_test_... or rzp_live_...)' }),
    keySecret: z.string().trim().min(8).max(128).optional(),
    webhookSecret: z.string().trim().min(8).max(128).optional(),
    enabled: z.boolean().default(true),
  })
  .refine((v) => v.keyId.startsWith(`rzp_${v.mode}_`), { error: 'The key id does not match the mode', path: ['keyId'] });
export type RazorpayConfigUpdate = z.infer<typeof RazorpayConfigUpdateSchema>;

export const RazorpayConfigStatusSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  mode: RazorpayModeSchema.nullable(),
  keyId: z.string().nullable().describe('Public key id (checkout.js needs it)'),
  keySecretLast4: z.string().nullable(),
  webhookSecretSet: z.boolean(),
  webhookUrl: z.string().describe('<API_PUBLIC_URL>/api/hooks/razorpay; events payment.captured, payment.failed, order.paid'),
  activeProvider: z.enum(['razorpay', 'mock', 'none']).describe('What checkout uses now (mock in development without a config)'),
  updatedAt: IsoDateTimeSchema.nullable(),
  lastWebhookAt: IsoDateTimeSchema.nullable(),
});
export type RazorpayConfigStatus = z.infer<typeof RazorpayConfigStatusSchema>;

export const RazorpayWebhookResponseSchema = z.object({ ok: z.literal(true), duplicate: z.boolean() });

export const BillingContactUpdateSchema = BillingContactSchema;
export type BillingContactUpdate = z.input<typeof BillingContactUpdateSchema>;
