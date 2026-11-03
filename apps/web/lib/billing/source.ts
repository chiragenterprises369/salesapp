import type { ApiRouteId, RouteBody, RouteQuery, RouteResponse } from '@vistar/shared';
import { isMockData } from '../api/data-source';
import { httpBillingSource, httpSuperBillingSource } from './http-source';
import { mockBillingSource, mockSuperBillingSource } from './mock-source';

/**
 * Billing data sources (change #19 wave C): the company's Vistar subscription (/billing/*) and the
 * Super Admin billing (/api/super/billing/*, /api/super/config/razorpay). HTTP in API mode; an
 * in-memory mock for the test-only mock data mode (lib/api/data-source), never in API mode.
 */
type Res<K extends ApiRouteId> = Promise<RouteResponse<K>>;
type B<K extends ApiRouteId> = RouteBody<K>;
/** Query values as callers hold them (booleans and numbers are serialised), like the HTTP client's LooseQuery. */
type Loose<T> = { [P in keyof T]?: T[P] | string | number | boolean | readonly string[] | null };
type Q<K extends ApiRouteId> = Loose<NonNullable<RouteQuery<K>>>;

export interface BillingFile {
  blob: Blob;
  filename: string | null;
}

export interface BillingSource {
  overview(): Res<'billingOverview'>;
  plans(): Res<'billingPlans'>;
  updateContact(body: B<'billingContactUpdate'>): Res<'billingContactUpdate'>;
  changePlan(body: B<'billingPlanChange'>): Res<'billingPlanChange'>;
  cancelChange(): Res<'billingPlanChangeCancel'>;
  invoices(q: Q<'billingInvoiceList'>): Res<'billingInvoiceList'>;
  invoice(id: string): Res<'billingInvoiceGet'>;
  invoicePdf(id: string): Promise<BillingFile>;
  payInvoice(id: string): Res<'billingInvoicePay'>;
  verify(body: B<'billingCheckoutVerify'>): Res<'billingCheckoutVerify'>;
  mockPay(body: B<'billingCheckoutMockPay'>): Res<'billingCheckoutMockPay'>;
  payments(q: Q<'billingPaymentList'>): Res<'billingPaymentList'>;
}

export interface SuperBillingSource {
  subscriptions(q: Q<'superBillingSubscriptions'>): Res<'superBillingSubscriptions'>;
  company(id: string): Res<'superBillingCompany'>;
  createInvoice(companyId: string, body: B<'superBillingInvoiceCreate'>): Res<'superBillingInvoiceCreate'>;
  invoice(id: string): Res<'superBillingInvoiceGet'>;
  invoicePdf(id: string): Promise<BillingFile>;
  issueInvoice(id: string, body: B<'superBillingInvoiceIssue'>): Res<'superBillingInvoiceIssue'>;
  markPaid(id: string, body: B<'superBillingInvoiceMarkPaid'>): Res<'superBillingInvoiceMarkPaid'>;
  cancelInvoice(id: string, body: B<'superBillingInvoiceCancel'>): Res<'superBillingInvoiceCancel'>;
  extendTrial(companyId: string, body: B<'superBillingTrialExtend'>): Res<'superBillingTrialExtend'>;
  changePlan(companyId: string, body: B<'superBillingPlanChange'>): Res<'superBillingPlanChange'>;
  requests(q: Q<'superBillingRequestList'>): Res<'superBillingRequestList'>;
  decideRequest(id: string, body: B<'superBillingRequestDecide'>): Res<'superBillingRequestDecide'>;
  razorpay(): Res<'superRazorpayGet'>;
  saveRazorpay(body: B<'superRazorpayUpdate'>): Res<'superRazorpayUpdate'>;
  removeRazorpay(): Res<'superRazorpayDelete'>;
}

export const getBillingSource = (): BillingSource => (isMockData() ? mockBillingSource : httpBillingSource);
export const getSuperBillingSource = (): SuperBillingSource => (isMockData() ? mockSuperBillingSource : httpSuperBillingSource);
