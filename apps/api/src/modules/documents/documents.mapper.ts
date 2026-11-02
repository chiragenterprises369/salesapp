import { amountInWordsInr, InvoiceListItemSchema, PartySchema, SellerSnapshotSchema, type DocumentTotals, type Invoice, type InvoiceListItem, type Party, type Payment, type Quotation, type QuotationListItem, type SellerSnapshot, type TaxMode } from '@vistar/shared';
import { iso, toUserSummary, USER_SUMMARY_SELECT, type UserSummarySource } from '../../common/mappers/user.mapper.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ACCOUNT_SUMMARY_SELECT, CONTACT_SUMMARY_SELECT, toAccountSummary, toContactSummary, toLineItem } from '../crm/crm.mapper.js';
import { dateOnly, num } from '../crm/lib/values.js';

export const QUOTATION_LIST_INCLUDE = {
  owner: { select: USER_SUMMARY_SELECT },
  company: { select: ACCOUNT_SUMMARY_SELECT },
  contact: { select: CONTACT_SUMMARY_SELECT },
  lead: { select: { id: true, name: true } },
  invoices: { where: { status: { not: 'cancelled' }, deletedAt: null }, select: { id: true }, take: 1, orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.QuotationInclude;
export const QUOTATION_DETAIL_INCLUDE = { ...QUOTATION_LIST_INCLUDE, lines: { orderBy: { position: 'asc' } } } as const satisfies Prisma.QuotationInclude;
export type QuotationListRow = Prisma.QuotationGetPayload<{ include: typeof QUOTATION_LIST_INCLUDE }>;
export type QuotationDetailRow = Prisma.QuotationGetPayload<{ include: typeof QUOTATION_DETAIL_INCLUDE }>;

export const INVOICE_LIST_INCLUDE = {
  owner: { select: USER_SUMMARY_SELECT },
  company: { select: ACCOUNT_SUMMARY_SELECT },
  contact: { select: CONTACT_SUMMARY_SELECT },
  lead: { select: { id: true, name: true } },
} as const satisfies Prisma.InvoiceInclude;
export const INVOICE_DETAIL_INCLUDE = { ...INVOICE_LIST_INCLUDE, lines: { orderBy: { position: 'asc' } }, payments: { where: { voidedAt: null }, orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }] } } as const satisfies Prisma.InvoiceInclude;
export type InvoiceListRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_LIST_INCLUDE }>;
export type InvoiceDetailRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_DETAIL_INCLUDE }>;

type MoneyCols = {
  taxMode: string;
  subtotalPaise: bigint;
  discountPaise: bigint;
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  igstPaise: bigint;
  roundOffPaise: bigint;
  totalPaise: bigint;
};
type LineCols = { hsnSac: string | null; gstRate: number; taxablePaise: bigint; cgstPaise: bigint; sgstPaise: bigint; igstPaise: bigint };

export const taxModeOf = (v: string): TaxMode => (v === 'inter' ? 'inter' : 'intra');

