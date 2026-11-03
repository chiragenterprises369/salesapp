'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RouteBody, RouteQuery } from '@vistar/shared';
import { getBillingSource, getSuperBillingSource, type BillingFile } from './source';

/**
 * Billing hooks. Company keys start with 'billing' (the realtime client refreshes that scope on the
 * billing.* events); Super Admin keys with 'super-billing' (platform sessions get no workspace events,
 * so mutations refresh them).
 */
export const billingKeys = {
  all: ['billing'] as const,
  overview: () => ['billing', 'overview'] as const,
  plans: () => ['billing', 'plans'] as const,
  invoices: (q: object) => ['billing', 'invoices', q] as const,
  invoice: (id: string) => ['billing', 'invoice', id] as const,
  payments: (q: object) => ['billing', 'payments', q] as const,
};

export const superBillingKeys = {
  all: ['super-billing'] as const,
  subscriptions: (q: object) => ['super-billing', 'subscriptions', q] as const,
  company: (id: string) => ['super-billing', 'company', id] as const,
  invoice: (id: string) => ['super-billing', 'invoice', id] as const,
  requests: (q: object) => ['super-billing', 'requests', q] as const,
  razorpay: () => ['platform', 'config', 'razorpay'] as const,
};

const src = () => getBillingSource();
const sup = () => getSuperBillingSource();

// ---------------------------------------------------------------- company

export function useBillingOverview() {
  return useQuery({ queryKey: billingKeys.overview(), queryFn: () => src().overview(), staleTime: 30_000 });
}

export function useBillingPlans() {
  return useQuery({ queryKey: billingKeys.plans(), queryFn: () => src().plans(), staleTime: 5 * 60_000 });
}

export type BillingInvoiceQuery = Partial<Omit<NonNullable<RouteQuery<'billingInvoiceList'>>, 'cursor' | 'limit'>>;

export function useBillingInvoices(q: BillingInvoiceQuery = {}) {
  return useInfiniteQuery({
    queryKey: billingKeys.invoices(q),
    queryFn: ({ pageParam }) => src().invoices({ ...q, limit: 25, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

export function useBillingPayments() {
  return useInfiniteQuery({
    queryKey: billingKeys.payments({}),
    queryFn: ({ pageParam }) => src().payments({ limit: 25, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useBillingMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: billingKeys.all });
  return {
    updateContact: useMutation({ mutationFn: (body: RouteBody<'billingContactUpdate'>) => src().updateContact(body), onSuccess: refresh }),
    changePlan: useMutation({ mutationFn: (body: RouteBody<'billingPlanChange'>) => src().changePlan(body), onSuccess: refresh }),
    cancelChange: useMutation({
      mutationFn: () => src().cancelChange(),
      onSuccess: (o) => {
        qc.setQueryData(billingKeys.overview(), o);
        return refresh();
      },
    }),
    payInvoice: useMutation({ mutationFn: (id: string) => src().payInvoice(id) }),
    verify: useMutation({ mutationFn: (body: RouteBody<'billingCheckoutVerify'>) => src().verify(body), onSuccess: refresh }),
    mockPay: useMutation({ mutationFn: (body: RouteBody<'billingCheckoutMockPay'>) => src().mockPay(body), onSettled: refresh }),
  };
}

export const downloadBillingInvoicePdf = (id: string): Promise<BillingFile> => src().invoicePdf(id);

// ---------------------------------------------------------------- Super Admin

export type SubscriptionQuery = Partial<Omit<NonNullable<RouteQuery<'superBillingSubscriptions'>>, 'cursor' | 'limit'>>;

export function useSubscriptions(q: SubscriptionQuery) {
  return useInfiniteQuery({
    queryKey: superBillingKeys.subscriptions(q),
    queryFn: ({ pageParam }) => sup().subscriptions({ ...q, limit: 50, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

export function useCompanyBilling(id: string) {
  return useQuery({ queryKey: superBillingKeys.company(id), queryFn: () => sup().company(id) });
}

export function usePlanRequests(status: NonNullable<RouteQuery<'superBillingRequestList'>>['status'] = 'pending') {
  return useQuery({ queryKey: superBillingKeys.requests({ status }), queryFn: () => sup().requests({ status }) });
}

export function useSuperBillingMutations(companyId?: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: superBillingKeys.all });
  const setCompany = (data: Awaited<ReturnType<ReturnType<typeof sup>['company']>>) => {
    qc.setQueryData(superBillingKeys.company(data.company.id), data);
    return refresh();
  };
  return {
    createInvoice: useMutation({ mutationFn: (body: RouteBody<'superBillingInvoiceCreate'>) => sup().createInvoice(companyId!, body), onSuccess: refresh }),
    issueInvoice: useMutation({ mutationFn: ({ id, body }: { id: string; body: RouteBody<'superBillingInvoiceIssue'> }) => sup().issueInvoice(id, body), onSuccess: refresh }),
    markPaid: useMutation({ mutationFn: ({ id, body }: { id: string; body: RouteBody<'superBillingInvoiceMarkPaid'> }) => sup().markPaid(id, body), onSuccess: refresh }),
    cancelInvoice: useMutation({ mutationFn: ({ id, body }: { id: string; body: RouteBody<'superBillingInvoiceCancel'> }) => sup().cancelInvoice(id, body), onSuccess: refresh }),
    extendTrial: useMutation({ mutationFn: (body: RouteBody<'superBillingTrialExtend'>) => sup().extendTrial(companyId!, body), onSuccess: setCompany }),
    changePlan: useMutation({ mutationFn: (body: RouteBody<'superBillingPlanChange'>) => sup().changePlan(companyId!, body), onSuccess: setCompany }),
    decideRequest: useMutation({ mutationFn: ({ id, body }: { id: string; body: RouteBody<'superBillingRequestDecide'> }) => sup().decideRequest(id, body), onSuccess: refresh }),
  };
}

export const downloadSuperInvoicePdf = (id: string): Promise<BillingFile> => sup().invoicePdf(id);

export function useRazorpayConfig() {
  return useQuery({ queryKey: superBillingKeys.razorpay(), queryFn: () => sup().razorpay() });
}

export function useRazorpayMutations() {
  const qc = useQueryClient();
  const put = (data: Awaited<ReturnType<ReturnType<typeof sup>['razorpay']>>) => qc.setQueryData(superBillingKeys.razorpay(), data);
  return {
    save: useMutation({ mutationFn: (body: RouteBody<'superRazorpayUpdate'>) => sup().saveRazorpay(body), onSuccess: put }),
    remove: useMutation({ mutationFn: () => sup().removeRazorpay(), onSuccess: put }),
  };
}
