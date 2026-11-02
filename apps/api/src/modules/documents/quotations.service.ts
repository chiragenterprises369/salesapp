import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  QUOTATION_TRANSITIONS,
  type DocumentShare,
  type DocumentShareCreate,
  type Invoice,
  type LineItemInput,
  type Page,
  type Quotation,
  type QuotationCreate,
  type QuotationListItem,
  type QuotationListQuery,
  type QuotationSendResult,
  type QuotationStatusChange,
  type QuotationUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { lineRow } from '../catalog/line-resolver.js';
import { sortBy } from '../crm/lib/db.js';
import { and, ownerScope, pageArgs, pageOut } from '../crm/lib/paging.js';
import { num, toDateCol } from '../crm/lib/values.js';
import { publishSafe, requestActor, requirePermission, SYSTEM_ACTOR, type TenantDb } from '../leads/lib/context.js';
import { DocumentCoreService, type ComputedDocument } from './document-core.service.js';
import { QUOTATION_DETAIL_INCLUDE, QUOTATION_LIST_INCLUDE, toQuotation, toQuotationListItem, type QuotationDetailRow } from './documents.mapper.js';
import { InvoicesService } from './invoices.service.js';
import { SellerProfileService, snapshotOf } from './seller-profile.service.js';

const stateInvalid = (message: string) => new AppException('DOCUMENT_STATE_INVALID', message);
const versionConflict = () => new AppException('VERSION_CONFLICT', 'Someone else changed this quotation. Reload to see the latest version.');

export function totalsData(c: ComputedDocument) {
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

/** Line inputs from stored lines (duplicate, convert). */
export function storedLineInputs(lines: QuotationDetailRow['lines']): LineItemInput[] {
  return lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    description: l.description,
    hsnSac: l.hsnSac,
    unit: l.unit as LineItemInput['unit'],
    quantity: num(l.quantity),
    unitPricePaise: num(l.unitPricePaise),
    discountKind: l.discountKind === 'amount' ? 'amount' : 'percent',
    discountValue: num(l.discountValue),
    gstRate: l.gstRate as LineItemInput['gstRate'],
  }));
}

@Injectable()
export class QuotationsService {
  private readonly logger = new Logger(QuotationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly core: DocumentCoreService,
    private readonly seller: SellerProfileService,
    private readonly invoices: InvoicesService,
  ) {}

  async visibleWhere(auth: AuthContext): Promise<Prisma.QuotationWhereInput> {
    return and<Prisma.QuotationWhereInput>({ deletedAt: null }, await ownerScope(this.scope, auth));
  }

  async loadVisible(db: TenantDb, auth: AuthContext, id: string): Promise<QuotationDetailRow> {
    const row = await db.quotation.findFirst({ where: { AND: [{ id }, await this.visibleWhere(auth)] }, include: QUOTATION_DETAIL_INCLUDE });
    if (!row) throw notFound('Quotation');
    return row;
  }

  private async publish(auth: AuthContext, type: 'quotation.created' | 'quotation.updated', row: QuotationDetailRow, changed: string[] = []): Promise<void> {
    const actor = await requestActor(this.prisma.forTenant(auth.workspaceId), auth);
    const quotation = toQuotationListItem(row);
    if (type === 'quotation.created') await publishSafe(this.events, this.logger, type, auth.workspaceId, { quotation }, { actor: actor.event });
    else await publishSafe(this.events, this.logger, type, auth.workspaceId, { quotation, changed }, { actor: actor.event });
  }

  private async owner(db: TenantDb, auth: AuthContext, ownerId: string | null | undefined, current: string | null): Promise<string | null> {
    if (ownerId === undefined) return current ?? auth.userId;
    if (ownerId === current) return current;
    if (ownerId !== auth.userId) requirePermission(auth, 'leads.assign', 'You cannot assign quotations to other users');
    if (ownerId && (await db.user.count({ where: { id: ownerId, isActive: true, deletedAt: null } })) !== 1) throw notFound('User');
    return ownerId;
  }

