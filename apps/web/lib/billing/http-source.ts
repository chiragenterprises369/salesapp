import { api, superApi } from '../api/client';
import type { BillingSource, SuperBillingSource } from './source';

/** HTTP billing sources on the typed client (responses parsed with the route schemas). */
export const httpBillingSource: BillingSource = {
  overview: () => api.call('billingOverview'),
  plans: () => api.call('billingPlans'),
  updateContact: (body) => api.call('billingContactUpdate', { body }),
  changePlan: (body) => api.call('billingPlanChange', { body }),
  cancelChange: () => api.call('billingPlanChangeCancel'),
  invoices: (query) => api.call('billingInvoiceList', { query }),
  invoice: (id) => api.call('billingInvoiceGet', { params: { id } }),
  invoicePdf: (id) => api.download('billingInvoicePdf', { params: { id }, query: { download: 'true' } }),
  payInvoice: (id) => api.call('billingInvoicePay', { params: { id } }),
  verify: (body) => api.call('billingCheckoutVerify', { body }),
  mockPay: (body) => api.call('billingCheckoutMockPay', { body }),
  payments: (query) => api.call('billingPaymentList', { query }),
};

export const httpSuperBillingSource: SuperBillingSource = {
  subscriptions: (query) => superApi.call('superBillingSubscriptions', { query }),
  company: (id) => superApi.call('superBillingCompany', { params: { id } }),
  createInvoice: (id, body) => superApi.call('superBillingInvoiceCreate', { params: { id }, body }),
  invoice: (id) => superApi.call('superBillingInvoiceGet', { params: { id } }),
  invoicePdf: (id) => superApi.download('superBillingInvoicePdf', { params: { id }, query: { download: 'true' } }),
  issueInvoice: (id, body) => superApi.call('superBillingInvoiceIssue', { params: { id }, body }),
  markPaid: (id, body) => superApi.call('superBillingInvoiceMarkPaid', { params: { id }, body }),
  cancelInvoice: (id, body) => superApi.call('superBillingInvoiceCancel', { params: { id }, body }),
  extendTrial: (id, body) => superApi.call('superBillingTrialExtend', { params: { id }, body }),
  changePlan: (id, body) => superApi.call('superBillingPlanChange', { params: { id }, body }),
  requests: (query) => superApi.call('superBillingRequestList', { query }),
  decideRequest: (id, body) => superApi.call('superBillingRequestDecide', { params: { id }, body }),
  razorpay: () => superApi.call('superRazorpayGet'),
  saveRazorpay: (body) => superApi.call('superRazorpayUpdate', { body }),
  removeRazorpay: () => superApi.call('superRazorpayDelete'),
};
