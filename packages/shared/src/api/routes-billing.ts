import { z } from 'zod';
import { IdParamSchema, pageOf } from '../schemas/common.js';
import { DocumentPdfQuerySchema } from '../schemas/documents.js';
import {
  BillingContactSchema,
  BillingContactUpdateSchema,
  BillingOverviewSchema,
  BillingUsageSchema,
  CheckoutResultSchema,
  CheckoutSchema,
  CheckoutVerifySchema,
  CompanyBillingSchema,
  ManualInvoiceCreateSchema,
  MockCheckoutPayResultSchema,
  MockCheckoutPaySchema,
  PlanChangeCreateSchema,
  PlanChangeRequestSchema,
  PlanChangeResultSchema,
  PlanRequestDecideSchema,
  PlanRequestListQuerySchema,
  PlatformBillingProfileResponseSchema,
  PlatformBillingProfileSchema,
  PlatformInvoiceCancelSchema,
  PlatformInvoiceIssueSchema,
  PlatformInvoiceListItemSchema,
  PlatformInvoiceListQuerySchema,
  PlatformInvoiceMarkPaidSchema,
  PlatformInvoiceSchema,
  PlatformPaymentListQuerySchema,
  PlatformPaymentSchema,
  RazorpayConfigStatusSchema,
  RazorpayConfigUpdateSchema,
  RazorpayWebhookResponseSchema,
  SubscriptionListQuerySchema,
  SubscriptionListSchema,
  SuperInvoiceListQuerySchema,
  SuperPlanChangeSchema,
  TrialExtendSchema,
} from '../schemas/billing.js';
import { PlanDefinitionSchema } from '../schemas/platform.js';
import type { RouteDef } from './routes.js';

/**
 * change #19 wave C: billing routes (BILLING-PDF stream, owner backend-core). Spread into API_ROUTES in routes.ts.
 * Company routes need billing.read (company_admin by default) or billing.manage; Super Admin routes need
 * platform.billing.manage, the Razorpay config platform.system.manage (Config section).
 */
const route = <R extends RouteDef>(r: R) => r;
const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

