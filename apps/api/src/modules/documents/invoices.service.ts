import { Injectable, Logger } from '@nestjs/common';
import type {
  DocumentShare,
  DocumentShareCreate,
  Invoice,
  InvoiceCancel,
  InvoiceCreate,
  InvoiceIssue,
  InvoiceListItem,
  InvoiceListQuery,
  InvoiceSendResult,
  InvoiceUpdate,
  Page,
  PaymentCreate,
  UserSummary,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { lineRow } from '../catalog/line-resolver.js';
import { isUniqueViolation, sortBy } from '../crm/lib/db.js';
import { and, ownerScope, pageArgs, pageOut } from '../crm/lib/paging.js';
import { num, toDateCol } from '../crm/lib/values.js';
import { publishSafe, requestActor, requirePermission, type TenantDb } from '../leads/lib/context.js';
import { DocumentCoreService, type ComputedDocument } from './document-core.service.js';
import { INVOICE_DETAIL_INCLUDE, INVOICE_LIST_INCLUDE, invoiceListItemOf, parseParty, toInvoice, toInvoiceListItem, toPayment, type InvoiceDetailRow } from './documents.mapper.js';
import { SellerProfileService, snapshotOf } from './seller-profile.service.js';

const stateInvalid = (message: string) => new AppException('DOCUMENT_STATE_INVALID', message);
const versionConflict = () => new AppException('VERSION_CONFLICT', 'Someone else changed this invoice. Reload to see the latest version.');

function totalsData(c: ComputedDocument) {
  const t = c.totals;
  return {
    placeOfSupply: c.placeOfSupply,
    taxMode: t.taxMode,
    subtotalPaise: BigInt(t.subtotalPaise),
    discountPaise: BigInt(t.discountPaise),
    taxablePaise: BigInt(t.taxablePaise),
    cgstPaise: BigInt(t.cgstPaise),
    sgstPaise: BigInt(t.sgstPaise),
    igstPaise: BigInt(t.igstPaise),
    roundOffPaise: BigInt(t.roundOffPaise),
    totalPaise: BigInt(t.totalPaise),
  };
}

const lineInputs = (lines: InvoiceDetailRow['lines']) =>
  lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    description: l.description,
    hsnSac: l.hsnSac,
    unit: l.unit as never,
    quantity: num(l.quantity),
    unitPricePaise: num(l.unitPricePaise),
    discountKind: (l.discountKind === 'amount' ? 'amount' : 'percent') as 'amount' | 'percent',
    discountValue: num(l.discountValue),
    gstRate: l.gstRate as never,
  }));

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly core: DocumentCoreService,
    private readonly seller: SellerProfileService,
  ) {}

  async visibleWhere(auth: AuthContext): Promise<Prisma.InvoiceWhereInput> {
    return and<Prisma.InvoiceWhereInput>({ deletedAt: null }, await ownerScope(this.scope, auth));
  }

  async loadVisible(db: TenantDb, auth: AuthContext, id: string): Promise<InvoiceDetailRow> {
    const row = await db.invoice.findFirst({ where: { AND: [{ id }, await this.visibleWhere(auth)] }, include: INVOICE_DETAIL_INCLUDE });
    if (!row) throw notFound('Invoice');
    return row;
  }

  /** Invoice DTO with the names of the people who recorded payments. */
  async present(db: TenantDb, workspaceId: string, row: InvoiceDetailRow): Promise<Invoice> {
    const ids = [...new Set(row.payments.map((p) => p.recordedById).filter((x): x is string => !!x))];
    const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: USER_SUMMARY_SELECT }) : [];
    const recorders = new Map<string, UserSummary | null>(users.map((u) => [u.id, toUserSummary(u)]));
    return toInvoice(row, await this.core.today(workspaceId), recorders);
  }

  private async reload(db: TenantDb, workspaceId: string, id: string): Promise<{ row: InvoiceDetailRow; dto: Invoice }> {
    const row = await db.invoice.findUniqueOrThrow({ where: { id }, include: INVOICE_DETAIL_INCLUDE });
    return { row, dto: await this.present(db, workspaceId, row) };
  }

  private async publish(auth: AuthContext, type: 'invoice.created' | 'invoice.updated', dto: Invoice, changed: string[] = []): Promise<void> {
    const actor = await requestActor(this.prisma.forTenant(auth.workspaceId), auth);
    const invoice = invoiceListItemOf(dto);
    if (type === 'invoice.created') await publishSafe(this.events, this.logger, type, auth.workspaceId, { invoice }, { actor: actor.event });
    else await publishSafe(this.events, this.logger, type, auth.workspaceId, { invoice, changed }, { actor: actor.event });
  }

  private async owner(db: TenantDb, auth: AuthContext, ownerId: string | null | undefined, current: string | null): Promise<string | null> {
    if (ownerId === undefined) return current ?? auth.userId;
    if (ownerId === current) return current;
    if (ownerId !== auth.userId) requirePermission(auth, 'leads.assign', 'You cannot assign invoices to other users');
    if (ownerId && (await db.user.count({ where: { id: ownerId, isActive: true, deletedAt: null } })) !== 1) throw notFound('User');
    return ownerId;
  }

  // ---------------------------------------------------------------- list, get

  async list(auth: AuthContext, q: InvoiceListQuery): Promise<Page<InvoiceListItem> & { total: number }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const today = await this.core.today(wid);
    const text = q.q?.trim();
    const owners = q.ownerId?.map((o) => (o === 'me' ? auth.userId : o)).filter((o): o is string => !!o);
    const where = and<Prisma.InvoiceWhereInput>(
      await this.visibleWhere(auth),
      q.status?.length ? { status: { in: q.status } } : null,
      owners?.length ? { ownerId: { in: owners } } : null,
      q.accountId ? { companyId: q.accountId } : null,
      q.contactId ? { contactId: q.contactId } : null,
      q.dealId ? { dealId: q.dealId } : null,
      q.leadId ? { leadId: q.leadId } : null,
      q.quotationId ? { quotationId: q.quotationId } : null,
      q.issuedFrom || q.issuedTo ? { issueDate: { ...(q.issuedFrom ? { gte: toDateCol(q.issuedFrom) } : {}), ...(q.issuedTo ? { lte: toDateCol(q.issuedTo) } : {}) } } : null,
      q.overdue === true ? { status: { in: ['issued', 'partially_paid'] }, dueDate: { lt: toDateCol(today) } } : null,
      q.overdue === false ? { NOT: { status: { in: ['issued', 'partially_paid'] }, dueDate: { lt: toDateCol(today) } } } : null,
      text ? { OR: [{ number: { contains: text, mode: 'insensitive' } }, { buyerName: { contains: text, mode: 'insensitive' } }] } : null,
    );
    const { skip, take } = pageArgs(q.cursor, q.limit);
    const [rows, total] = await Promise.all([
      db.invoice.findMany({ where, orderBy: sortBy<Prisma.InvoiceOrderByWithRelationInput[]>(q.sort, q.dir, ['dueDate', 'number']), skip, take, include: INVOICE_LIST_INCLUDE }),
      db.invoice.count({ where }),
    ]);
    const page = pageOut(rows, skip, q.limit);
    return { items: page.rows.map((r) => toInvoiceListItem(r, today)), nextCursor: page.nextCursor, total };
  }

  async get(auth: AuthContext, id: string): Promise<Invoice> {
    const db = this.prisma.forTenant(auth.workspaceId);
    return this.present(db, auth.workspaceId, await this.loadVisible(db, auth, id));
  }

  // ---------------------------------------------------------------- create, update, delete

  async create(auth: AuthContext, body: InvoiceCreate, opts: { quotationId?: string } = {}): Promise<Invoice> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const profile = await this.seller.load(wid);
    const ownerId = await this.owner(db, auth, body.ownerId, null);
    const b = await this.core.buyer(db, { accountId: body.accountId, contactId: body.contactId, leadId: body.leadId, dealId: body.dealId }, body.buyer);
    const priceListId = body.priceListId !== undefined ? body.priceListId : await this.core.defaultPriceList(db);
    if (priceListId && !(await db.priceList.count({ where: { id: priceListId } }))) throw notFound('Price list');
    const pos = this.core.placeOfSupply(b.party, body.placeOfSupplyStateCode, profile);
    const computed = await this.core.compute(db, body.lines, priceListId ?? null, profile, pos);
    const issueDate = body.issueDate ?? (await this.core.today(wid));
    const dueDate = body.dueDate !== undefined ? body.dueDate : DocumentCoreService.addDays(issueDate, profile?.paymentTermsDays ?? 15);
    const id = await db.$transaction(async (tx) => {
      const row = await tx.invoice.create({
        data: {
          workspaceId: wid,
          issueDate: toDateCol(issueDate),
          dueDate: dueDate ? toDateCol(dueDate) : null,
          ownerId,
          companyId: b.companyId,
          contactId: b.contactId,
          leadId: b.leadId,
          dealId: b.dealId,
          quotationId: opts.quotationId ?? null,
          priceListId: priceListId ?? null,
          buyerName: b.party.name,
          buyer: b.party as unknown as Prisma.InputJsonObject,
          seller: profile ? (snapshotOf(profile) as unknown as Prisma.InputJsonObject) : undefined,
          notes: body.notes ?? null,
          terms: body.terms !== undefined ? body.terms : (profile?.invoiceTerms ?? null),
          createdById: auth.userId,
          ...totalsData(computed),
        },
        select: { id: true },
      });
      await tx.invoiceLine.createMany({ data: computed.lines.map((l) => ({ ...lineRow(wid, l), invoiceId: row.id })) });
      return row.id;
    });
    const { dto } = await this.reload(db, wid, id);
    await this.publish(auth, 'invoice.created', dto);
    return dto;
  }

  async update(auth: AuthContext, id: string, body: InvoiceUpdate): Promise<Invoice> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const current = await this.loadVisible(db, auth, id);
    if (current.status !== 'draft') throw stateInvalid('Issued invoices cannot be edited. Cancel it and make a new one.');
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) throw versionConflict();
    const profile = await this.seller.load(wid);
    const ownerId = await this.owner(db, auth, body.ownerId, current.ownerId);
    const pick = <T>(v: T | undefined, cur: T): T => (v === undefined ? cur : v);
    const linksChanged = body.accountId !== undefined || body.contactId !== undefined || body.leadId !== undefined || body.dealId !== undefined;
    const b = await this.core.buyer(
      db,
      { accountId: pick(body.accountId, current.companyId), contactId: pick(body.contactId, current.contactId), leadId: pick(body.leadId, current.leadId), dealId: pick(body.dealId, current.dealId) },
      body.buyer ?? (linksChanged ? undefined : parseParty(current.buyer)),
    );
    const priceListId = pick(body.priceListId, current.priceListId);
    const pos = this.core.placeOfSupply(b.party, body.placeOfSupplyStateCode !== undefined ? body.placeOfSupplyStateCode : body.buyer || linksChanged ? null : current.placeOfSupply, profile);
    const computed = await this.core.compute(db, body.lines ?? lineInputs(current.lines), priceListId, profile, pos);
    await db.$transaction(async (tx) => {
      const res = await tx.invoice.updateMany({
        where: { id, version: current.version, status: 'draft', deletedAt: null },
        data: {
          ...(body.issueDate !== undefined ? { issueDate: toDateCol(body.issueDate) } : {}),
          ...(body.dueDate !== undefined ? { dueDate: body.dueDate ? toDateCol(body.dueDate) : null } : {}),
          ownerId,
          companyId: b.companyId,
          contactId: b.contactId,
          leadId: b.leadId,
          dealId: b.dealId,
          priceListId,
          buyerName: b.party.name,
          buyer: b.party as unknown as Prisma.InputJsonObject,
          ...(profile ? { seller: snapshotOf(profile) as unknown as Prisma.InputJsonObject } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.terms !== undefined ? { terms: body.terms } : {}),
          ...totalsData(computed),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw versionConflict();
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceLine.createMany({ data: computed.lines.map((l) => ({ ...lineRow(wid, l), invoiceId: id })) });
    });
    const { dto } = await this.reload(db, wid, id);
    await this.publish(auth, 'invoice.updated', dto, Object.keys(body).filter((k) => k !== 'expectedVersion'));
    return dto;
  }

  async remove(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const inv = await this.loadVisible(db, auth, id);
    if (inv.status !== 'draft') throw stateInvalid('Issued invoices are cancelled, never deleted');
    await db.invoice.updateMany({ where: { id, status: 'draft', deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'invoice.delete', entityType: 'invoice', entityId: id, diff: { totalPaise: num(inv.totalPaise), buyerName: inv.buyerName } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'invoice.deleted', wid, { invoiceIds: [id] }, { actor: actor.event });
    return { ok: true };
  }

  // ---------------------------------------------------------------- issue, cancel

  async issue(auth: AuthContext, req: Request | null, id: string, body: InvoiceIssue = {}): Promise<Invoice> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const inv = await this.loadVisible(db, auth, id);
    if (inv.status !== 'draft') throw stateInvalid('This invoice is already issued');
    if (body.expectedVersion !== undefined && body.expectedVersion !== inv.version) throw versionConflict();
    const profile = await this.seller.require(wid);
    const today = await this.core.today(wid);
    const draftDate = inv.issueDate.toISOString().slice(0, 10);
    const issueDate = body.issueDate ?? (draftDate < today ? today : draftDate);
    // Recompute with the final seller profile (state code and GST registration decide the tax split).
    const party = parseParty(inv.buyer);
    const computed = await this.core.compute(db, lineInputs(inv.lines), inv.priceListId, profile, inv.placeOfSupply ?? this.core.placeOfSupply(party, null, profile));
    let number = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        number = await db.$transaction(async (tx) => {
          const n = await this.core.allocateNumber(tx, wid, 'invoice', issueDate, profile.invoicePrefix);
          const res = await tx.invoice.updateMany({
            where: { id, status: 'draft', version: inv.version, deletedAt: null },
            data: {
              status: 'issued',
              number: n.number,
              financialYear: n.financialYear,
              sequence: n.sequence,
              issueDate: toDateCol(issueDate),
              issuedAt: new Date(),
              seller: snapshotOf(profile) as unknown as Prisma.InputJsonObject,
              ...totalsData(computed),
              version: { increment: 1 },
            },
          });
          if (res.count !== 1) throw versionConflict();
          await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
          await tx.invoiceLine.createMany({ data: computed.lines.map((l) => ({ ...lineRow(wid, l), invoiceId: id })) });
          return n.number;
        });
        break;
      } catch (err) {
        // a number typed by hand elsewhere can collide once; take the next one
        if (!isUniqueViolation(err) || attempt === 2) throw err;
      }
    }
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'invoice.issue', entityType: 'invoice', entityId: id, diff: { number, totalPaise: computed.totals.totalPaise } }, actor.summary?.name);
    const { dto } = await this.reload(db, wid, id);
    await this.publish(auth, 'invoice.updated', dto, ['status', 'number']);
    return dto;
  }

  async cancel(auth: AuthContext, req: Request, id: string, body: InvoiceCancel): Promise<Invoice> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const inv = await this.loadVisible(db, auth, id);
    if (inv.status !== 'issued' && inv.status !== 'partially_paid') throw stateInvalid(inv.status === 'draft' ? 'Delete the draft instead' : `A ${inv.status.replace('_', ' ')} invoice cannot be cancelled`);
    await db.invoice.updateMany({ where: { id, version: inv.version }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: body.reason, shareTokenHash: null, shareExpiresAt: null, version: { increment: 1 } } });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'invoice.cancel', entityType: 'invoice', entityId: id, diff: { number: inv.number, reason: body.reason } }, actor.summary?.name);
    const { dto } = await this.reload(db, wid, id);
    await this.publish(auth, 'invoice.updated', dto, ['status']);
    return dto;
  }

  // ---------------------------------------------------------------- share

  private async createShare(db: TenantDb, workspaceId: string, row: InvoiceDetailRow, days: number): Promise<DocumentShare> {
    const { token, hash } = this.core.newShareToken();
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    await db.invoice.updateMany({ where: { id: row.id }, data: { shareTokenHash: hash, shareExpiresAt: expiresAt, sharedAt: new Date() } });
    const dto = toInvoice(row, await this.core.today(workspaceId));
    return this.core.shareOf(token, expiresAt, {
      kind: 'invoice',
      number: row.number,
      buyerName: row.buyerName,
      totalPaise: dto.balancePaise || dto.totalPaise,
      due: dto.dueDate,
      sellerName: dto.seller?.tradeName ?? dto.seller?.legalName ?? 'our team',
    });
  }

  async send(auth: AuthContext, req: Request, id: string, body: DocumentShareCreate): Promise<InvoiceSendResult> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    let inv = await this.loadVisible(db, auth, id);
    if (inv.status === 'cancelled') throw stateInvalid('A cancelled invoice cannot be sent');
    if (inv.status === 'draft') {
      await this.issue(auth, req, id);
      inv = await this.loadVisible(db, auth, id);
    }
    const share = await this.createShare(db, wid, inv, body.expiresInDays);
    const { dto } = await this.reload(db, wid, id);
    await this.publish(auth, 'invoice.updated', dto, ['share']);
    return { invoice: dto, share };
  }

  async share(auth: AuthContext, id: string, body: DocumentShareCreate): Promise<DocumentShare> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const inv = await this.loadVisible(db, auth, id);
    if (inv.status === 'draft' || inv.status === 'cancelled') throw stateInvalid('Issue the invoice before sharing a link');
    const share = await this.createShare(db, wid, inv, body.expiresInDays);
    await this.publish(auth, 'invoice.updated', (await this.reload(db, wid, id)).dto, ['share']);
    return share;
  }

  async revokeShare(auth: AuthContext, id: string): Promise<{ ok: true }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    await this.loadVisible(db, auth, id);
    await db.invoice.updateMany({ where: { id }, data: { shareTokenHash: null, shareExpiresAt: null } });
    await this.publish(auth, 'invoice.updated', (await this.reload(db, wid, id)).dto, ['share']);
    return { ok: true };
  }

  // ---------------------------------------------------------------- payments

  /** Paid sum and status from the not-voided payments (inside the caller's transaction). */
  private async settle(tx: TenantDb, id: string): Promise<void> {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, select: { totalPaise: true, status: true } });
    const agg = await tx.payment.aggregate({ where: { invoiceId: id, voidedAt: null }, _sum: { amountPaise: true }, _max: { createdAt: true } });
    const paid = agg._sum.amountPaise ?? 0n;
    const status = paid <= 0n ? 'issued' : paid >= inv.totalPaise ? 'paid' : 'partially_paid';
    await tx.invoice.update({ where: { id }, data: { paidPaise: paid, status, lastPaymentAt: agg._max.createdAt ?? null, version: { increment: 1 } } });
  }

  async addPayment(auth: AuthContext, id: string, body: PaymentCreate): Promise<Invoice> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const inv = await this.loadVisible(db, auth, id);
    if (body.clientPaymentId) {
      const dup = await db.payment.findFirst({ where: { invoiceId: id, clientPaymentId: body.clientPaymentId }, select: { id: true } });
      if (dup) return this.present(db, wid, inv);
    }
    if (inv.status !== 'issued' && inv.status !== 'partially_paid') throw stateInvalid(inv.status === 'paid' ? 'This invoice is already paid' : 'Issue the invoice before recording payments');
    const balance = num(inv.totalPaise) - num(inv.paidPaise);
    if (body.amountPaise > balance) throw new AppException('PAYMENT_EXCEEDS_BALANCE', 'The payment is more than the balance due', { details: [{ path: 'amountPaise', message: `At most ${balance}` }] });
    const paidOn = body.paidOn ?? (await this.core.today(wid));
    let paymentId: string;
    try {
      paymentId = await db.$transaction(async (tx) => {
        const p = await tx.payment.create({
          data: { workspaceId: wid, invoiceId: id, amountPaise: BigInt(body.amountPaise), paidOn: toDateCol(paidOn), mode: body.mode, reference: body.reference ?? null, note: body.note ?? null, clientPaymentId: body.clientPaymentId ?? null, recordedById: auth.userId },
          select: { id: true },
        });
        await this.settle(tx, id);
        return p.id;
      });
    } catch (err) {
      if (isUniqueViolation(err) && body.clientPaymentId) return this.get(auth, id);
      throw err;
    }
    const { row, dto } = await this.reload(db, wid, id);
    const payment = row.payments.find((p) => p.id === paymentId);
    const actor = await requestActor(db, auth);
    if (payment) {
      await publishSafe(this.events, this.logger, 'invoice.payment_recorded', wid, { invoice: invoiceListItemOf(dto), payment: toPayment(payment, actor.summary), voided: false }, { actor: actor.event });
    }
    await this.publish(auth, 'invoice.updated', dto, ['payments', 'status']);
    return dto;
  }

  async voidPayment(auth: AuthContext, req: Request, id: string, paymentId: string): Promise<Invoice> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const inv = await this.loadVisible(db, auth, id);
    if (inv.status === 'cancelled') throw stateInvalid('The invoice is cancelled');
    const payment = await db.payment.findFirst({ where: { id: paymentId, invoiceId: id, voidedAt: null } });
    if (!payment) throw notFound('Payment');
    await db.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidedById: auth.userId } });
      await this.settle(tx, id);
    });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'invoice.payment_void', entityType: 'invoice', entityId: id, diff: { paymentId, amountPaise: num(payment.amountPaise), mode: payment.mode } }, actor.summary?.name);
    const { dto } = await this.reload(db, wid, id);
    await publishSafe(this.events, this.logger, 'invoice.payment_recorded', wid, { invoice: invoiceListItemOf(dto), payment: toPayment(payment as InvoiceDetailRow['payments'][number], null), voided: true }, { actor: actor.event });
    await this.publish(auth, 'invoice.updated', dto, ['payments', 'status']);
    return dto;
  }

  // ---------------------------------------------------------------- PDF

  async pdf(auth: AuthContext, id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    return this.pdfOf(auth.workspaceId, await this.loadVisible(db, auth, id));
  }

  async pdfOf(workspaceId: string, row: InvoiceDetailRow): Promise<{ buffer: Buffer; fileName: string }> {
    const inv = toInvoice(row, await this.core.today(workspaceId));
    const seller = inv.seller ?? (await this.seller.load(workspaceId).then((p) => (p ? snapshotOf(p) : null)));
    const buffer = await this.core.pdf(workspaceId, {
      kind: 'invoice',
      number: inv.number,
      status: inv.status,
      issueDate: inv.issueDate,
      validUntil: null,
      dueDate: inv.dueDate,
      seller,
      buyer: inv.buyer,
      placeOfSupplyStateCode: inv.placeOfSupplyStateCode,
      lines: inv.lines,
      totals: inv.totals,
      notes: inv.notes,
      terms: inv.terms,
      payments: inv.payments,
      paidPaise: inv.paidPaise,
      balancePaise: inv.balancePaise,
    });
    return { buffer, fileName: `${(inv.number ?? `draft-${inv.id.slice(0, 8)}`).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf` };
  }
}
