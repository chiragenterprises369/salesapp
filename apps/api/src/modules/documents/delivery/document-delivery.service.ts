import { Injectable, Logger } from '@nestjs/common';
import type { DocumentShare, Invoice, Quotation } from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthContext } from '../../../common/auth/auth-context.js';
import { AppException, notFound } from '../../../common/errors/app-exception.js';
import { USER_SUMMARY_SELECT } from '../../../common/mappers/user.mapper.js';
import { EventBus } from '../../../infra/events/event-bus.service.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { toE164 } from '../../calls/phone.js';
import { toConversation } from '../../conversations/conversations.service.js';
import { publishSafe, requestActor, type TenantDb } from '../../leads/lib/context.js';
import { WhatsappSender, whatsappTemplatePayload } from '../../whatsapp/whatsapp-sender.service.js';
import { BrandingService } from '../../workspace/branding.service.js';
import { InvoicesService } from '../invoices.service.js';
import { QuotationsService } from '../quotations.service.js';
import { defaultDocumentEmail, documentTemplateVars, type DocumentEmailVars } from './document-email.js';
import { DocumentMailer, type MailVia } from './mailers.js';

export type DocumentKind = 'quotation' | 'invoice';

/** Request body (shape of DocumentDeliverSchema, request P1 to CONFIG-API). */
export type DocumentDeliverInput =
  | { channel: 'email'; to: string[]; cc?: string[]; subject?: string; message?: string; attachPdf?: boolean; expiresInDays?: number }
  | { channel: 'whatsapp'; to?: string; templateId?: string; variables?: Record<string, string>; expiresInDays?: number };

export interface DocumentDeliveryOutcome {
  channel: 'email' | 'whatsapp';
  status: 'sent' | 'queued' | 'failed';
  via: MailVia | 'whatsapp_cloud' | 'mock';
  to: string[];
  messageId: string | null;
  conversationId: string | null;
  error: string | null;
  share: DocumentShare;
  sentAt: string;
}

/** Optional company template renderer (CONFIG-API template engine); null = use the built-in e-mail. */
export type CompanyEmailRenderer = (workspaceId: string, key: 'quotation_sent' | 'invoice_sent', vars: Record<string, string>) => Promise<{ subject: string; html: string; text: string } | null>;

const DOCUMENT_TEMPLATE_NAMES = (kind: DocumentKind) => ['document_share', `${kind}_share`, `${kind}_sent`];
const CONVERSATION_INCLUDE = {
  contact: { select: { id: true, name: true, phone: true, whatsappOptIn: true } },
  assignee: { select: USER_SUMMARY_SELECT },
} as const;

interface DocView {
  id: string;
  number: string;
  buyerName: string;
  buyerEmail: string | null;
  buyerPhone: string | null;
  totalPaise: number;
  due: string | null;
  leadId: string | null;
  contactId: string | null;
  accountId: string | null;
  sellerName: string;
  sellerEmail: string | null;
}

function viewOf(kind: DocumentKind, d: Quotation | Invoice): DocView {
  const seller = d.seller;
  const isInvoice = kind === 'invoice';
  const inv = d as Invoice;
  const q = d as Quotation;
  return {
    id: d.id,
    number: (isInvoice ? inv.number : q.number) ?? 'draft',
    buyerName: d.buyer.name,
    buyerEmail: d.buyer.email,
    buyerPhone: d.buyer.phone,
    totalPaise: isInvoice ? inv.balancePaise || inv.totalPaise : q.totalPaise,
    due: isInvoice ? inv.dueDate : q.validUntil,
    leadId: d.lead?.id ?? null,
    contactId: d.contact?.id ?? null,
    accountId: d.account?.id ?? null,
    sellerName: seller?.tradeName ?? seller?.legalName ?? 'our team',
    sellerEmail: seller?.email ?? null,
  };
}

