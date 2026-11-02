import { Injectable } from '@nestjs/common';
import { formatPaise, type CrmNoteCreate, type CrmNoteEntity, type CrmRelated, type CrmTimelineItem, type CursorPaginationQuery, type Page, type UserSummary } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { MeetingsService } from '../calendar/meetings.service.js';
import { INVOICE_LIST_INCLUDE, QUOTATION_LIST_INCLUDE, toInvoiceListItem, toQuotationListItem } from '../documents/documents.mapper.js';
import { LEAD_LIST_INCLUDE, toLeadListItem } from '../leads/lead.mapper.js';
import { decodeCursor, encodeCursor, isTimeCursor } from '../leads/lib/cursor.js';
import { localDateOf } from '../presence/engine/working-hours.js';
import { AccountsService } from './accounts.service.js';
import { ContactsService } from './contacts.service.js';
import { CONTACT_INCLUDE, toContactListItem } from './crm.mapper.js';
import { DealsService } from './deals.service.js';
import { ownerScope } from './lib/paging.js';
import { num } from './lib/values.js';

const ACTIVITY_TITLES: Record<string, string> = {
  lead_created: 'Lead created',
  note: 'Note on the lead',
  call: 'Call',
  message: 'WhatsApp message',
  email: 'Email',
  stage_changed: 'Lead stage changed',
  assigned: 'Lead assigned',
  task_created: 'Task created',
  task_completed: 'Task completed',
  workflow_step: 'Automation step',
  file_uploaded: 'File uploaded',
  field_updated: 'Lead updated',
  merged: 'Leads merged',
};

type Item = CrmTimelineItem & { sortId: string };