  // ---------------------------------------------------------------- list, get

  async list(auth: AuthContext, q: QuotationListQuery): Promise<Page<QuotationListItem> & { total: number }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const text = q.q?.trim();
    const owners = q.ownerId?.map((o) => (o === 'me' ? auth.userId : o)).filter((o): o is string => !!o);
    const where = and<Prisma.QuotationWhereInput>(
      await this.visibleWhere(auth),
      q.status?.length ? { status: { in: q.status } } : null,
      owners?.length ? { ownerId: { in: owners } } : null,
      q.accountId ? { companyId: q.accountId } : null,
      q.contactId ? { contactId: q.contactId } : null,
      q.dealId ? { dealId: q.dealId } : null,
      q.leadId ? { leadId: q.leadId } : null,
      q.issuedFrom || q.issuedTo ? { issueDate: { ...(q.issuedFrom ? { gte: toDateCol(q.issuedFrom) } : {}), ...(q.issuedTo ? { lte: toDateCol(q.issuedTo) } : {}) } } : null,
      text ? { OR: [{ number: { contains: text, mode: 'insensitive' } }, { buyerName: { contains: text, mode: 'insensitive' } }] } : null,
    );
    const { skip, take } = pageArgs(q.cursor, q.limit);
    const [rows, total] = await Promise.all([
      db.quotation.findMany({ where, orderBy: sortBy<Prisma.QuotationOrderByWithRelationInput[]>(q.sort, q.dir), skip, take, include: QUOTATION_LIST_INCLUDE }),
      db.quotation.count({ where }),
    ]);
    const page = pageOut(rows, skip, q.limit);
    return { items: page.rows.map(toQuotationListItem), nextCursor: page.nextCursor, total };
  }

  async get(auth: AuthContext, id: string): Promise<Quotation> {
    const db = this.prisma.forTenant(auth.workspaceId);
    return toQuotation(await this.loadVisible(db, auth, id));
  }

  // ---------------------------------------------------------------- create, update, delete

  async create(auth: AuthContext, body: QuotationCreate): Promise<Quotation> {
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
    const validUntil = body.validUntil !== undefined ? body.validUntil : DocumentCoreService.addDays(issueDate, profile?.quotationValidityDays ?? 15);
    const id = await db.$transaction(async (tx) => {
      const n = await this.core.allocateNumber(tx, wid, 'quotation', issueDate, profile?.quotationPrefix ?? 'QT');
      const row = await tx.quotation.create({
        data: {
          workspaceId: wid,
          number: n.number,
          financialYear: n.financialYear,
          sequence: n.sequence,
          issueDate: toDateCol(issueDate),
          validUntil: validUntil ? toDateCol(validUntil) : null,
          ownerId,
          companyId: b.companyId,
          contactId: b.contactId,
          leadId: b.leadId,
          dealId: b.dealId,
          priceListId: priceListId ?? null,
          buyerName: b.party.name,
          buyer: b.party as unknown as Prisma.InputJsonObject,
          seller: profile ? (snapshotOf(profile) as unknown as Prisma.InputJsonObject) : undefined,
          notes: body.notes ?? null,
          terms: body.terms !== undefined ? body.terms : (profile?.quotationTerms ?? null),
          createdById: auth.userId,
          ...totalsData(computed),
        },
        select: { id: true },
      });
      await tx.quotationLine.createMany({ data: computed.lines.map((l) => ({ ...lineRow(wid, l), quotationId: row.id })) });
      return row.id;
    });
    const row = await db.quotation.findUniqueOrThrow({ where: { id }, include: QUOTATION_DETAIL_INCLUDE });
    await this.publish(auth, 'quotation.created', row);
    return toQuotation(row);
  }

  async update(auth: AuthContext, id: string, body: QuotationUpdate): Promise<Quotation> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const current = await this.loadVisible(db, auth, id);
    if (current.status !== 'draft') throw stateInvalid('Only draft quotations can be edited. Reopen it as a draft first.');
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) throw versionConflict();
    const profile = await this.seller.load(wid);
    const ownerId = await this.owner(db, auth, body.ownerId, current.ownerId);
    const pick = <T>(v: T | undefined, cur: T): T => (v === undefined ? cur : v);
    const refs = { accountId: pick(body.accountId, current.companyId), contactId: pick(body.contactId, current.contactId), leadId: pick(body.leadId, current.leadId), dealId: pick(body.dealId, current.dealId) };
    const linksChanged = body.accountId !== undefined || body.contactId !== undefined || body.leadId !== undefined || body.dealId !== undefined;
    const b = await this.core.buyer(db, refs, body.buyer ?? (linksChanged ? undefined : toQuotation(current).buyer));
    const priceListId = pick(body.priceListId, current.priceListId);
    const pos = this.core.placeOfSupply(b.party, body.placeOfSupplyStateCode !== undefined ? body.placeOfSupplyStateCode : body.buyer || linksChanged ? null : current.placeOfSupply, profile);
    const lines = body.lines ?? storedLineInputs(current.lines);
    const computed = await this.core.compute(db, lines, priceListId, profile, pos);
    const issueDate = body.issueDate ?? current.issueDate.toISOString().slice(0, 10);
    await db.$transaction(async (tx) => {
      const res = await tx.quotation.updateMany({
        where: { id, version: current.version, status: 'draft', deletedAt: null },
        data: {
          issueDate: toDateCol(issueDate),
          ...(body.validUntil !== undefined ? { validUntil: body.validUntil ? toDateCol(body.validUntil) : null } : {}),
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
      await tx.quotationLine.deleteMany({ where: { quotationId: id } });
      await tx.quotationLine.createMany({ data: computed.lines.map((l) => ({ ...lineRow(wid, l), quotationId: id })) });
    });
    const row = await db.quotation.findUniqueOrThrow({ where: { id }, include: QUOTATION_DETAIL_INCLUDE });
    await this.publish(auth, 'quotation.updated', row, Object.keys(body).filter((k) => k !== 'expectedVersion'));
    return toQuotation(row);
  }

  async remove(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const q = await this.loadVisible(db, auth, id);
    if (q.status !== 'draft') throw stateInvalid('Only draft quotations can be deleted. Mark it rejected instead.');
    await db.quotation.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), shareTokenHash: null, version: { increment: 1 } } });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'quotation.delete', entityType: 'quotation', entityId: id, diff: { number: q.number, totalPaise: num(q.totalPaise) } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'quotation.deleted', wid, { quotationIds: [id] }, { actor: actor.event });
    return { ok: true };
  }

  // ---------------------------------------------------------------- status, send, share

  async changeStatus(auth: AuthContext, id: string, body: QuotationStatusChange): Promise<Quotation> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const q = await this.loadVisible(db, auth, id);
    if (body.expectedVersion !== undefined && body.expectedVersion !== q.version) throw versionConflict();
    if (q.status === body.status) return toQuotation(q);
    if (!QUOTATION_TRANSITIONS[q.status].includes(body.status)) throw stateInvalid(`A ${q.status} quotation cannot become ${body.status}`);
    const now = new Date();
    const data: Prisma.QuotationUncheckedUpdateManyInput = { status: body.status, statusReason: body.reason ?? null };
    if (body.status === 'sent') {
      requirePermission(auth, 'quotations.send', 'You cannot send quotations');
      const profile = await this.seller.require(wid);
      Object.assign(data, { sentAt: now, seller: snapshotOf(profile) as unknown as Prisma.InputJsonObject });
    }
    if (body.status === 'accepted') data.acceptedAt = now;
    if (body.status === 'rejected') data.rejectedAt = now;
    if (body.status === 'draft') Object.assign(data, { acceptedAt: null, rejectedAt: null, shareTokenHash: null, shareExpiresAt: null });
    const res = await db.quotation.updateMany({ where: { id, version: q.version, deletedAt: null }, data: { ...data, version: { increment: 1 } } });
    if (res.count !== 1) throw versionConflict();
    const row = await db.quotation.findUniqueOrThrow({ where: { id }, include: QUOTATION_DETAIL_INCLUDE });
    await this.publish(auth, 'quotation.updated', row, ['status']);
    return toQuotation(row);
  }

  private async createShare(db: TenantDb, row: QuotationDetailRow, days: number): Promise<DocumentShare> {
    const { token, hash } = this.core.newShareToken();
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    await db.quotation.updateMany({ where: { id: row.id }, data: { shareTokenHash: hash, shareExpiresAt: expiresAt, sharedAt: new Date() } });
    const seller = toQuotation(row).seller;
    return this.core.shareOf(token, expiresAt, {
      kind: 'quotation',
      number: row.number,
      buyerName: row.buyerName,
      totalPaise: num(row.totalPaise),
      due: row.validUntil ? row.validUntil.toISOString().slice(0, 10) : null,
      sellerName: seller?.tradeName ?? seller?.legalName ?? 'our team',
    });
  }

  async send(auth: AuthContext, id: string, body: DocumentShareCreate): Promise<QuotationSendResult> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const q = await this.loadVisible(db, auth, id);
    if (q.status === 'rejected') throw stateInvalid('This quotation was rejected. Reopen it as a draft to revise and send it again.');
    if (q.status === 'draft' || q.status === 'expired') {
      const profile = await this.seller.require(wid);
      await db.quotation.updateMany({ where: { id, deletedAt: null }, data: { status: 'sent', sentAt: new Date(), seller: snapshotOf(profile) as unknown as Prisma.InputJsonObject, version: { increment: 1 } } });
    }
    const fresh = await db.quotation.findUniqueOrThrow({ where: { id }, include: QUOTATION_DETAIL_INCLUDE });
    const share = await this.createShare(db, fresh, body.expiresInDays);
    const row = await db.quotation.findUniqueOrThrow({ where: { id }, include: QUOTATION_DETAIL_INCLUDE });
    await this.publish(auth, 'quotation.updated', row, q.status === 'draft' || q.status === 'expired' ? ['status', 'share'] : ['share']);
    return { quotation: toQuotation(row), share };
  }

  async share(auth: AuthContext, id: string, body: DocumentShareCreate): Promise<DocumentShare> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const q = await this.loadVisible(db, auth, id);
    if (q.status === 'draft') throw stateInvalid('Send the quotation before sharing a link');
    const share = await this.createShare(db, q, body.expiresInDays);
    await this.publish(auth, 'quotation.updated', await db.quotation.findUniqueOrThrow({ where: { id }, include: QUOTATION_DETAIL_INCLUDE }), ['share']);
    return share;
  }

  async revokeShare(auth: AuthContext, id: string): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    await this.loadVisible(db, auth, id);
    await db.quotation.updateMany({ where: { id }, data: { shareTokenHash: null, shareExpiresAt: null } });
    await this.publish(auth, 'quotation.updated', await db.quotation.findUniqueOrThrow({ where: { id }, include: QUOTATION_DETAIL_INCLUDE }), ['share']);
    return { ok: true };
  }

  // ---------------------------------------------------------------- PDF, convert, duplicate

  async pdf(auth: AuthContext, id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    return this.pdfOf(auth.workspaceId, await this.loadVisible(db, auth, id));
  }

  async pdfOf(workspaceId: string, row: QuotationDetailRow): Promise<{ buffer: Buffer; fileName: string }> {
    const q = toQuotation(row);
    const seller = q.seller ?? (await this.seller.load(workspaceId).then((p) => (p ? snapshotOf(p) : null)));
    const buffer = await this.core.pdf(workspaceId, {
      kind: 'quotation',
      number: q.number,
      status: q.status,
      issueDate: q.issueDate,
      validUntil: q.validUntil,
      dueDate: null,
      seller,
      buyer: q.buyer,
      placeOfSupplyStateCode: q.placeOfSupplyStateCode,
      lines: q.lines,
      totals: q.totals,
      notes: q.notes,
      terms: q.terms,
      payments: [],
      paidPaise: null,
      balancePaise: null,
    });
    return { buffer, fileName: `${q.number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf` };
  }

  /** Draft invoice from a sent or accepted quotation; idempotent (an existing, not cancelled invoice is returned). */
  async convert(auth: AuthContext, id: string): Promise<Invoice> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const q = await this.loadVisible(db, auth, id);
    const existing = await db.invoice.findFirst({ where: { quotationId: id, status: { not: 'cancelled' }, deletedAt: null }, select: { id: true } });
    if (existing) return this.invoices.get(auth, existing.id);
    if (q.status !== 'sent' && q.status !== 'accepted') throw stateInvalid('Only sent or accepted quotations can become an invoice');
    const invoice = await this.invoices.create(auth, {
      accountId: q.companyId,
      contactId: q.contactId,
      leadId: q.leadId,
      dealId: q.dealId,
      ownerId: q.ownerId,
      buyer: toQuotation(q).buyer,
      placeOfSupplyStateCode: q.placeOfSupply as QuotationCreate['placeOfSupplyStateCode'],
      priceListId: q.priceListId,
      lines: storedLineInputs(q.lines),
      notes: q.notes,
    }, { quotationId: q.id });
    if (q.status === 'sent') {
      await db.quotation.updateMany({ where: { id }, data: { status: 'accepted', acceptedAt: new Date(), version: { increment: 1 } } });
    }
    await this.publish(auth, 'quotation.updated', await db.quotation.findUniqueOrThrow({ where: { id }, include: QUOTATION_DETAIL_INCLUDE }), ['status', 'convertedInvoiceId']);
    return invoice;
  }

  async duplicate(auth: AuthContext, id: string): Promise<Quotation> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const q = await this.loadVisible(db, auth, id);
    return this.create(auth, {
      accountId: q.companyId,
      contactId: q.contactId,
      leadId: q.leadId,
      dealId: q.dealId,
      buyer: toQuotation(q).buyer,
      placeOfSupplyStateCode: q.placeOfSupply as QuotationCreate['placeOfSupplyStateCode'],
      priceListId: q.priceListId,
      lines: storedLineInputs(q.lines),
      notes: q.notes,
      terms: q.terms,
    });
  }

  // ---------------------------------------------------------------- expiry

  /** Every 30 minutes: sent quotations past validUntil become expired (one event per quotation). */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'quotation-expiry' })
  async expire(now = new Date()): Promise<number> {
    try {
      const today = toDateCol(now.toISOString().slice(0, 10));
      const due = await this.prisma.quotation.findMany({ where: { status: 'sent', validUntil: { lt: today }, deletedAt: null }, select: { id: true, workspaceId: true }, take: 500 });
      for (const d of due) {
        const db = this.prisma.forTenant(d.workspaceId);
        const res = await db.quotation.updateMany({ where: { id: d.id, status: 'sent' }, data: { status: 'expired', version: { increment: 1 } } });
        if (!res.count) continue;
        const row = await db.quotation.findUniqueOrThrow({ where: { id: d.id }, include: QUOTATION_LIST_INCLUDE });
        await publishSafe(this.events, this.logger, 'quotation.updated', d.workspaceId, { quotation: toQuotationListItem(row), changed: ['status'] }, { actor: SYSTEM_ACTOR });
      }
      return due.length;
    } catch (err) {
      this.logger.error(`Quotation expiry failed: ${(err as Error).name}`);
      return 0;
    }
  }
}