/**
 * Send a quotation or an invoice to the customer (change #20, SPEC 30):
 *  - e-mail: the company template quotation_sent / invoice_sent (CONFIG-API engine, built-in default otherwise),
 *    the A4 PDF attached, the hosted link in the body, through the company SMTP integration or the platform mailer;
 *  - WhatsApp: an approved template (the chosen one, else one named document_share / <kind>_share / <kind>_sent) with
 *    the buyer name, the number, the link and the total, into the customer's conversation (opt-out refused).
 * A draft quotation is marked sent first and a draft invoice issued first (same rules as the send routes); every
 * delivery creates a fresh share link (the previous link stops working, as with "Send"). The result is recorded on
 * the lead timeline (or as a note on the contact or account) and in the audit log.
 */
@Injectable()
export class DocumentDeliveryService {
  private readonly logger = new Logger(DocumentDeliveryService.name);
  private renderer: CompanyEmailRenderer | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly quotations: QuotationsService,
    private readonly invoices: InvoicesService,
    private readonly mailer: DocumentMailer,
    private readonly whatsapp: WhatsappSender,
    private readonly branding: BrandingService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** The template engine registers its renderer (company templates with branding). */
  useRenderer(renderer: CompanyEmailRenderer | null): void {
    this.renderer = renderer;
  }

  async deliver(auth: AuthContext, req: Request, kind: DocumentKind, id: string, body: DocumentDeliverInput): Promise<DocumentDeliveryOutcome> {
    const expiresInDays = body.expiresInDays ?? 30;
    // WhatsApp needs a connection before anything changes (no sent quotation without a message)
    const wa = body.channel === 'whatsapp' ? await this.whatsapp.connection(auth.workspaceId) : null;
    const sent = kind === 'quotation' ? await this.quotations.send(auth, id, { expiresInDays }) : await this.invoices.send(auth, req, id, { expiresInDays });
    const doc = kind === 'quotation' ? (sent as { quotation: Quotation }).quotation : (sent as { invoice: Invoice }).invoice;
    const share = sent.share;
    const view = viewOf(kind, doc);
    const out = body.channel === 'email' ? await this.email(auth, kind, view, share, body) : await this.whatsappSend(auth, kind, view, share, body, wa!);
    await this.record(auth, req, kind, view, out);
    return out;
  }

  // ---------------------------------------------------------------- e-mail

