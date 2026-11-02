import { Injectable } from '@nestjs/common';
import {
  documentHostedPath,
  financialYearOf,
  formatDocumentNumber,
  formatPaise,
  PartySchema,
  stateCodeFromGstin,
  stateCodeFromName,
  type DocumentShare,
  type LineItemInput,
  type Party,
  type SellerProfile,
} from '@vistar/shared';
import { createHash, randomBytes } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { computeLines, resolveLines, type ComputedLine } from '../catalog/line-resolver.js';
import { normalizeAddress, parseAddress } from '../crm/lib/values.js';
import type { TenantDb } from '../leads/lib/context.js';
import { localDateOf } from '../presence/engine/working-hours.js';
import { BrandingService } from '../workspace/branding.service.js';
import { StorageService } from '../storage/storage.service.js';
import { renderDocumentPdf, type DocumentPdfInput } from './pdf/document-pdf.js';
import { loadImage } from './pdf/pdf-writer.js';

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface BuyerRefs {
  accountId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  dealId?: string | null;
}

export interface ComputedDocument {
  lines: ComputedLine[];
  totals: ReturnType<typeof computeLines>['totals'];
  placeOfSupply: string | null;
}

/** Shared by quotations and invoices: buyer and place of supply, GST maths, numbering, share links, PDFs. */
@Injectable()
export class DocumentCoreService {
  private readonly env = getEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: BrandingService,
    private readonly storage: StorageService,
  ) {}

  /** Today (YYYY-MM-DD) in the workspace timezone. */
  async today(workspaceId: string): Promise<string> {
    const ws = await this.prisma.forTenant(workspaceId).workspace.findFirst({ select: { timezone: true } });
    return localDateOf(Date.now(), ws?.timezone ?? 'Asia/Kolkata');
  }

  static addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Links (account, contact, lead, deal) checked in the tenant; buyer = explicit details, else the
   * account (with the contact's name as attention), else the contact, else the lead.
   * The deal fills missing account and contact.
   */
  async buyer(db: TenantDb, refs: BuyerRefs, explicit?: Party): Promise<{ party: Party; companyId: string | null; contactId: string | null; leadId: string | null; dealId: string | null }> {
    let { accountId = null, contactId = null } = refs;
    const leadId = refs.leadId ?? null;
    const dealId = refs.dealId ?? null;
    if (dealId) {
      const deal = await db.deal.findFirst({ where: { id: dealId, deletedAt: null }, select: { companyId: true, contactId: true } });
      if (!deal) throw new AppException('NOT_FOUND', 'Deal not found');
      accountId ??= deal.companyId;
      contactId ??= deal.contactId;
    }
    const [account, contact, lead] = await Promise.all([
      accountId ? db.company.findFirst({ where: { id: accountId, deletedAt: null } }) : null,
      contactId ? db.contact.findFirst({ where: { id: contactId, deletedAt: null } }) : null,
      leadId ? db.lead.findFirst({ where: { id: leadId, deletedAt: null } }) : null,
    ]);
    if (accountId && !account) throw new AppException('NOT_FOUND', 'Account not found');
    if (contactId && !contact) throw new AppException('NOT_FOUND', 'Contact not found');
    if (leadId && !lead) throw new AppException('NOT_FOUND', 'Lead not found');
    let party: Party | null = explicit ? { ...explicit, billingAddress: normalizeAddress(explicit.billingAddress), shippingAddress: normalizeAddress(explicit.shippingAddress) } : null;
    if (!party && account) {
      party = PartySchema.parse({
        name: account.name,
        gstin: account.gstin,
        pan: account.pan,
        phone: account.phone ?? contact?.phone ?? null,
        email: account.email ?? contact?.email ?? null,
        billingAddress: parseAddress(account.billingAddress),
        shippingAddress: parseAddress(account.shippingAddress),
        contactName: contact?.name ?? null,
      });
    }
    if (!party && contact) {
      party = PartySchema.parse({ name: contact.name, gstin: contact.gstin, pan: contact.pan, phone: contact.phone, email: contact.email, billingAddress: parseAddress(contact.billingAddress), shippingAddress: parseAddress(contact.shippingAddress) });
    }
    if (!party && lead) {
      const stateCode = stateCodeFromName(lead.state);
      party = PartySchema.parse({
        name: lead.companyName ?? lead.name,
        phone: lead.phone,
        email: lead.email,
        contactName: lead.companyName ? lead.name : null,
        billingAddress: lead.city && stateCode ? { line1: lead.city, city: lead.city, stateCode } : null,
      });
    }
    if (!party) throw new AppException('VALIDATION_FAILED', 'Pick an account, a contact or a lead, or enter the buyer details', { details: [{ path: 'buyer', message: 'Required' }], status: 422 });
    return { party, companyId: account?.id ?? null, contactId: contact?.id ?? null, leadId: lead?.id ?? null, dealId };
  }

  /** Explicit > buyer shipping state > billing state > GSTIN state > seller state. */
  placeOfSupply(party: Party, explicit: string | null | undefined, seller: SellerProfile | null): string | null {
    return explicit ?? party.shippingAddress?.stateCode ?? party.billingAddress?.stateCode ?? stateCodeFromGstin(party.gstin) ?? seller?.address.stateCode ?? null;
  }

  async compute(db: TenantDb, inputs: readonly LineItemInput[], priceListId: string | null, seller: SellerProfile | null, placeOfSupply: string | null): Promise<ComputedDocument> {
    const resolved = await resolveLines(db, inputs, priceListId);
    // Not GST registered: no tax lines (rates kept on the lines for reference only).
    const lines = seller && !seller.gstin ? resolved.map((l) => ({ ...l, gstRate: 0 as const })) : resolved;
    const r = computeLines(lines, seller?.address.stateCode ?? null, placeOfSupply);
    return { ...r, placeOfSupply };
  }

  /** The default active price list (preselected when a document names none). */
  async defaultPriceList(db: TenantDb): Promise<string | null> {
    const p = await db.priceList.findFirst({ where: { isDefault: true, active: true }, select: { id: true } });
    return p?.id ?? null;
  }

  /**
   * Next number of a series (atomic INSERT ... ON CONFLICT ... RETURNING; runs inside the caller's
   * transaction so a rollback gives the number back).
   */
  async allocateNumber(tx: TenantDb, workspaceId: string, kind: 'quotation' | 'invoice', issueDate: string, prefix: string): Promise<{ number: string; financialYear: string; sequence: number }> {
    const fy = financialYearOf(issueDate);
    const rows = await tx.$queryRaw<Array<{ seq: number; prefix: string }>>`
      INSERT INTO "DocumentSeries" ("id", "workspaceId", "kind", "financialYear", "prefix", "nextNumber", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${workspaceId}::uuid, ${kind}, ${fy}, ${prefix}, 2, now(), now())
      ON CONFLICT ("workspaceId", "kind", "financialYear")
      DO UPDATE SET "nextNumber" = "DocumentSeries"."nextNumber" + 1, "prefix" = EXCLUDED."prefix", "updatedAt" = now()
      RETURNING ("nextNumber" - 1)::int AS seq, "prefix"`;
    const row = rows[0];
    if (!row) throw new AppException('INTERNAL_ERROR', 'Could not number the document');
    return { number: formatDocumentNumber(row.prefix, fy, row.seq), financialYear: fy, sequence: row.seq };
  }

  // ---------------------------------------------------------------- share links

  newShareToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: hashToken(token) };
  }

  shareOf(token: string, expiresAt: Date, d: { kind: 'quotation' | 'invoice'; number: string | null; buyerName: string; totalPaise: number; due: string | null; sellerName: string }): DocumentShare {
    const url = `${this.env.WEB_ORIGIN.replace(/\/$/, '')}${documentHostedPath(token)}`;
    const pdfUrl = `${this.env.API_PUBLIC_URL.replace(/\/$/, '')}/api/v1/public/documents/${token}/pdf`;
    const what = d.kind === 'quotation' ? 'quotation' : 'invoice';
    const when = d.due ? (d.kind === 'quotation' ? ` It is valid until ${d.due}.` : ` Payment is due by ${d.due}.`) : '';
    const message = `Dear ${d.buyerName}, please find our ${what} ${d.number ?? ''} for ${formatPaise(d.totalPaise)}: ${url}${when} Regards, ${d.sellerName}`.replace(/\s+/g, ' ');
    return { url, pdfUrl, expiresAt: expiresAt.toISOString(), message };
  }

  // ---------------------------------------------------------------- PDF

  async pdf(workspaceId: string, input: Omit<DocumentPdfInput, 'brandColor' | 'logo' | 'workspaceName'>): Promise<Buffer> {
    const db = this.prisma.forTenant(workspaceId);
    const [branding, ws] = await Promise.all([this.branding.get(db, workspaceId), db.workspace.findFirst({ select: { name: true } })]);
    let logo = null;
    const ref = branding.logoLight;
    if (ref && (ref.mime === 'image/png' || ref.mime === 'image/jpeg')) {
      const file = await db.file.findFirst({ where: { id: ref.fileId, deletedAt: null }, select: { key: true, driver: true } });
      const bytes = file ? await this.storage.readBuffer(file, 3 * 1024 * 1024) : null;
      logo = bytes ? loadImage(bytes) : null;
    }
    return renderDocumentPdf({ ...input, brandColor: branding.colors?.light ?? branding.brandColor, logo, workspaceName: branding.displayName ?? ws?.name ?? 'Vistar' });
  }
}
