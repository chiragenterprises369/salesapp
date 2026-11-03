import { Injectable, Logger } from '@nestjs/common';
import {
  addBillingCycle,
  computeDocument,
  financialYearOf,
  formatDocumentNumber,
  formatPaise,
  PLATFORM_DEFAULT_GST_RATE,
  PLATFORM_DEFAULT_SAC,
  SellerProfileSchema,
  SETTING_KEYS,
  type BillingCycle,
  type GstRate,
  type LineItem,
  type Page,
  type PaymentMode,
  type Plan,
  type PlatformBillingProfile,
  type PlatformInvoice,
  type PlatformInvoiceKind,
  type PlatformInvoiceLine,
  type PlatformInvoiceLineInput,
  type PlatformInvoiceListItem,
  type PlatformInvoiceStatus,
  type PlatformPayment,
  type PlatformPaymentStatus,
} from '@vistar/shared';
import { randomUUID } from 'node:crypto';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Prisma, PlatformInvoice as InvoiceRow, PlatformPayment as PaymentRow, Subscription as SubscriptionRow } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { afterTimeCursor, nextTimeCursor } from '../leads/lib/cursor.js';
import { renderDocumentPdf } from '../documents/pdf/document-pdf.js';
import { BillingCoreService, type BillingTx } from './billing-core.service.js';
import { BillingProfileService } from './billing-profile.service.js';
import { addDays, buyerParty, emptySeller, istToday, n, parseContact, readStored, toDbDate, toInvoice, toInvoiceListItem, toPayment, toSubscription, type StoredInvoiceJson } from './billing.mapper.js';

export interface InvoiceSpec {
  kind: PlatformInvoiceKind;
  lines: PlatformInvoiceLineInput[];
  plan?: Plan | null;
  cycle?: BillingCycle | null;
  extraSeats?: number | null;
  /** Service period billed (subscription) or the period a paid plan change starts (plan_change). */
  periodStart?: Date | null;
  periodEnd?: Date | null;
  issueDate?: string;
  dueDate?: string | null;
  placeOfSupplyStateCode?: string | null;
  notes?: string | null;
  createdById?: string | null;
}

export interface PaymentSpec {
  provider: 'razorpay' | 'mock' | 'manual';
  mode?: PaymentMode | null;
  reference?: string | null;
  paidOn?: string;
  note?: string | null;
  clientPaymentId?: string;
  recordedById?: string | null;
}

type InvoiceWithPayments = InvoiceRow & { payments: PaymentRow[] };

/**
 * Invoices from Vistar to companies (D-072): GST with gst.ts (seller = Vistar profile state, place of supply =
 * the company's billing contact state), numbers VST/<FY>/<seq> across all companies (PlatformInvoiceSeries,
 * atomic INSERT ... ON CONFLICT ... RETURNING inside the issuing transaction), seller and buyer frozen at issue,
 * A4 PDF with the CRM document template. Paying an invoice applies a paid upgrade and clears past due.
 */
@Injectable()
export class PlatformInvoicesService {
  private readonly logger = new Logger(PlatformInvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: BillingCoreService,
    private readonly profiles: BillingProfileService,
  ) {}

  // ---------------------------------------------------------------- build

  /** Computed lines and totals. Not GST registered (no Vistar GSTIN) = 0 % lines, like CRM documents. */
  compute(lines: PlatformInvoiceLineInput[], profile: PlatformBillingProfile | null, placeOfSupply: string | null): StoredInvoiceJson & { taxMode: 'intra' | 'inter' } {
    const registered = !!profile?.gstin;
    const inputs = lines.map((l) => ({
      name: l.name,
      description: l.description ?? null,
      sacCode: l.sacCode ?? profile?.sacCode ?? PLATFORM_DEFAULT_SAC,
      quantity: l.quantity ?? 1,
      unitPricePaise: l.unitPricePaise,
      gstRate: (registered ? (l.gstRate ?? profile?.gstRate ?? PLATFORM_DEFAULT_GST_RATE) : 0) as GstRate,
      discountKind: 'percent' as const,
      discountValue: 0,
      hsnSac: l.sacCode ?? profile?.sacCode ?? PLATFORM_DEFAULT_SAC,
    }));
    const { lines: computed, totals } = computeDocument(inputs, { sellerStateCode: profile?.address.stateCode ?? null, placeOfSupplyStateCode: placeOfSupply });
    const out: PlatformInvoiceLine[] = computed.map((l) => ({
      name: l.name,
      description: l.description,
      sacCode: l.sacCode,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      gstRate: l.gstRate,
      taxablePaise: l.taxablePaise,
      cgstPaise: l.cgstPaise,
      sgstPaise: l.sgstPaise,
      igstPaise: l.igstPaise,
      totalPaise: l.totalPaise,
    }));
    return { lines: out, totals, taxMode: totals.taxMode };
  }