  private async email(auth: AuthContext, kind: DocumentKind, d: DocView, share: DocumentShare, body: Extract<DocumentDeliverInput, { channel: 'email' }>): Promise<DocumentDeliveryOutcome> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const [me, brand] = await Promise.all([
      auth.userId ? db.user.findFirst({ where: { id: auth.userId }, select: { name: true, email: true } }) : Promise.resolve(null),
      this.branding.get(db, auth.workspaceId),
    ]);
    const vars: DocumentEmailVars = {
      kind,
      buyerName: d.buyerName,
      sellerName: brand.displayName ?? d.sellerName,
      number: d.number,
      totalPaise: d.totalPaise,
      due: d.due,
      link: share.url,
      pdfLink: share.pdfUrl,
      message: body.message?.trim() || null,
      senderName: me?.name ?? null,
      brandColor: brand.colors?.light ?? brand.brandColor ?? null,
    };
    const key = kind === 'quotation' ? 'quotation_sent' : 'invoice_sent';
    const custom = this.renderer ? await this.renderer(auth.workspaceId, key, documentTemplateVars(vars)).catch(() => null) : null;
    const rendered = custom ?? defaultDocumentEmail(vars);
    const subject = (body.subject?.trim() || rendered.subject).slice(0, 200);
    const attachments = [];
    if (body.attachPdf !== false) {
      const pdf = kind === 'quotation' ? await this.quotations.pdf(auth, d.id) : await this.invoices.pdf(auth, d.id);
      attachments.push({ filename: pdf.fileName, content: pdf.buffer, contentType: 'application/pdf' });
    }
    const to = [...new Set(body.to.map((e) => e.trim().toLowerCase()))];
    const cc = [...new Set((body.cc ?? []).map((e) => e.trim().toLowerCase()))].filter((e) => !to.includes(e));
    const replyTo = me?.email ?? d.sellerEmail ?? undefined;
    const sentAt = new Date().toISOString();
    try {
      const res = await this.mailer.send(auth.workspaceId, { to, cc, replyTo, subject, html: rendered.html, text: rendered.text, attachments });
      return { channel: 'email', status: 'sent', via: res.mock ? 'mock' : res.via, to: [...to, ...cc], messageId: res.messageId, conversationId: null, error: null, share, sentAt };
    } catch (err) {
      if (err instanceof AppException && err.code === 'INTEGRATION_PROVIDER_ERROR') {
        return { channel: 'email', status: 'failed', via: 'company_smtp', to: [...to, ...cc], messageId: null, conversationId: null, error: err.message, share, sentAt };
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------- WhatsApp

  private async whatsappSend(
    auth: AuthContext,
    kind: DocumentKind,
    d: DocView,
    share: DocumentShare,
    body: Extract<DocumentDeliverInput, { channel: 'whatsapp' }>,
    wa: Awaited<ReturnType<WhatsappSender['connection']>>,
  ): Promise<DocumentDeliveryOutcome> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const contact = d.contactId ? await db.contact.findFirst({ where: { id: d.contactId }, select: { id: true, phone: true } }) : null;
    const lead = d.leadId ? await db.lead.findFirst({ where: { id: d.leadId }, select: { phone: true } }) : null;
    const phone = toE164(body.to ?? contact?.phone ?? d.buyerPhone ?? lead?.phone ?? null);
    if (!phone) throw new AppException('VALIDATION_FAILED', 'Give the WhatsApp number of the customer', { details: [{ path: 'to', message: 'No phone number on the document, contact or lead' }] });

    const template = body.templateId
      ? await db.template.findFirst({ where: { id: body.templateId, channel: 'whatsapp' } })
      : await db.template.findFirst({ where: { channel: 'whatsapp', status: 'approved', name: { in: DOCUMENT_TEMPLATE_NAMES(kind) } }, orderBy: { updatedAt: 'desc' } });
    if (!template) {
      throw new AppException('WHATSAPP_TEMPLATE_NOT_APPROVED', 'No approved WhatsApp template for documents. Create one named document_share with {{1}} name, {{2}} document number, {{3}} link and {{4}} amount, and submit it to Meta');
    }
    if (template.status !== 'approved') throw new AppException('WHATSAPP_TEMPLATE_NOT_APPROVED', 'This template is not approved by WhatsApp yet');
    const what = kind === 'quotation' ? 'Quotation' : 'Invoice';
    const totals = documentTemplateVars({ kind, buyerName: d.buyerName, sellerName: d.sellerName, number: d.number, totalPaise: d.totalPaise, due: d.due, link: share.url, pdfLink: share.pdfUrl, message: null, senderName: null, brandColor: null });
    const values: Record<string, string> = { '1': d.buyerName, '2': `${what} ${d.number}`, '3': share.url, '4': totals.total!, ...totals, 'header.media': share.pdfUrl, 'header.filename': `${d.number.replace(/[^\w.-]+/g, '-')}.pdf` };
    // URL buttons ending in {{1}} (e.g. https://app.example.in/d/{{1}}) get the share token
    const token = share.url.split('/').pop() ?? '';
    (Array.isArray(template.buttons) ? (template.buttons as Array<{ type?: string; url?: string }>) : []).forEach((b, i) => {
      if (b.type === 'url' && b.url && /\{\{\s*1\s*\}\}\s*$/.test(b.url)) values[`button.${i}`] = token;
    });
    Object.assign(values, body.variables ?? {});
    const payload = whatsappTemplatePayload(template, values);

    // contact and conversation of that number (as an inbound message would create them)
    const c = contact?.phone && toE164(contact.phone) === phone ? contact : await db.contact.upsert({ where: { workspaceId_phone: { workspaceId: wid, phone } }, create: { workspaceId: wid, name: d.buyerName.slice(0, 120), phone }, update: {}, select: { id: true, phone: true } });
    const optIn = await db.contact.findFirst({ where: { id: c.id }, select: { whatsappOptIn: true } });
    if (optIn?.whatsappOptIn === 'opted_out') throw new AppException('CONSENT_OPTED_OUT', 'This customer opted out of WhatsApp messages');
    const existing = await db.conversation.findFirst({ where: { channel: 'whatsapp', contactId: c.id }, select: { id: true } });
    const convId = existing?.id ?? (await db.conversation.create({ data: { workspaceId: wid, channel: 'whatsapp', contactId: c.id, leadId: d.leadId, assigneeId: auth.userId, status: 'open', unreadCount: 0 }, select: { id: true } })).id;

    const text = template.body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => values[k] ?? m);
    const created = await db.message.create({ data: { workspaceId: wid, conversationId: convId, direction: 'outbound', type: 'template', body: text, templateId: template.id, templateName: template.name, status: 'queued', authorId: auth.userId } });
    const result = await this.whatsapp.send(wid, wa, phone, payload);
    const msg = await db.message.update({ where: { id: created.id }, data: { status: result.status, providerMessageId: result.providerMessageId, error: result.error } });
    if (result.mode === 'mock' && result.status === 'sent') this.whatsapp.simulateMockStatuses(wid, { id: msg.id, conversationId: convId });
    const conv = await db.conversation.update({ where: { id: convId }, data: { lastMessageAt: msg.createdAt, lastMessagePreview: text.slice(0, 140) }, include: CONVERSATION_INCLUDE });
    const actor = await requestActor(db, auth);
    await publishSafe(this.events, this.logger, 'message.sent', wid, {
      conversation: toConversation(conv),
      message: { id: msg.id, conversationId: convId, direction: 'outbound', type: 'template', body: msg.body, templateName: template.name, media: null, status: msg.status, error: msg.error, isInternalNote: false, author: actor.summary, createdAt: msg.createdAt.toISOString() },
    }, { actor: actor.event });
    return { channel: 'whatsapp', status: result.status === 'failed' ? 'failed' : 'sent', via: result.mode === 'mock' ? 'mock' : 'whatsapp_cloud', to: [phone], messageId: msg.id, conversationId: convId, error: result.error, share, sentAt: new Date().toISOString() };
  }

