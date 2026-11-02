import { Injectable } from '@nestjs/common';
import type { PublicDocument } from '@vistar/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { BrandingService } from '../workspace/branding.service.js';
import { DocumentCoreService, hashToken } from './document-core.service.js';
import { INVOICE_DETAIL_INCLUDE, QUOTATION_DETAIL_INCLUDE, toInvoice, toQuotation } from './documents.mapper.js';
import { InvoicesService } from './invoices.service.js';
import { QuotationsService } from './quotations.service.js';

const expired = () => new AppException('SHARE_LINK_EXPIRED', 'This link has expired. Ask the sender for a new one.');

/**
 * Share links (no sign-in). The token is looked up by its SHA-256; unknown, rotated, revoked and expired
 * tokens all answer 410 so a link never reveals whether a document exists. Drafts and deleted documents
 * are never served.
 */
@Injectable()
export class PublicDocumentsService {
  private readonly env = getEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: BrandingService,
    private readonly core: DocumentCoreService,
    private readonly quotations: QuotationsService,
    private readonly invoices: InvoicesService,
  ) {}

  private async find(token: string) {
    const hash = hashToken(token);
    const now = new Date();
    // Root client on purpose: the token decides the workspace. Everything after this goes through forTenant().
    const [q, i] = await Promise.all([
      this.prisma.quotation.findFirst({ where: { shareTokenHash: hash, deletedAt: null }, select: { id: true, workspaceId: true, shareExpiresAt: true, status: true } }),
      this.prisma.invoice.findFirst({ where: { shareTokenHash: hash, deletedAt: null }, select: { id: true, workspaceId: true, shareExpiresAt: true, status: true } }),
    ]);
    const hit = q ? { kind: 'quotation' as const, ...q } : i ? { kind: 'invoice' as const, ...i } : null;
    if (!hit || !hit.shareExpiresAt || hit.shareExpiresAt <= now || hit.status === 'draft') throw expired();
    return { ...hit, shareExpiresAt: hit.shareExpiresAt };
  }

  async get(token: string): Promise<PublicDocument> {
    const hit = await this.find(token);
    const db = this.prisma.forTenant(hit.workspaceId);
    const [branding, ws] = await Promise.all([this.branding.get(db, hit.workspaceId), db.workspace.findFirst({ select: { name: true } })]);
    const pdfUrl = `${this.env.API_PUBLIC_URL.replace(/\/$/, '')}/api/v1/public/documents/${token}/pdf`;
    const common = { branding, workspaceName: branding.displayName ?? ws?.name ?? 'Vistar', pdfUrl, expiresAt: hit.shareExpiresAt.toISOString() };
    if (hit.kind === 'quotation') {
      const q = toQuotation(await db.quotation.findUniqueOrThrow({ where: { id: hit.id }, include: QUOTATION_DETAIL_INCLUDE }));
      return {
        kind: 'quotation',
        id: q.id,
        number: q.number,
        status: q.status,
        issueDate: q.issueDate,
        validUntil: q.validUntil,
        dueDate: null,
        seller: q.seller,
        buyer: q.buyer,
        placeOfSupplyStateCode: q.placeOfSupplyStateCode,
        lines: q.lines,
        totals: q.totals,
        paidPaise: null,
        balancePaise: null,
        notes: q.notes,
        terms: q.terms,
        ...common,
      };
    }
    const inv = toInvoice(await db.invoice.findUniqueOrThrow({ where: { id: hit.id }, include: INVOICE_DETAIL_INCLUDE }), await this.core.today(hit.workspaceId));
    return {
      kind: 'invoice',
      id: inv.id,
      number: inv.number,
      status: inv.status,
      issueDate: inv.issueDate,
      validUntil: null,
      dueDate: inv.dueDate,
      seller: inv.seller,
      buyer: inv.buyer,
      placeOfSupplyStateCode: inv.placeOfSupplyStateCode,
      lines: inv.lines,
      totals: inv.totals,
      paidPaise: inv.paidPaise,
      balancePaise: inv.balancePaise,
      notes: inv.notes,
      terms: inv.terms,
      ...common,
    };
  }

  async pdf(token: string): Promise<{ buffer: Buffer; fileName: string }> {
    const hit = await this.find(token);
    const db = this.prisma.forTenant(hit.workspaceId);
    if (hit.kind === 'quotation') return this.quotations.pdfOf(hit.workspaceId, await db.quotation.findUniqueOrThrow({ where: { id: hit.id }, include: QUOTATION_DETAIL_INCLUDE }));
    return this.invoices.pdfOf(hit.workspaceId, await db.invoice.findUniqueOrThrow({ where: { id: hit.id }, include: INVOICE_DETAIL_INCLUDE }));
  }
}