  /** Who Vistar bills: billing contact, else the company's own seller profile, else the workspace name. */
  async buyerOf(workspaceId: string, sub: SubscriptionRow | null) {
    const contact = sub ? parseContact(sub.billingContact) : null;
    const [ws, sellerRow] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
      contact ? Promise.resolve(null) : this.prisma.forTenant(workspaceId).setting.findFirst({ where: { scope: 'workspace', scopeId: workspaceId, key: SETTING_KEYS.workspace.sellerProfile }, select: { value: true } }),
    ]);
    const seller = sellerRow ? SellerProfileSchema.safeParse(sellerRow.value) : null;
    return buyerParty(contact, seller?.success ? seller.data : null, ws?.name ?? 'Company');
  }

  private async allocate(tx: BillingTx, issueDate: string, prefix: string): Promise<{ number: string; financialYear: string; sequence: number }> {
    const fy = financialYearOf(issueDate);
    const rows = await tx.$queryRaw<Array<{ seq: number; prefix: string }>>`
      INSERT INTO "PlatformInvoiceSeries" ("id", "financialYear", "prefix", "nextNumber", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${fy}, ${prefix}, 2, now(), now())
      ON CONFLICT ("financialYear")
      DO UPDATE SET "nextNumber" = "PlatformInvoiceSeries"."nextNumber" + 1, "prefix" = EXCLUDED."prefix", "updatedAt" = now()
      RETURNING ("nextNumber" - 1)::int AS seq, "prefix"`;
    const row = rows[0];
    if (!row) throw new AppException('INTERNAL_ERROR', 'Could not number the invoice');
    return { number: formatDocumentNumber(row.prefix, fy, row.seq), financialYear: fy, sequence: row.seq };
  }

  /**
   * Create an invoice; `issue` numbers it, freezes seller and buyer and needs the Vistar profile. Runs in the given
   * transaction (or its own). Returns the row; the caller publishes and notifies after commit (`afterIssue`).
   */
  async create(workspaceId: string, spec: InvoiceSpec, issue: boolean, tx?: BillingTx): Promise<InvoiceRow> {
    const run = async (t: BillingTx) => {
      const profile = issue ? await this.profiles.require() : await this.profiles.load();
      const sub = await t.subscription.findUnique({ where: { workspaceId } });
      const buyer = await this.buyerOf(workspaceId, sub);
      const placeOfSupply = spec.placeOfSupplyStateCode ?? buyer.shippingAddress?.stateCode ?? buyer.billingAddress?.stateCode ?? (buyer.gstin ? buyer.gstin.slice(0, 2) : null) ?? profile?.address.stateCode ?? null;
      const built = this.compute(spec.lines, profile, placeOfSupply);
      const issueDate = spec.issueDate ?? istToday();
      const dueDate = spec.dueDate === undefined ? addDays(issueDate, profile?.paymentTermsDays ?? 7) : spec.dueDate;
      const numbering = issue ? await this.allocate(t, issueDate, profile!.invoicePrefix) : null;
      const t0 = built.totals;
      return t.platformInvoice.create({
        data: {
          workspaceId,
          number: numbering?.number ?? null,
          financialYear: numbering?.financialYear ?? null,
          sequence: numbering?.sequence ?? null,
          kind: spec.kind,
          status: issue ? 'issued' : 'draft',
          plan: spec.plan ?? null,
          cycle: spec.cycle ?? null,
          extraSeats: spec.extraSeats ?? null,
          periodStart: spec.periodStart ?? null,
          periodEnd: spec.periodEnd ?? null,
          issueDate: toDbDate(issueDate),
          dueDate: dueDate ? toDbDate(dueDate) : null,
          seller: issue && profile ? (BillingProfileService.snapshot(profile) as unknown as Prisma.InputJsonObject) : undefined,
          buyer: buyer as unknown as Prisma.InputJsonObject,
          buyerName: buyer.name,
          placeOfSupply,
          taxMode: built.taxMode,
          lines: { lines: built.lines, totals: t0 } as unknown as Prisma.InputJsonObject,
          subtotalPaise: BigInt(t0.subtotalPaise),
          discountPaise: BigInt(t0.discountPaise),
          taxablePaise: BigInt(t0.taxablePaise),
          cgstPaise: BigInt(t0.cgstPaise),
          sgstPaise: BigInt(t0.sgstPaise),
          igstPaise: BigInt(t0.igstPaise),
          roundOffPaise: BigInt(t0.roundOffPaise),
          totalPaise: BigInt(t0.totalPaise),
          notes: spec.notes ?? null,
          issuedAt: issue ? new Date() : null,
          createdById: spec.createdById ?? null,
        },
      });
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /** Issue a draft: recompute with the current profile and buyer, number it, freeze both parties. */
  async issueDraft(invoiceId: string, dueDate: string | null | undefined): Promise<InvoiceRow> {
    const profile = await this.profiles.require();
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.platformInvoice.findUnique({ where: { id: invoiceId } });
      if (!draft) throw notFound('Invoice');
      if (draft.status !== 'draft') throw new AppException('DOCUMENT_STATE_INVALID', 'Only drafts can be issued');
      const sub = await tx.subscription.findUnique({ where: { workspaceId: draft.workspaceId } });
      const buyer = await this.buyerOf(draft.workspaceId, sub);
      const stored = readStored(draft);
      const built = this.compute(
        stored.lines.map((l) => ({ name: l.name, description: l.description, sacCode: l.sacCode, quantity: l.quantity, unitPricePaise: l.unitPricePaise, gstRate: l.gstRate })),
        profile,
        draft.placeOfSupply,
      );
      const issueDate = istToday() > (draft.issueDate.toISOString().slice(0, 10)) ? istToday() : draft.issueDate.toISOString().slice(0, 10);
      const numbering = await this.allocate(tx, issueDate, profile.invoicePrefix);
      const t0 = built.totals;
      const { count } = await tx.platformInvoice.updateMany({
        where: { id: invoiceId, status: 'draft' },
        data: {
          status: 'issued',
          number: numbering.number,
          financialYear: numbering.financialYear,
          sequence: numbering.sequence,
          issueDate: toDbDate(issueDate),
          dueDate: dueDate === undefined ? (draft.dueDate ?? toDbDate(addDays(issueDate, profile.paymentTermsDays))) : dueDate ? toDbDate(dueDate) : null,
          seller: BillingProfileService.snapshot(profile) as unknown as Prisma.InputJsonObject,
          buyer: buyer as unknown as Prisma.InputJsonObject,
          buyerName: buyer.name,
          taxMode: built.taxMode,
          lines: { lines: built.lines, totals: t0 } as unknown as Prisma.InputJsonObject,
          subtotalPaise: BigInt(t0.subtotalPaise),
          discountPaise: BigInt(t0.discountPaise),
          taxablePaise: BigInt(t0.taxablePaise),
          cgstPaise: BigInt(t0.cgstPaise),
          sgstPaise: BigInt(t0.sgstPaise),
          igstPaise: BigInt(t0.igstPaise),
          roundOffPaise: BigInt(t0.roundOffPaise),
          totalPaise: BigInt(t0.totalPaise),
          issuedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (count !== 1) throw new AppException('DOCUMENT_STATE_INVALID', 'Only drafts can be issued');
      return tx.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    });
  }

  /** After commit: event to the company and `billing_invoice_issued` to its billing admins. */
  async afterIssue(row: InvoiceRow): Promise<void> {
    const name = await this.core.companyName(row.workspaceId);
    await this.core.publish('billing.invoice_updated', row.workspaceId, { invoice: toInvoiceListItem(row, name) });
    const due = row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null;
    await this.core.notifyAdmins(row.workspaceId, {
      type: 'billing_invoice_issued',
      title: `New Vistar invoice ${row.number ?? ''}`.trim(),
      body: `${formatPaise(n(row.totalPaise))}${due ? `, due ${due.split('-').reverse().join('-')}` : ''}`,
      path: `/billing?invoice=${row.id}`,
      data: { invoiceId: row.id, number: row.number },
    });
  }

  // ---------------------------------------------------------------- payments

  /**
   * Mark the invoice paid with a captured payment (provider checkout or a manual payment) and apply the side effects
   * on the subscription: a paid plan_change applies the plan; any paid invoice clears past due when nothing else is
   * overdue; a cancelled subscription paying its invoice comes back on that plan. Idempotent: paying a paid
   * invoice returns it unchanged.
   */
  async markPaid(tx: BillingTx, invoiceId: string, spec: PaymentSpec, existingPayment?: PaymentRow): Promise<{ invoice: InvoiceRow; subscription: SubscriptionRow; changed: boolean }> {
    const invoice = await tx.platformInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw notFound('Invoice');
    const sub0 = await tx.subscription.findUnique({ where: { workspaceId: invoice.workspaceId } });
    const sub = sub0 ?? (await this.core.ensure(invoice.workspaceId));
    if (invoice.status === 'paid') return { invoice, subscription: sub, changed: false };
    if (invoice.status !== 'issued') throw new AppException('DOCUMENT_STATE_INVALID', invoice.status === 'draft' ? 'Issue the invoice before recording a payment' : 'This invoice is cancelled');
    const balance = n(invoice.totalPaise) - n(invoice.paidPaise);
    const now = new Date();
    const paidOn = spec.paidOn ?? istToday(now);
    if (existingPayment) {
      await tx.platformPayment.update({ where: { id: existingPayment.id }, data: { status: 'captured', paidOn: toDbDate(paidOn), failureReason: null } });
    } else {
      await tx.platformPayment.create({
        data: {
          workspaceId: invoice.workspaceId,
          invoiceId,
          amountPaise: BigInt(balance),
          status: 'captured',
          provider: spec.provider,
          mode: spec.mode ?? null,
          reference: spec.reference ?? null,
          note: spec.note ?? null,
          paidOn: toDbDate(paidOn),
          clientPaymentId: spec.clientPaymentId ?? null,
          recordedById: spec.recordedById ?? null,
        },
      });
    }
    const { count } = await tx.platformInvoice.updateMany({ where: { id: invoiceId, status: 'issued' }, data: { status: 'paid', paidPaise: invoice.totalPaise, paidAt: now, version: { increment: 1 } } });
    if (count !== 1) {
      const again = await tx.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      return { invoice: again, subscription: sub, changed: false };
    }
    const paid = await tx.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const stillOverdue = await tx.platformInvoice.count({ where: { workspaceId: invoice.workspaceId, status: 'issued', id: { not: invoiceId }, dueDate: { lt: toDbDate(istToday(now)) } } });
    let next = sub;
    if (invoice.kind === 'plan_change' && invoice.plan) {
      const cycle = invoice.cycle ?? sub.cycle;
      const start = invoice.periodStart ?? now;
      const end = invoice.periodEnd ?? addBillingCycle(start, cycle);
      next = await this.core.apply(tx, sub, {
        plan: invoice.plan,
        cycle,
        extraSeats: invoice.extraSeats ?? sub.extraSeats,
        status: stillOverdue ? 'past_due' : 'active',
        periodStart: start,
        periodEnd: end,
        trialEndsAt: null,
        pendingPlan: null,
        pendingCycle: null,
        cancelledAt: null,
        ...(stillOverdue ? {} : { pastDueSince: null, dunningStep: 0 }),
      });
      await tx.planChangeRequest.updateMany({ where: { workspaceId: invoice.workspaceId, status: 'pending' }, data: { status: 'cancelled', decisionNote: 'Upgraded through checkout', decidedAt: now } });
    } else if (sub.status === 'cancelled' && invoice.plan && invoice.kind === 'subscription') {
      const cycle = invoice.cycle ?? sub.cycle;
      next = await this.core.apply(tx, sub, { plan: invoice.plan, cycle, status: stillOverdue ? 'past_due' : 'active', periodStart: now, periodEnd: addBillingCycle(now, cycle), cancelledAt: null, pastDueSince: stillOverdue ? sub.pastDueSince : null, dunningStep: 0 });
    } else if (sub.status === 'past_due' && !stillOverdue) {
      next = await this.core.apply(tx, sub, { status: 'active', pastDueSince: null, dunningStep: 0 });
    }
    return { invoice: paid, subscription: next, changed: true };
  }

  /** After a payment commit: invoice and subscription events. */
  async afterPaid(invoice: InvoiceRow, subscription: SubscriptionRow): Promise<void> {
    const name = await this.core.companyName(invoice.workspaceId);
    await this.core.publish('billing.invoice_updated', invoice.workspaceId, { invoice: toInvoiceListItem(invoice, name) });
    await this.core.publish('billing.subscription_updated', invoice.workspaceId, { subscription: toSubscription(subscription, await this.core.plan(subscription.plan)) });
  }

  async cancel(invoiceId: string, reason: string): Promise<InvoiceRow> {
    const invoice = await this.prisma.platformInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw notFound('Invoice');
    if (invoice.status === 'paid') throw new AppException('DOCUMENT_STATE_INVALID', 'A paid invoice cannot be cancelled');
    if (invoice.status === 'cancelled') return invoice;
    const { count } = await this.prisma.platformInvoice.updateMany({ where: { id: invoiceId, status: { in: ['draft', 'issued'] } }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } } });
    if (count !== 1) throw new AppException('DOCUMENT_STATE_INVALID', 'The invoice changed meanwhile. Reload it');
    await this.prisma.platformPayment.updateMany({ where: { invoiceId, status: 'created' }, data: { status: 'failed', failureReason: 'Invoice cancelled' } });
    const row = await this.prisma.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    // an open checkout for a cancelled upgrade is dropped; a past-due subscription may be in good standing now
    const sub = await this.prisma.subscription.findUnique({ where: { workspaceId: row.workspaceId } });
    if (sub?.status === 'past_due') {
      const overdue = await this.prisma.platformInvoice.count({ where: { workspaceId: row.workspaceId, status: 'issued', dueDate: { lt: toDbDate(istToday()) } } });
      if (!overdue) {
        const next = await this.prisma.$transaction((tx) => this.core.apply(tx, sub, { status: 'active', pastDueSince: null, dunningStep: 0 }));
        await this.core.publish('billing.subscription_updated', row.workspaceId, { subscription: toSubscription(next, await this.core.plan(next.plan)) });
      }
    }
    if (row.status !== 'draft') await this.core.publish('billing.invoice_updated', row.workspaceId, { invoice: toInvoiceListItem(row, await this.core.companyName(row.workspaceId)) });
    return row;
  }

  // ---------------------------------------------------------------- reads

  private async names(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.workspace.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Company view (no drafts) when `workspaceId` is set, Super Admin view across companies otherwise. */
  async list(q: { workspaceId?: string; cursor?: string; limit: number; status?: PlatformInvoiceStatus; kind?: PlatformInvoiceKind; overdue?: boolean }, companyView: boolean): Promise<Page<PlatformInvoiceListItem>> {
    const today = toDbDate(istToday());
    const and: Prisma.PlatformInvoiceWhereInput[] = [];
    if (q.workspaceId) and.push({ workspaceId: q.workspaceId });
    if (companyView) and.push({ status: { not: 'draft' } });
    if (q.status) and.push({ status: q.status });
    if (q.kind) and.push({ kind: q.kind });
    if (q.overdue) and.push({ status: 'issued', dueDate: { lt: today } });
    const after = afterTimeCursor(q.cursor);
    if (Object.keys(after).length) and.push(after as Prisma.PlatformInvoiceWhereInput);
    const rows = await this.prisma.platformInvoice.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
    const names = await this.names(rows.map((r) => r.workspaceId));
    return { items: rows.slice(0, q.limit).map((r) => toInvoiceListItem(r, names.get(r.workspaceId) ?? 'Company')), nextCursor: nextTimeCursor(rows, q.limit) };
  }

  async row(id: string, workspaceId: string | null, companyView: boolean): Promise<InvoiceWithPayments> {
    const row = await this.prisma.platformInvoice.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}), ...(companyView ? { status: { not: 'draft' } } : {}) }, include: { payments: true } });
    if (!row) throw notFound('Invoice');
    return row;
  }

  async get(id: string, workspaceId: string | null, companyView: boolean): Promise<PlatformInvoice> {
    return this.present(await this.row(id, workspaceId, companyView));
  }

  async present(row: InvoiceWithPayments | InvoiceRow): Promise<PlatformInvoice> {
    const withPayments = 'payments' in row ? row : { ...row, payments: await this.prisma.platformPayment.findMany({ where: { invoiceId: row.id } }) };
    const profile = await this.profiles.load();
    return toInvoice(withPayments, await this.core.companyName(row.workspaceId), profile ? BillingProfileService.snapshot(profile) : null);
  }

  async payments(workspaceId: string, q: { cursor?: string; limit: number; status?: PlatformPaymentStatus }): Promise<Page<PlatformPayment>> {
    const and: Prisma.PlatformPaymentWhereInput[] = [{ workspaceId }];
    if (q.status) and.push({ status: q.status });
    const after = afterTimeCursor(q.cursor);
    if (Object.keys(after).length) and.push(after as Prisma.PlatformPaymentWhereInput);
    const rows = await this.prisma.platformPayment.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, include: { invoice: { select: { number: true } } } });
    return { items: rows.slice(0, q.limit).map((p) => toPayment(p, p.invoice.number)), nextCursor: nextTimeCursor(rows, q.limit) };
  }

  // ---------------------------------------------------------------- PDF

  async pdf(id: string, workspaceId: string | null, companyView: boolean): Promise<{ buffer: Buffer; fileName: string }> {
    const invoice = await this.get(id, workspaceId, companyView);
    const profile = await this.profiles.load();
    const lines: LineItem[] = invoice.lines.map((l, i) => ({
      id: randomUUID(),
      position: i,
      productId: null,
      name: l.name,
      description: l.description,
      hsnSac: l.sacCode,
      unit: 'NOS',
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      discountKind: 'percent',
      discountValue: 0,
      gstRate: l.gstRate,
      grossPaise: l.taxablePaise,
      discountPaise: 0,
      taxablePaise: l.taxablePaise,
      cgstPaise: l.cgstPaise,
      sgstPaise: l.sgstPaise,
      igstPaise: l.igstPaise,
      totalPaise: l.totalPaise,
    }));
    const period = invoice.periodStart && invoice.periodEnd ? `Service period ${invoice.periodStart.split('-').reverse().join('-')} to ${invoice.periodEnd.split('-').reverse().join('-')}.` : null;
    const buffer = renderDocumentPdf({
      kind: 'invoice',
      number: invoice.number,
      status: invoice.status === 'cancelled' ? 'cancelled' : invoice.status,
      issueDate: invoice.issueDate,
      validUntil: null,
      dueDate: invoice.dueDate,
      seller: invoice.status === 'draft' ? (profile ? BillingProfileService.snapshot(profile) : emptySeller()) : invoice.seller,
      workspaceName: 'Vistar',
      buyer: invoice.buyer,
      placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
      lines,
      totals: invoice.totals,
      notes: [period, invoice.notes].filter(Boolean).join('\n') || null,
      terms: profile?.invoiceTerms ?? null,
      payments: invoice.payments
        .filter((p) => p.status === 'captured')
        .map((p) => ({ id: p.id, invoiceId: p.invoiceId, amountPaise: p.amountPaise, paidOn: p.paidOn ?? invoice.issueDate, mode: p.mode ?? (p.provider === 'manual' ? 'other' : 'card'), reference: p.reference ?? p.providerPaymentId, note: p.note, recordedBy: null, createdAt: p.createdAt })),
      paidPaise: invoice.paidPaise,
      balancePaise: invoice.balancePaise,
      brandColor: profile?.brandColor ?? '#4F46E5',
      logo: null,
    });
    return { buffer, fileName: `${(invoice.number ?? `draft-${invoice.id.slice(0, 8)}`).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf` };
  }
}