  // ---------------------------------------------------------------- timeline and audit

  private async record(auth: AuthContext, req: Request, kind: DocumentKind, d: DocView, out: DocumentDeliveryOutcome): Promise<void> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const actor = await requestActor(db, auth);
    const what = kind === 'quotation' ? 'Quotation' : 'Invoice';
    const how = out.channel === 'email' ? 'e-mailed' : 'sent on WhatsApp';
    const line = `${what} ${d.number} ${out.status === 'failed' ? `could not be ${how}` : how} to ${out.to.join(', ')}${out.error ? ` (${out.error})` : ''}`.slice(0, 1000);
    try {
      if (d.leadId) {
        await this.lead(db, auth, d.leadId, out, kind, d, line, actor.activityActorType, actor.activityActorId);
      } else if (d.contactId || d.accountId) {
        await db.crmNote.create({ data: { workspaceId: auth.workspaceId, entityType: d.contactId ? 'contact' : 'account', entityId: (d.contactId ?? d.accountId)!, body: line, authorId: auth.userId } });
      }
    } catch (err) {
      this.logger.warn(`Delivery not recorded on the timeline (${(err as Error).name})`);
    }
    await this.audit.record(auth, req, { action: `${kind}.delivered`, entityType: kind, entityId: d.id, diff: { channel: out.channel, status: out.status, via: out.via, recipients: out.to.length } }, actor.summary?.name);
  }

  private async lead(db: TenantDb, auth: AuthContext, leadId: string, out: DocumentDeliveryOutcome, kind: DocumentKind, d: DocView, line: string, actorType: string, actorId: string | null): Promise<void> {
    const exists = await db.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true } });
    if (!exists) throw notFound('Lead');
    const now = new Date();
    await db.activity.create({
      data: {
        workspaceId: auth.workspaceId,
        leadId,
        type: out.channel === 'email' ? 'email' : 'message',
        actorType: actorType as 'user',
        actorId,
        payload: { body: line, preview: line.slice(0, 200), direction: 'outbound', channel: out.channel, status: out.status, documentType: kind, documentId: d.id, number: d.number, conversationId: out.conversationId, messageId: out.messageId },
        createdAt: now,
      },
    });
    await db.lead.updateMany({ where: { id: leadId }, data: { lastActivityAt: now } });
  }
}
