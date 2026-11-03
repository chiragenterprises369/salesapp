import {
  BillingContactSchema,
  daysLeft,
  PartySchema,
  planPricePaise,
  SellerSnapshotSchema,
  type BillingContact,
  type DocumentTotals,
  type Party,
  type PlanChangeRequest,
  type PlanDefinition,
  type PlatformInvoice,
  type PlatformInvoiceKind,
  type PlatformInvoiceLine,
  type PlatformInvoiceListItem,
  type PlatformPayment,
  type SellerSnapshot,
  type Subscription,
  type UserSummary,
} from '@vistar/shared';
import { iso } from '../../common/mappers/user.mapper.js';
import type { PlanChangeRequest as RequestRow, PlatformInvoice as InvoiceRow, PlatformPayment as PaymentRow, Subscription as SubscriptionRow } from '../../generated/prisma/client.js';

/** Row -> contract mappers for billing (BigInt paise -> numbers, dates -> ISO). */

export const n = (v: bigint | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
export const dateOnly = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
/** Today in India (YYYY-MM-DD). */
export const istToday = (now: Date = new Date()): string => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
/** YYYY-MM-DD -> Date at UTC midnight (Prisma @db.Date). */
export const toDbDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
export const addDays = (s: string, days: number): string => new Date(toDbDate(s).getTime() + days * 86_400_000).toISOString().slice(0, 10);

export function parseContact(raw: unknown): BillingContact | null {
  const parsed = BillingContactSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function toSubscription(row: SubscriptionRow, plan: PlanDefinition, now: Date = new Date()): Subscription {
  const seatsIncluded = plan.limits.seats;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    plan: row.plan,
    planName: plan.name,
    status: row.status,
    cycle: row.cycle,
    seatsIncluded,
    extraSeats: row.extraSeats,
    seats: seatsIncluded === null ? null : seatsIncluded + row.extraSeats,
    pricePaise: planPricePaise(plan, row.cycle, row.extraSeats),
    currentPeriodStart: row.currentPeriodStart.toISOString(),
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    trialEndsAt: iso(row.trialEndsAt),
    trialDaysLeft: row.status === 'trialing' && row.trialEndsAt ? Math.max(0, daysLeft(row.trialEndsAt, now)) : null,
    pastDueSince: iso(row.pastDueSince),
    cancelledAt: iso(row.cancelledAt),
    scheduledChange: row.pendingPlan ? { plan: row.pendingPlan, cycle: row.pendingCycle ?? row.cycle, effectiveAt: row.currentPeriodEnd.toISOString() } : null,
    billingContact: parseContact(row.billingContact),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPayment(row: PaymentRow, invoiceNumber: string | null): PlatformPayment {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    invoiceId: row.invoiceId,
    invoiceNumber,
    amountPaise: n(row.amountPaise),
    status: row.status,
    provider: row.provider as PlatformPayment['provider'],
    mode: row.mode,
    providerOrderId: row.providerOrderId,
    providerPaymentId: row.providerPaymentId,
    reference: row.reference,
    note: row.note,
    paidOn: dateOnly(row.paidOn),
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toInvoiceListItem(row: InvoiceRow, companyName: string, today: string = istToday()): PlatformInvoiceListItem {
  const total = n(row.totalPaise);
  const paid = n(row.paidPaise);
  const due = dateOnly(row.dueDate);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyName,
    number: row.number,
    kind: row.kind as PlatformInvoiceKind,
    status: row.status,
    issueDate: dateOnly(row.issueDate)!,
    dueDate: due,
    plan: row.plan,
    cycle: row.cycle,
    periodStart: dateOnly(row.periodStart),
    periodEnd: dateOnly(row.periodEnd),
    taxMode: row.taxMode === 'inter' ? 'inter' : 'intra',
    totalPaise: total,
    paidPaise: paid,
    balancePaise: row.status === 'cancelled' ? 0 : Math.max(0, total - paid),
    overdue: row.status === 'issued' && !!due && due < today,
    issuedAt: iso(row.issuedAt),
    paidAt: iso(row.paidAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Stored JSON of PlatformInvoice.lines (computed lines) and of the totals summary. */
export interface StoredInvoiceJson {
  lines: PlatformInvoiceLine[];
  totals: DocumentTotals;
}

export function readStored(row: InvoiceRow): StoredInvoiceJson {
  const raw = row.lines as unknown as Partial<StoredInvoiceJson> | PlatformInvoiceLine[] | null;
  if (Array.isArray(raw)) return { lines: raw, totals: fallbackTotals(row) };
  return { lines: raw?.lines ?? [], totals: raw?.totals ?? fallbackTotals(row) };
}

function fallbackTotals(row: InvoiceRow): DocumentTotals {
  return {
    taxMode: row.taxMode === 'inter' ? 'inter' : 'intra',
    subtotalPaise: n(row.subtotalPaise),
    discountPaise: n(row.discountPaise),
    taxablePaise: n(row.taxablePaise),
    cgstPaise: n(row.cgstPaise),
    sgstPaise: n(row.sgstPaise),
    igstPaise: n(row.igstPaise),
    taxPaise: n(row.cgstPaise) + n(row.sgstPaise) + n(row.igstPaise),
    roundOffPaise: n(row.roundOffPaise),
    totalPaise: n(row.totalPaise),
    amountInWords: '',
    taxSummary: [],
  };
}

export function toInvoice(row: InvoiceRow & { payments: PaymentRow[] }, companyName: string, fallbackSeller: SellerSnapshot | null): PlatformInvoice {
  const stored = readStored(row);
  const seller = SellerSnapshotSchema.safeParse(row.seller);
  const buyer = PartySchema.safeParse(row.buyer);
  return {
    ...toInvoiceListItem(row, companyName),
    seller: seller.success ? seller.data : (fallbackSeller ?? emptySeller()),
    buyer: buyer.success ? buyer.data : PartySchema.parse({ name: row.buyerName || companyName }),
    placeOfSupplyStateCode: row.placeOfSupply,
    lines: stored.lines,
    totals: stored.totals,
    notes: row.notes,
    payments: row.payments
      .slice()
      .sort((a, b) => +b.createdAt - +a.createdAt)
      .map((p) => toPayment(p, row.number)),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
  };
}

/** Placeholder seller for drafts made before the Vistar billing profile exists (never issued like this). */
export function emptySeller(): SellerSnapshot {
  return SellerSnapshotSchema.parse({ legalName: 'Vistar', tradeName: null, gstin: null, pan: null, address: { line1: '-', city: '-', stateCode: '27' }, phone: null, email: null, website: null, bank: {}, signatureLabel: 'Authorised signatory' });
}

export function toRequest(row: RequestRow, companyName: string, requestedBy: UserSummary | null): PlanChangeRequest {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyName,
    fromPlan: row.fromPlan,
    toPlan: row.toPlan,
    cycle: row.cycle,
    status: row.status,
    note: row.note,
    requestedBy,
    decidedAt: iso(row.decidedAt),
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Buyer of a Vistar invoice: the billing contact, else the company's own seller profile, else the workspace name. */
export function buyerParty(contact: BillingContact | null, companySeller: { legalName: string; gstin: string | null; pan: string | null; address: Party['billingAddress']; phone: string | null; email: string | null } | null, workspaceName: string): Party {
  if (contact) {
    return PartySchema.parse({ name: contact.name, gstin: contact.gstin, phone: contact.phone, email: contact.email, billingAddress: contact.address });
  }
  if (companySeller) {
    return PartySchema.parse({ name: companySeller.legalName, gstin: companySeller.gstin, pan: companySeller.pan, phone: companySeller.phone, email: companySeller.email, billingAddress: companySeller.address });
  }
  return PartySchema.parse({ name: workspaceName });
}
