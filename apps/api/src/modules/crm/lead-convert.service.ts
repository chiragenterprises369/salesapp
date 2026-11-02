import { Injectable, Logger } from '@nestjs/common';
import { stateCodeFromName, type LeadConvert, type LeadConvertResult } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { notFound } from '../../common/errors/app-exception.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { LEAD_LIST_INCLUDE, toLeadListItem } from '../leads/lead.mapper.js';
import { LeadsService } from '../leads/leads.service.js';
import { publishSafe, requestActor, requirePermission } from '../leads/lib/context.js';
import { AccountsService } from './accounts.service.js';
import { ContactsService } from './contacts.service.js';
import { DealsService } from './deals.service.js';

/**
 * POST /leads/{id}/convert: lead -> contact -> account (+ deal). The lead keeps its own data and gets
 * contactId / companyId; what is created needs its own create permission.
 */
@Injectable()
export class LeadConvertService {
  private readonly logger = new Logger(LeadConvertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly leads: LeadsService,
    private readonly contacts: ContactsService,
    private readonly accounts: AccountsService,
    private readonly deals: DealsService,
  ) {}

  async convert(auth: AuthContext, leadId: string, body: LeadConvert): Promise<LeadConvertResult> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const lead = await this.leads.loadVisible(db, auth, leadId);

    // account
    let accountId: string | null = lead.companyId;
    const acc = body.account;
    if (acc?.mode === 'existing') {
      await this.accounts.loadVisible(db, auth, acc.accountId);
      accountId = acc.accountId;
    } else if (acc?.mode === 'create' || (!acc && !lead.companyId && lead.companyName)) {
      const name = (acc?.mode === 'create' ? acc.name : undefined) ?? lead.companyName ?? lead.name;
      const existing = await db.company.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
      if (existing) accountId = existing.id;
      else {
        requirePermission(auth, 'accounts.create', 'You cannot create accounts');
        const stateCode = stateCodeFromName(lead.state);
        const created = await this.accounts.create(auth, {
          name,
          gstin: acc?.mode === 'create' ? (acc.gstin ?? null) : null,
          billingAddress: lead.city && stateCode ? { line1: lead.city, line2: null, city: lead.city, state: null, stateCode, pincode: null, country: 'IN' } : null,
          ownerId: lead.ownerId,
          additionalPhones: [],
          additionalEmails: [],
          tags: [],
          customFields: {},
        });
        accountId = created.id;
      }
    }
    // contact
    let contactId: string | null = body.contactId ?? lead.contactId;
    if (body.contactId) await this.contacts.loadVisible(db, auth, body.contactId);
    if (!contactId) {
      requirePermission(auth, 'contacts.create', 'You cannot create contacts');
      const created = await this.contacts.create(auth, {
        name: lead.name,
        phone: lead.phone as never,
        email: lead.email,
        city: lead.city,
        accountId,
        ownerId: lead.ownerId,
        additionalPhones: [],
        additionalEmails: [],
        tags: [],
        customFields: {},
      });
      contactId = created.id;
    }
    if (accountId) await db.contact.updateMany({ where: { id: contactId, companyId: null }, data: { companyId: accountId } });
    if (lead.contactId !== contactId || lead.companyId !== accountId) {
      await db.lead.updateMany({ where: { id: leadId }, data: { contactId, companyId: accountId, version: { increment: 1 } } });
      const row = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: LEAD_LIST_INCLUDE });
      const actor = await requestActor(db, auth);
      await publishSafe(this.events, this.logger, 'lead.updated', wid, { lead: toLeadListItem(row), changed: ['contactId', 'companyId'] }, { actor: actor.event });
    }

    // deal
    let deal: LeadConvertResult['deal'] = null;
    if (body.deal) {
      requirePermission(auth, 'deals.create', 'You cannot create deals');
      deal = await this.deals.create(auth, {
        title: body.deal.title ?? `${lead.companyName ?? lead.name}${lead.productInterest ? ` - ${lead.productInterest}` : ''}`,
        valueInr: body.deal.valueInr ?? lead.valueInr,
        ...(body.deal.stageId ? { stageId: body.deal.stageId } : {}),
        expectedCloseAt: body.deal.expectedCloseAt ?? null,
        ownerId: body.deal.ownerId !== undefined ? body.deal.ownerId : lead.ownerId,
        leadId,
        contactId,
        accountId,
        lines: [],
        customFields: {},
      });
    }

    const contact = await this.contacts.get(auth, contactId);
    const account = accountId ? await this.accounts.get(auth, accountId).catch(() => null) : null;
    if (!contact) throw notFound('Contact');
    return { leadId, contact, account, deal };
  }
}