/** Notes, merged timelines and related lists of contacts, accounts and deals. */
@Injectable()
export class CrmActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly contacts: ContactsService,
    private readonly accounts: AccountsService,
    private readonly deals: DealsService,
    private readonly meetings: MeetingsService,
  ) {}

  /** Parent visible to the caller, and the ids timelines and related lists filter on. */
  private async parent(auth: AuthContext, entity: CrmNoteEntity, id: string) {
    const db = this.prisma.forTenant(auth.workspaceId);
    if (entity === 'contact') {
      await this.contacts.loadVisible(db, auth, id);
      return { leadWhere: { contactId: id } as Prisma.LeadWhereInput, docWhere: { contactId: id }, meetingWhere: { contactId: id } as Prisma.MeetingWhereInput, dealWhere: { contactId: id } as Prisma.DealWhereInput };
    }
    if (entity === 'account') {
      await this.accounts.loadVisible(db, auth, id);
      return { leadWhere: { companyId: id } as Prisma.LeadWhereInput, docWhere: { companyId: id }, meetingWhere: { companyId: id } as Prisma.MeetingWhereInput, dealWhere: { companyId: id } as Prisma.DealWhereInput };
    }
    const deal = await this.deals.loadVisible(db, auth, id);
    return { leadWhere: { id: deal.leadId ?? '00000000-0000-7000-8000-000000000000' } as Prisma.LeadWhereInput, docWhere: { dealId: id }, meetingWhere: { dealId: id } as Prisma.MeetingWhereInput, dealWhere: null };
  }

  private async leadScope(auth: AuthContext): Promise<Prisma.LeadWhereInput> {
    return { deletedAt: null, ...(await this.scope.where(auth, 'ownerId')) };
  }

  // ---------------------------------------------------------------- notes

  async addNote(auth: AuthContext, entity: CrmNoteEntity, id: string, body: CrmNoteCreate): Promise<CrmTimelineItem> {
    await this.parent(auth, entity, id);
    const db = this.prisma.forTenant(auth.workspaceId);
    const now = new Date();
    const note = await db.crmNote.create({ data: { workspaceId: auth.workspaceId, entityType: entity, entityId: id, body: body.body, authorId: auth.userId, createdAt: now } });
    if (entity === 'contact') await this.contacts.touch(db, id, now);
    if (entity === 'account') await this.accounts.touch(db, id, now);
    const author = auth.userId ? await db.user.findFirst({ where: { id: auth.userId }, select: USER_SUMMARY_SELECT }) : null;
    return { id: `note:${note.id}`, kind: 'note', at: now.toISOString(), actor: toUserSummary(author), title: 'Note', body: note.body, ref: null };
  }

  // ---------------------------------------------------------------- timeline

  async timeline(auth: AuthContext, entity: CrmNoteEntity, id: string, q: CursorPaginationQuery): Promise<Page<CrmTimelineItem>> {
    const p = await this.parent(auth, entity, id);
    const db = this.prisma.forTenant(auth.workspaceId);
    const cursor = q.cursor ? decodeCursor(q.cursor, isTimeCursor) : null;
    const before = cursor ? new Date(cursor.t) : null;
    const lte = before ? { lte: before } : undefined;
    const take = q.limit + 1;
    const can = (perm: string) => auth.permissions.includes(perm as never);
    const owners = await ownerScope(this.scope, auth);

    const leads = can('leads.read') ? await db.lead.findMany({ where: { AND: [p.leadWhere, await this.leadScope(auth)] }, select: { id: true, name: true }, take: 200 }) : [];
    const leadName = new Map(leads.map((l) => [l.id, l.name]));
    const [notes, activities, meetings, quotations, invoices, payments, deals] = await Promise.all([
      db.crmNote.findMany({ where: { entityType: entity, entityId: id, ...(lte ? { createdAt: lte } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take }),
      leads.length ? db.activity.findMany({ where: { leadId: { in: leads.map((l) => l.id) }, ...(lte ? { createdAt: lte } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take }) : [],
      can('calendar.read') ? db.meeting.findMany({ where: { AND: [p.meetingWhere, await this.meetings.visibleWhere(auth), ...(lte ? [{ createdAt: lte }] : [])] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take }) : [],
      can('quotations.read') ? db.quotation.findMany({ where: { AND: [p.docWhere, { deletedAt: null }, owners ?? {}, ...(lte ? [{ updatedAt: lte }] : [])] }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take }) : [],
      can('invoices.read') ? db.invoice.findMany({ where: { AND: [p.docWhere, { deletedAt: null }, owners ?? {}, ...(lte ? [{ updatedAt: lte }] : [])] }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take }) : [],
      can('invoices.read') ? db.payment.findMany({ where: { voidedAt: null, invoice: { AND: [p.docWhere, { deletedAt: null }, owners ?? {}] }, ...(lte ? { createdAt: lte } : {}) }, include: { invoice: { select: { number: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take }) : [],
      p.dealWhere && can('deals.read') ? db.deal.findMany({ where: { AND: [p.dealWhere, await this.deals.visibleWhere(auth), ...(lte ? [{ createdAt: lte }] : [])] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take }) : [],
    ]);

    const actorIds = [...new Set([...notes.map((n) => n.authorId), ...activities.map((a) => a.actorId), ...meetings.map((m) => m.organizerId), ...quotations.map((x) => x.ownerId), ...invoices.map((x) => x.ownerId), ...payments.map((x) => x.recordedById), ...deals.map((d) => d.ownerId)].filter((x): x is string => !!x))];
    const users = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: USER_SUMMARY_SELECT }) : [];
    const who = new Map<string, UserSummary>(users.map((u) => [u.id, toUserSummary(u)]));
    const actor = (uid: string | null) => (uid ? (who.get(uid) ?? null) : null);

    const items: Item[] = [
      ...notes.map((n) => ({ id: `note:${n.id}`, sortId: n.id, kind: 'note' as const, at: n.createdAt.toISOString(), actor: actor(n.authorId), title: 'Note', body: n.body, ref: null })),
      ...activities.map((a) => {
        const payload = a.payload as Record<string, unknown>;
        const body = typeof payload.body === 'string' ? payload.body : typeof payload.preview === 'string' ? payload.preview : null;
        return { id: `activity:${a.id}`, sortId: a.id, kind: 'lead_activity' as const, at: a.createdAt.toISOString(), actor: actor(a.actorId), title: `${ACTIVITY_TITLES[a.type] ?? 'Activity'}: ${leadName.get(a.leadId) ?? ''}`.replace(/: $/, ''), body, ref: { type: 'lead' as const, id: a.leadId } };
      }),
      ...meetings.map((m) => ({ id: `meeting:${m.id}`, sortId: m.id, kind: 'meeting' as const, at: m.createdAt.toISOString(), actor: actor(m.organizerId), title: `Meeting ${m.status === 'cancelled' ? 'cancelled' : 'scheduled'}: ${m.title}`, body: m.outcome ?? m.description, ref: { type: 'meeting' as const, id: m.id } })),
      ...quotations.map((x) => ({ id: `quotation:${x.id}`, sortId: x.id, kind: 'quotation' as const, at: x.updatedAt.toISOString(), actor: actor(x.ownerId), title: `Quotation ${x.number} ${x.status} (${formatPaise(num(x.totalPaise))})`, body: null, ref: { type: 'quotation' as const, id: x.id } })),
      ...invoices.map((x) => ({ id: `invoice:${x.id}`, sortId: x.id, kind: 'invoice' as const, at: x.updatedAt.toISOString(), actor: actor(x.ownerId), title: `Invoice ${x.number ?? 'draft'} ${x.status.replace('_', ' ')} (${formatPaise(num(x.totalPaise))})`, body: x.cancelReason, ref: { type: 'invoice' as const, id: x.id } })),
      ...payments.map((x) => ({ id: `payment:${x.id}`, sortId: x.id, kind: 'payment' as const, at: x.createdAt.toISOString(), actor: actor(x.recordedById), title: `Payment ${formatPaise(num(x.amountPaise))} for ${x.invoice.number ?? 'invoice'} (${x.mode.replace('_', ' ')})`, body: x.note, ref: { type: 'invoice' as const, id: x.invoiceId } })),
      ...deals.map((d) => ({ id: `deal:${d.id}`, sortId: d.id, kind: 'deal' as const, at: d.createdAt.toISOString(), actor: actor(d.ownerId), title: `Deal created: ${d.title}`, body: null, ref: { type: 'deal' as const, id: d.id } })),
    ];
    const after = cursor ? items.filter((i) => i.at < cursor.t || (i.at === cursor.t && i.sortId < cursor.id)) : items;
    after.sort((a, b) => (a.at === b.at ? b.sortId.localeCompare(a.sortId) : b.at.localeCompare(a.at)));
    const page = after.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map(({ sortId: _s, ...i }) => i),
      nextCursor: after.length > q.limit && last ? encodeCursor({ t: last.at, id: last.sortId }) : null,
    };
  }

  // ---------------------------------------------------------------- related

  async related(auth: AuthContext, entity: CrmNoteEntity, id: string): Promise<CrmRelated> {
    const p = await this.parent(auth, entity, id);
    const db = this.prisma.forTenant(auth.workspaceId);
    const can = (perm: string) => auth.permissions.includes(perm as never);
    const owners = await ownerScope(this.scope, auth);
    const tz = (await db.workspace.findFirst({ select: { timezone: true } }))?.timezone ?? 'Asia/Kolkata';
    const today = localDateOf(Date.now(), tz);
    const [contacts, leads, deals, quotations, invoices, meetings] = await Promise.all([
      entity === 'account' && can('contacts.read')
        ? db.contact.findMany({ where: { AND: [{ companyId: id }, await this.contacts.visibleWhere(auth)] }, include: CONTACT_INCLUDE, orderBy: { name: 'asc' }, take: 50 })
        : [],
      entity !== 'deal' && can('leads.read') ? db.lead.findMany({ where: { AND: [p.leadWhere, await this.leadScope(auth)] }, include: LEAD_LIST_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 }) : [],
      p.dealWhere && can('deals.read') ? this.deals.listFor(auth, p.dealWhere) : [],
      can('quotations.read') ? db.quotation.findMany({ where: { AND: [p.docWhere, { deletedAt: null }, owners ?? {}] }, include: QUOTATION_LIST_INCLUDE, orderBy: [{ issueDate: 'desc' }, { id: 'desc' }], take: 50 }) : [],
      can('invoices.read') ? db.invoice.findMany({ where: { AND: [p.docWhere, { deletedAt: null }, owners ?? {}] }, include: INVOICE_LIST_INCLUDE, orderBy: [{ issueDate: 'desc' }, { id: 'desc' }], take: 50 }) : [],
      this.meetings.related(auth, p.meetingWhere),
    ]);
    return {
      contacts: contacts.map(toContactListItem),
      leads: leads.map(toLeadListItem),
      deals,
      quotations: quotations.map(toQuotationListItem),
      invoices: invoices.map((i) => toInvoiceListItem(i, today)),
      meetings,
    };
  }
}
