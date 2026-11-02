'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Invoice, InvoiceListQuery, Quotation, QuotationListQuery, RouteBody } from '@vistar/shared';
import { crmKeys } from './keys';
import { getCrmSource, type PdfFile } from './source';

/** Quotations, invoices, payments, share links and PDFs. */
const src = () => getCrmSource();

export type QuotationQuery = Partial<Omit<QuotationListQuery, 'cursor' | 'limit'>>;
export type InvoiceQuery = Partial<Omit<InvoiceListQuery, 'cursor' | 'limit'>>;

export function useQuotations(q: QuotationQuery, opts: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: crmKeys.quotations.list(q),
    queryFn: ({ pageParam }) => src().quotations.list({ ...q, limit: 50, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

export function useQuotation(id: string | null | undefined) {
  return useQuery({ queryKey: crmKeys.quotations.detail(id ?? ''), queryFn: () => src().quotations.get(id!), enabled: !!id });
}

export function useInvoices(q: InvoiceQuery, opts: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: crmKeys.invoices.list(q),
    queryFn: ({ pageParam }) => src().invoices.list({ ...q, limit: 50, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

export function useInvoice(id: string | null | undefined) {
  return useQuery({ queryKey: crmKeys.invoices.detail(id ?? ''), queryFn: () => src().invoices.get(id!), enabled: !!id });
}

export function useQuotationMutations() {
  const qc = useQueryClient();
  const put = (q: Quotation) => {
    qc.setQueryData(crmKeys.quotations.detail(q.id), q);
    return Promise.all([qc.invalidateQueries({ queryKey: ['quotations', 'list'] }), qc.invalidateQueries({ queryKey: ['deals'] }), qc.invalidateQueries({ queryKey: ['contacts', 'related'] }), qc.invalidateQueries({ queryKey: ['accounts', 'related'] })]);
  };
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'quotationCreate'>) => src().quotations.create(body), onSuccess: put }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: RouteBody<'quotationUpdate'> }) => src().quotations.update(id, patch), onSuccess: put }),
    setStatus: useMutation({ mutationFn: ({ id, body }: { id: string; body: RouteBody<'quotationStatus'> }) => src().quotations.setStatus(id, body), onSuccess: put }),
    send: useMutation({ mutationFn: ({ id, expiresInDays }: { id: string; expiresInDays?: number }) => src().quotations.send(id, { expiresInDays }), onSuccess: (r) => put(r.quotation) }),
    share: useMutation({
      mutationFn: ({ id, expiresInDays }: { id: string; expiresInDays?: number }) => src().quotations.share(id, { expiresInDays }),
      onSuccess: (_s, { id }) => qc.invalidateQueries({ queryKey: crmKeys.quotations.detail(id) }),
    }),
    revokeShare: useMutation({ mutationFn: (id: string) => src().quotations.revokeShare(id), onSuccess: (_v, id) => qc.invalidateQueries({ queryKey: crmKeys.quotations.detail(id) }) }),
    duplicate: useMutation({ mutationFn: (id: string) => src().quotations.duplicate(id), onSuccess: put }),
    convert: useMutation({
      mutationFn: (id: string) => src().quotations.convert(id),
      onSuccess: (inv, id) => {
        qc.setQueryData(crmKeys.invoices.detail(inv.id), inv);
        return Promise.all([qc.invalidateQueries({ queryKey: crmKeys.quotations.detail(id) }), qc.invalidateQueries({ queryKey: crmKeys.invoices.all }), qc.invalidateQueries({ queryKey: ['quotations', 'list'] })]);
      },
    }),
    remove: useMutation({ mutationFn: (id: string) => src().quotations.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.quotations.all }) }),
  };
}

export function useInvoiceMutations() {
  const qc = useQueryClient();
  const put = (inv: Invoice) => {
    qc.setQueryData(crmKeys.invoices.detail(inv.id), inv);
    return Promise.all([qc.invalidateQueries({ queryKey: ['invoices', 'list'] }), qc.invalidateQueries({ queryKey: ['contacts', 'related'] }), qc.invalidateQueries({ queryKey: ['accounts', 'related'] }), qc.invalidateQueries({ queryKey: ['deals', 'related'] })]);
  };
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'invoiceCreate'>) => src().invoices.create(body), onSuccess: put }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: RouteBody<'invoiceUpdate'> }) => src().invoices.update(id, patch), onSuccess: put }),
    issue: useMutation({ mutationFn: ({ id, body }: { id: string; body: RouteBody<'invoiceIssue'> }) => src().invoices.issue(id, body), onSuccess: put }),
    cancel: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => src().invoices.cancel(id, { reason }), onSuccess: put }),
    send: useMutation({ mutationFn: ({ id, expiresInDays }: { id: string; expiresInDays?: number }) => src().invoices.send(id, { expiresInDays }), onSuccess: (r) => put(r.invoice) }),
    share: useMutation({
      mutationFn: ({ id, expiresInDays }: { id: string; expiresInDays?: number }) => src().invoices.share(id, { expiresInDays }),
      onSuccess: (_s, { id }) => qc.invalidateQueries({ queryKey: crmKeys.invoices.detail(id) }),
    }),
    revokeShare: useMutation({ mutationFn: (id: string) => src().invoices.revokeShare(id), onSuccess: (_v, id) => qc.invalidateQueries({ queryKey: crmKeys.invoices.detail(id) }) }),
    recordPayment: useMutation({ mutationFn: ({ id, body }: { id: string; body: RouteBody<'paymentCreate'> }) => src().invoices.recordPayment(id, body), onSuccess: put }),
    deletePayment: useMutation({ mutationFn: ({ id, paymentId }: { id: string; paymentId: string }) => src().invoices.deletePayment(id, paymentId), onSuccess: put }),
    remove: useMutation({ mutationFn: (id: string) => src().invoices.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.invoices.all }) }),
  };
}

/** Save a downloaded PDF with the server's file name (fallback given). */
export function saveFile(file: PdfFile, fallback: string): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename ?? fallback;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const downloadQuotationPdf = (id: string) => src().quotations.pdf(id);
export const downloadInvoicePdf = (id: string) => src().invoices.pdf(id);