export const BILLING_ROUTES = {
  // ---------------- company: Billing and usage (/app/billing) ----------------
  billingOverview: route({ method: 'get', path: '/billing', summary: 'Subscription, plan, usage meters, checkout availability, pending request and open invoices', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.read', response: BillingOverviewSchema }),
  billingUsage: route({ method: 'get', path: '/billing/usage', summary: 'Usage against plan limits (seats, leads, storage, WhatsApp, API calls, workflow runs, API keys); 80 % warning, 100 % reached', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.read', response: BillingUsageSchema }),
  billingPlans: route({ method: 'get', path: '/billing/plans', summary: 'Active plans for the comparison table', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.read', response: listOf(PlanDefinitionSchema) }),
  billingContactUpdate: route({ method: 'put', path: '/billing/contact', summary: 'Billing contact, GSTIN and address printed on Vistar invoices (state code = place of supply); audited', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.manage', body: BillingContactUpdateSchema, response: BillingContactSchema }),
  billingPlanChange: route({ method: 'post', path: '/billing/plan-change', summary: 'Change plan: upgrade now via checkout (prorated invoice), otherwise a request for the Super Admin; downgrade at the period end', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.manage', body: PlanChangeCreateSchema, response: PlanChangeResultSchema, status: 201 }),
  billingPlanChangeCancel: route({ method: 'delete', path: '/billing/plan-change', summary: 'Cancel the scheduled downgrade or the pending request', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.manage', response: BillingOverviewSchema }),
  billingInvoiceList: route({ method: 'get', path: '/billing/invoices', summary: 'Vistar invoices of the company, newest first', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.read', query: PlatformInvoiceListQuerySchema, response: pageOf(PlatformInvoiceListItemSchema) }),
  billingInvoiceGet: route({ method: 'get', path: '/billing/invoices/{id}', summary: 'Vistar invoice with lines, GST totals and payments (drafts are not shown to companies)', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.read', params: IdParamSchema, response: PlatformInvoiceSchema }),
  billingInvoicePdf: route({ method: 'get', path: '/billing/invoices/{id}/pdf', summary: 'A4 tax invoice PDF from Vistar (?download=1)', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.read', params: IdParamSchema, query: DocumentPdfQuerySchema, response: null, responseContentType: 'application/pdf' }),
  billingInvoicePay: route({ method: 'post', path: '/billing/invoices/{id}/pay', summary: 'Start checkout for an issued invoice (Razorpay order or mock order); 422 PAYMENT_PROVIDER_NOT_CONFIGURED without a provider', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.manage', params: IdParamSchema, response: CheckoutSchema, status: 201 }),
  billingCheckoutVerify: route({ method: 'post', path: '/billing/checkout/verify', summary: 'Verify the checkout.js success fields (HMAC of order|payment); marks the invoice paid and applies a paid upgrade; idempotent', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.manage', body: CheckoutVerifySchema, response: CheckoutResultSchema }),
  billingCheckoutMockPay: route({ method: 'post', path: '/billing/checkout/mock-pay', summary: 'Dev mock checkout: returns signed success fields (or records a failure); 404 unless the mock provider is active', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.manage', body: MockCheckoutPaySchema, response: MockCheckoutPayResultSchema }),
  billingPaymentList: route({ method: 'get', path: '/billing/payments', summary: 'Payment history (captured, failed, refunded)', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'jwt', permission: 'billing.read', query: PlatformPaymentListQuerySchema, response: pageOf(PlatformPaymentSchema) }),

  // ---------------- Razorpay webhook ----------------
  razorpayWebhook: route({ method: 'post', path: '/api/hooks/razorpay', absolute: true, summary: 'Razorpay events (X-Razorpay-Signature = HMAC-SHA256 of the raw body with the webhook secret; idempotent by x-razorpay-event-id)', tag: 'billing', owner: 'backend-core', phase: 19, auth: 'webhook', permission: null, body: z.unknown(), response: RazorpayWebhookResponseSchema }),

  // ---------------- Super Admin: Billing (/super-admin/billing) ----------------
  superBillingSubscriptions: route({ method: 'get', path: '/api/super/billing/subscriptions', absolute: true, summary: 'Subscriptions across companies with filters and totals (MRR, outstanding, by status and plan)', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', query: SubscriptionListQuerySchema, response: SubscriptionListSchema }),
  superBillingCompany: route({ method: 'get', path: '/api/super/billing/companies/{id}', absolute: true, summary: "A company's billing: subscription, usage, invoices, payments, plan requests", tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', params: IdParamSchema, response: CompanyBillingSchema }),
  superBillingInvoiceCreate: route({ method: 'post', path: '/api/super/billing/companies/{id}/invoices', absolute: true, summary: 'Create a manual invoice (GST from gst.ts; issued with VST/<FY>/<seq> unless issue=false); audited', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', params: IdParamSchema, body: ManualInvoiceCreateSchema, response: PlatformInvoiceSchema, status: 201 }),
  superBillingTrialExtend: route({ method: 'post', path: '/api/super/billing/companies/{id}/extend-trial', absolute: true, summary: 'Extend the trial by n days (also restarts a lapsed trial); audited', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', params: IdParamSchema, body: TrialExtendSchema, response: CompanyBillingSchema }),
  superBillingPlanChange: route({ method: 'post', path: '/api/super/billing/companies/{id}/plan', absolute: true, summary: 'Change plan, cycle or extra seats now or at the period end (optional prorated invoice); audited', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', params: IdParamSchema, body: SuperPlanChangeSchema, response: CompanyBillingSchema }),
  superBillingInvoiceList: route({ method: 'get', path: '/api/super/billing/invoices', absolute: true, summary: 'Vistar invoices across companies', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', query: SuperInvoiceListQuerySchema, response: pageOf(PlatformInvoiceListItemSchema) }),
  superBillingInvoiceGet: route({ method: 'get', path: '/api/super/billing/invoices/{id}', absolute: true, summary: 'One Vistar invoice (drafts included)', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', params: IdParamSchema, response: PlatformInvoiceSchema }),
  superBillingInvoicePdf: route({ method: 'get', path: '/api/super/billing/invoices/{id}/pdf', absolute: true, summary: 'Invoice PDF (?download=1)', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', params: IdParamSchema, query: DocumentPdfQuerySchema, response: null, responseContentType: 'application/pdf' }),
  superBillingInvoiceIssue: route({ method: 'post', path: '/api/super/billing/invoices/{id}/issue', absolute: true, summary: 'Issue a draft (assigns the number, freezes seller and buyer, notifies the company admins); audited', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', params: IdParamSchema, body: PlatformInvoiceIssueSchema, response: PlatformInvoiceSchema }),
  superBillingInvoiceMarkPaid: route({ method: 'post', path: '/api/super/billing/invoices/{id}/mark-paid', absolute: true, summary: 'Record a manual payment of the balance (idempotent with clientPaymentId); applies a paid upgrade, clears past due; audited', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', params: IdParamSchema, body: PlatformInvoiceMarkPaidSchema, response: PlatformInvoiceSchema }),
  superBillingInvoiceCancel: route({ method: 'post', path: '/api/super/billing/invoices/{id}/cancel', absolute: true, summary: 'Cancel an unpaid invoice with a reason (the number stays used); audited', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', params: IdParamSchema, body: PlatformInvoiceCancelSchema, response: PlatformInvoiceSchema }),
  superBillingRequestList: route({ method: 'get', path: '/api/super/billing/plan-requests', absolute: true, summary: 'Plan change requests from companies (newest first)', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', query: PlanRequestListQuerySchema, response: listOf(PlanChangeRequestSchema) }),
  superBillingRequestDecide: route({ method: 'post', path: '/api/super/billing/plan-requests/{id}/decide', absolute: true, summary: 'Approve (plan changes, optional invoice) or reject a pending request; audited', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', params: IdParamSchema, body: PlanRequestDecideSchema, response: PlanChangeRequestSchema }),
  superBillingProfileGet: route({ method: 'get', path: '/api/super/billing/profile', absolute: true, summary: "Vistar's billing profile (legal name, GSTIN, address with state code, bank, SAC, prefix)", tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', response: PlatformBillingProfileResponseSchema }),
  superBillingProfileUpdate: route({ method: 'put', path: '/api/super/billing/profile', absolute: true, summary: 'Save the Vistar billing profile (GSTIN state must match the address state); audited', tag: 'super-billing', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.billing.manage', body: PlatformBillingProfileSchema, response: PlatformBillingProfileResponseSchema }),

  // ---------------- Super Admin: Config > Razorpay ----------------
  superRazorpayGet: route({ method: 'get', path: '/api/super/config/razorpay', absolute: true, summary: 'Razorpay config status (secrets masked), webhook URL and the active provider', tag: 'super-config', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.system.manage', response: RazorpayConfigStatusSchema }),
  superRazorpayUpdate: route({ method: 'put', path: '/api/super/config/razorpay', absolute: true, summary: 'Save key id, mode and (write-only) key secret and webhook secret, stored encrypted; audited', tag: 'super-config', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.system.manage', body: RazorpayConfigUpdateSchema, response: RazorpayConfigStatusSchema }),
  superRazorpayDelete: route({ method: 'delete', path: '/api/super/config/razorpay', absolute: true, summary: 'Remove the Razorpay config (checkout falls back to mock in development, else "Request change"); audited', tag: 'super-config', owner: 'backend-core', phase: 19, auth: 'super', permission: 'platform.system.manage', response: RazorpayConfigStatusSchema }),
} as const satisfies Record<string, RouteDef>;