/** Totals from the stored columns; the HSN summary and words are rebuilt from the stored lines. */
export function totalsOf(d: MoneyCols, lines: readonly LineCols[]): DocumentTotals {
  const groups = new Map<string, DocumentTotals['taxSummary'][number]>();
  for (const l of lines) {
    const key = `${l.hsnSac ?? ''}|${l.gstRate}`;
    const row = groups.get(key) ?? { hsnSac: l.hsnSac, gstRate: l.gstRate, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    row.taxablePaise += num(l.taxablePaise);
    row.cgstPaise += num(l.cgstPaise);
    row.sgstPaise += num(l.sgstPaise);
    row.igstPaise += num(l.igstPaise);
    groups.set(key, row);
  }
  const total = num(d.totalPaise);
  const cgst = num(d.cgstPaise);
  const sgst = num(d.sgstPaise);
  const igst = num(d.igstPaise);
  return {
    taxMode: taxModeOf(d.taxMode),
    subtotalPaise: num(d.subtotalPaise),
    discountPaise: num(d.discountPaise),
    taxablePaise: num(d.taxablePaise),
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    taxPaise: cgst + sgst + igst,
    roundOffPaise: num(d.roundOffPaise),
    totalPaise: total,
    amountInWords: amountInWordsInr(total),
    taxSummary: [...groups.values()].sort((a, b) => (a.hsnSac ?? '').localeCompare(b.hsnSac ?? '') || a.gstRate - b.gstRate),
  };
}

export const parseParty = (j: unknown): Party => {
  const r = PartySchema.safeParse(j);
  return r.success ? r.data : PartySchema.parse({ name: 'Customer' });
};
export const parseSeller = (j: unknown): SellerSnapshot | null => {
  if (!j) return null;
  const r = SellerSnapshotSchema.safeParse(j);
  return r.success ? r.data : null;
};

const shareState = (d: { shareTokenHash: string | null; shareExpiresAt: Date | null; sharedAt: Date | null }, now = Date.now()) => ({
  active: !!d.shareTokenHash && !!d.shareExpiresAt && d.shareExpiresAt.getTime() > now,
  expiresAt: iso(d.shareExpiresAt),
  lastSharedAt: iso(d.sharedAt),
});

const refs = (d: { owner: UserSummarySource | null; company: Parameters<typeof toAccountSummary>[0]; contact: Parameters<typeof toContactSummary>[0]; dealId: string | null; lead: { id: string; name: string } | null }) => ({
  owner: toUserSummary(d.owner),
  account: toAccountSummary(d.company),
  contact: toContactSummary(d.contact),
  dealId: d.dealId,
  lead: d.lead ? { id: d.lead.id, name: d.lead.name } : null,
});

// ---------------------------------------------------------------- quotations

export function toQuotationListItem(q: QuotationListRow): QuotationListItem {
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    issueDate: dateOnly(q.issueDate)!,
    validUntil: dateOnly(q.validUntil),
    buyerName: q.buyerName,
    ...refs(q),
    taxMode: taxModeOf(q.taxMode),
    totalPaise: num(q.totalPaise),
    convertedInvoiceId: q.invoices[0]?.id ?? null,
    sentAt: iso(q.sentAt),
    version: q.version,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

export function toQuotation(q: QuotationDetailRow): Quotation {
  return {
    ...toQuotationListItem(q),
    seller: parseSeller(q.seller),
    buyer: parseParty(q.buyer),
    placeOfSupplyStateCode: q.placeOfSupply,
    priceListId: q.priceListId,
    lines: q.lines.map((l) => toLineItem(l)),
    totals: totalsOf(q, q.lines),
    notes: q.notes,
    terms: q.terms,
    share: shareState(q),
    acceptedAt: iso(q.acceptedAt),
    rejectedAt: iso(q.rejectedAt),
    statusReason: q.statusReason,
  };
}

// ---------------------------------------------------------------- invoices

export function isOverdue(inv: { status: string; dueDate: Date | null }, today: string): boolean {
  return (inv.status === 'issued' || inv.status === 'partially_paid') && !!inv.dueDate && dateOnly(inv.dueDate)! < today;
}

export function toInvoiceListItem(i: InvoiceListRow, today: string): InvoiceListItem {
  const total = num(i.totalPaise);
  const paid = num(i.paidPaise);
  return {
    id: i.id,
    number: i.number,
    status: i.status,
    issueDate: dateOnly(i.issueDate)!,
    dueDate: dateOnly(i.dueDate),
    buyerName: i.buyerName,
    ...refs(i),
    quotationId: i.quotationId,
    taxMode: taxModeOf(i.taxMode),
    totalPaise: total,
    paidPaise: paid,
    balancePaise: i.status === 'cancelled' ? 0 : Math.max(0, total - paid),
    overdue: isOverdue(i, today),
    issuedAt: iso(i.issuedAt),
    version: i.version,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

export function toPayment(p: InvoiceDetailRow['payments'][number], recordedBy: Payment['recordedBy'] = null): Payment {
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    amountPaise: num(p.amountPaise),
    paidOn: dateOnly(p.paidOn)!,
    mode: p.mode,
    reference: p.reference,
    note: p.note,
    recordedBy,
    createdAt: p.createdAt.toISOString(),
  };
}

export function toInvoice(i: InvoiceDetailRow, today: string, recorders: ReadonlyMap<string, Payment['recordedBy']> = new Map()): Invoice {
  return {
    ...toInvoiceListItem(i, today),
    seller: parseSeller(i.seller),
    buyer: parseParty(i.buyer),
    placeOfSupplyStateCode: i.placeOfSupply,
    priceListId: i.priceListId,
    lines: i.lines.map((l) => toLineItem(l)),
    totals: totalsOf(i, i.lines),
    notes: i.notes,
    terms: i.terms,
    share: shareState(i),
    payments: i.payments.map((p) => toPayment(p, p.recordedById ? (recorders.get(p.recordedById) ?? null) : null)),
    cancelledAt: iso(i.cancelledAt),
    cancelReason: i.cancelReason,
  };
}

const INVOICE_LIST_KEYS = Object.keys(InvoiceListItemSchema.shape) as Array<keyof InvoiceListItem>;
/** The list-item part of an invoice DTO (events). */
export const invoiceListItemOf = (dto: Invoice): InvoiceListItem => Object.fromEntries(INVOICE_LIST_KEYS.map((k) => [k, dto[k]])) as InvoiceListItem;
