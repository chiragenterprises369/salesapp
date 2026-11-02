import { Injectable, Logger } from '@nestjs/common';
import type { BulkResult, Contact, ContactCreate, ContactListItem, ContactListQuery, ContactUpdate, CrmBulkAction, CrmMerge, CustomFieldValues, Page } from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { assertInTenant, type TenantPrisma } from '../../infra/prisma/tenant.js';
import { applyPatch, changedKeys, loadFieldDefs, roleKeyOf, validateValues, visibleFor } from '../customization/custom-values.js';
import { publishSafe, requestActor, requirePermission, type TenantDb } from '../leads/lib/context.js';
import { CONTACT_INCLUDE, toContact, toContactListItem, type ContactRow } from './crm.mapper.js';
import { isUniqueViolation, jsonOrNull, sortBy } from './lib/db.js';
import { and, ownerFilter, pageArgs, pageOut, partyScope } from './lib/paging.js';
import { dedupePoints, emptyToNull, normalizeAddress, normalizeTags, parseCustom, parseEmails, parsePhones } from './lib/values.js';

const MERGE_FIELDS = ['name', 'title', 'email', 'phone', 'city', 'gstin', 'pan', 'billingAddress', 'shippingAddress', 'companyId', 'ownerId'] as const;
type MergeField = (typeof MERGE_FIELDS)[number];

const phoneTaken = () => new AppException('CONFLICT', 'Another contact already uses this phone number', { details: [{ path: 'phone', message: 'Already used' }] });
const versionConflict = () => new AppException('VERSION_CONFLICT', 'Someone else changed this contact. Reload to see the latest version.');
const json = jsonOrNull;

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  /** Visible and not deleted (owner scope or a visible lead). */
  async visibleWhere(auth: AuthContext): Promise<Prisma.ContactWhereInput> {
    return and<Prisma.ContactWhereInput>({ deletedAt: null }, await partyScope(this.scope, auth));
  }

  async loadVisible(db: TenantDb, auth: AuthContext, id: string): Promise<ContactRow> {
    const row = await db.contact.findFirst({ where: { AND: [{ id }, await this.visibleWhere(auth)] }, include: CONTACT_INCLUDE });
    if (!row) throw notFound('Contact');
    return row;
  }

  /** Contact DTO with custom values hidden for the caller's role removed. */
  async present(db: TenantDb, auth: AuthContext, row: ContactRow): Promise<Contact> {
    const [defs, roleKey] = await Promise.all([loadFieldDefs(db, 'contact'), roleKeyOf(db, auth)]);
    const dto = toContact(row);
    return { ...dto, customFields: visibleFor(defs, dto.customFields, roleKey) };
  }

  private async assignable(db: TenantDb, auth: AuthContext, ownerId: string | null | undefined, current: string | null): Promise<void> {
    if (ownerId === undefined || ownerId === current) return;
    if (ownerId !== auth.userId) requirePermission(auth, 'leads.assign', 'You cannot assign contacts to other users');
    if (ownerId && (await db.user.count({ where: { id: ownerId, isActive: true, deletedAt: null } })) !== 1) throw notFound('User');
  }

  // ---------------------------------------------------------------- list

  async list(auth: AuthContext, q: ContactListQuery): Promise<Page<ContactListItem> & { total: number }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const text = q.q?.trim();
    const where = and<Prisma.ContactWhereInput>(
      await this.visibleWhere(auth),
      ownerFilter(auth, q.ownerId),
      q.accountId ? { companyId: q.accountId } : null,
      q.tag?.length ? { tags: { hasSome: q.tag } } : null,
      q.city ? { city: { equals: q.city, mode: 'insensitive' } } : null,
      q.stateCode?.length ? { stateCode: { in: q.stateCode } } : null,
      q.createdFrom || q.createdTo ? { createdAt: { ...(q.createdFrom ? { gte: new Date(q.createdFrom) } : {}), ...(q.createdTo ? { lt: new Date(q.createdTo) } : {}) } } : null,
      text
        ? {
            OR: [
              { name: { contains: text, mode: 'insensitive' } },
              { email: { contains: text, mode: 'insensitive' } },
              { phone: { contains: text.replace(/[\s-]/g, '') } },
              { gstin: { contains: text.toUpperCase() } },
              { company: { name: { contains: text, mode: 'insensitive' } } },
            ],
          }
        : null,
    );
    const { skip, take } = pageArgs(q.cursor, q.limit);
    const [rows, total] = await Promise.all([
      db.contact.findMany({ where, orderBy: sortBy<Prisma.ContactOrderByWithRelationInput[]>(q.sort, q.dir, ['lastActivityAt']), skip, take, include: CONTACT_INCLUDE }),
      db.contact.count({ where }),
    ]);
    const page = pageOut(rows, skip, q.limit);
    return { items: page.rows.map(toContactListItem), nextCursor: page.nextCursor, total };
  }

  // ---------------------------------------------------------------- create, read, update, delete

  async create(auth: AuthContext, body: ContactCreate): Promise<Contact> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const ownerId = body.ownerId !== undefined ? body.ownerId : auth.dataScope !== 'all' ? auth.userId : null;
    await this.assignable(db, auth, ownerId, null);
    await assertInTenant(db as TenantPrisma, { company: body.accountId });
    const defs = await loadFieldDefs(db, 'contact');
    const customFields = applyPatch({}, await validateValues(db, auth, defs, body.customFields, { mode: 'create', pathPrefix: 'customFields' }));
    const phone = body.phone ?? null;
    if (phone && (await db.contact.count({ where: { phone } }))) throw phoneTaken();
    const email = body.email?.toLowerCase() ?? null;
    const billing = normalizeAddress(body.billingAddress);
    let row: ContactRow;
    try {
      row = await db.contact.create({
        data: {
          workspaceId: wid,
          name: body.name.trim(),
          title: emptyToNull(body.title),
          phone,
          email,
          additionalPhones: dedupePoints(body.additionalPhones, phone),
          additionalEmails: dedupePoints(body.additionalEmails, email, (v) => v.toLowerCase()),
          companyId: body.accountId ?? null,
          city: emptyToNull(body.city) ?? billing?.city ?? null,
          stateCode: billing?.stateCode ?? null,
          gstin: body.gstin ?? null,
          pan: body.pan ?? (body.gstin ? body.gstin.slice(2, 12) : null),
          billingAddress: json(billing),
          shippingAddress: json(normalizeAddress(body.shippingAddress)),
          ownerId,
          tags: normalizeTags(body.tags),
          dnd: body.dnd ?? false,
          customFields: customFields as Prisma.InputJsonObject,
        },
        include: CONTACT_INCLUDE,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw phoneTaken();
      throw err;
    }
    const actor = await requestActor(db, auth);
    await publishSafe(this.events, this.logger, 'contact.created', wid, { contact: toContactListItem(row) }, { actor: actor.event });
    return this.present(db, auth, row);
  }

  async get(auth: AuthContext, id: string): Promise<Contact> {
    const db = this.prisma.forTenant(auth.workspaceId);
    return this.present(db, auth, await this.loadVisible(db, auth, id));
  }

  async update(auth: AuthContext, id: string, body: ContactUpdate): Promise<Contact> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const current = await this.loadVisible(db, auth, id);
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) throw versionConflict();
    await this.assignable(db, auth, body.ownerId, current.ownerId);
    await assertInTenant(db as TenantPrisma, { company: body.accountId });

    const data: Prisma.ContactUncheckedUpdateManyInput = {};
    const changed: string[] = [];
    const set = (key: string, value: unknown, prev: unknown) => {
      if (JSON.stringify(value ?? null) === JSON.stringify(prev ?? null)) return;
      (data as Record<string, unknown>)[key] = value;
      changed.push(key);
    };
    if (body.name !== undefined) set('name', body.name.trim(), current.name);
    if (body.title !== undefined) set('title', emptyToNull(body.title), current.title);
    if (body.phone !== undefined) {
      if (body.phone && body.phone !== current.phone && (await db.contact.count({ where: { phone: body.phone, id: { not: id } } }))) throw phoneTaken();
      set('phone', body.phone, current.phone);
    }
    if (body.email !== undefined) set('email', body.email?.toLowerCase() ?? null, current.email);
    const phone = body.phone !== undefined ? body.phone : current.phone;
    const email = body.email !== undefined ? (body.email?.toLowerCase() ?? null) : current.email;
    if (body.additionalPhones !== undefined) set('additionalPhones', dedupePoints(body.additionalPhones, phone), parsePhones(current.additionalPhones));
    if (body.additionalEmails !== undefined) set('additionalEmails', dedupePoints(body.additionalEmails, email, (v) => v.toLowerCase()), parseEmails(current.additionalEmails));
    if (body.accountId !== undefined) set('companyId', body.accountId, current.companyId);
    if (body.city !== undefined) set('city', emptyToNull(body.city), current.city);
    if (body.gstin !== undefined) set('gstin', body.gstin, current.gstin);
    if (body.pan !== undefined) set('pan', body.pan, current.pan);
    if (body.billingAddress !== undefined) {
      const billing = normalizeAddress(body.billingAddress);
      set('billingAddress', billing, current.billingAddress);
      set('stateCode', billing?.stateCode ?? null, current.stateCode);
      if (billing?.city && body.city === undefined && !current.city) set('city', billing.city, current.city);
    }
    if (body.shippingAddress !== undefined) set('shippingAddress', normalizeAddress(body.shippingAddress), current.shippingAddress);
    if (body.ownerId !== undefined) set('ownerId', body.ownerId, current.ownerId);
    if (body.tags !== undefined) set('tags', normalizeTags(body.tags), current.tags);
    if (body.dnd !== undefined) set('dnd', body.dnd, current.dnd);
    if (body.customFields !== undefined) {
      const defs = await loadFieldDefs(db, 'contact');
      const prev = parseCustom(current.customFields);
      const next: CustomFieldValues = applyPatch(prev, await validateValues(db, auth, defs, body.customFields, { mode: 'update', pathPrefix: 'customFields' }));
      if (changedKeys(prev, next).length) {
        data.customFields = next as Prisma.InputJsonObject;
        changed.push('customFields');
      }
    }
    if (!changed.length) return this.present(db, auth, current);
    for (const k of ['billingAddress', 'shippingAddress'] as const) if (k in data) data[k] = json(data[k]);

    try {
      const res = await db.contact.updateMany({ where: { id, version: current.version, deletedAt: null }, data: { ...data, version: { increment: 1 } } });
      if (res.count !== 1) throw versionConflict();
    } catch (err) {
      if (isUniqueViolation(err)) throw phoneTaken();
      throw err;
    }
    const row = await db.contact.findUniqueOrThrow({ where: { id }, include: CONTACT_INCLUDE });
    const actor = await requestActor(db, auth);
    await publishSafe(this.events, this.logger, 'contact.updated', wid, { contact: toContactListItem(row), changed }, { actor: actor.event });
    return this.present(db, auth, row);
  }

  /** Soft delete. The primary phone moves to the extra phones so the number can be used again. */
  async remove(auth: AuthContext, req: Request | null, id: string): Promise<{ ok: true }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const c = await this.loadVisible(db, auth, id);
    await db.$transaction(async (tx) => {
      await tx.contact.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date(), phone: null, additionalPhones: c.phone ? [{ label: 'other', value: c.phone }, ...parsePhones(c.additionalPhones)] : parsePhones(c.additionalPhones), version: { increment: 1 } },
      });
      await tx.lead.updateMany({ where: { contactId: id }, data: { contactId: null } });
    });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'contact.delete', entityType: 'contact', entityId: id, diff: { name: c.name, ownerId: c.ownerId } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'contact.deleted', wid, { contactIds: [id] }, { actor: actor.event });
    return { ok: true };
  }

  // ---------------------------------------------------------------- duplicates and merge

  async duplicates(auth: AuthContext, id: string): Promise<{ items: ContactListItem[] }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const c = await this.loadVisible(db, auth, id);
    const phones = [c.phone, ...parsePhones(c.additionalPhones).map((p) => p.value)].filter((p): p is string => !!p);
    const emails = [c.email, ...parseEmails(c.additionalEmails).map((e) => e.value)].filter((e): e is string => !!e);
    const or: Prisma.ContactWhereInput[] = [];
    if (phones.length) or.push({ phone: { in: phones } });
    for (const e of emails) or.push({ email: { equals: e, mode: 'insensitive' } });
    if (c.gstin) or.push({ gstin: c.gstin });
    or.push(c.companyId ? { name: { equals: c.name, mode: 'insensitive' }, companyId: c.companyId } : { name: { equals: c.name, mode: 'insensitive' } });
    const rows = await db.contact.findMany({
      where: { AND: [await this.visibleWhere(auth), { id: { not: id } }, { OR: or }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      include: CONTACT_INCLUDE,
    });
    return { items: rows.map(toContactListItem) };
  }

  async merge(auth: AuthContext, req: Request, body: CrmMerge): Promise<Contact> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const ids = [...new Set(body.duplicateIds)].filter((d) => d !== body.primaryId);
    if (!ids.length) throw new AppException('RECORD_MERGE_INVALID', 'Pick at least one other contact to merge');
    const primary = await this.loadVisible(db, auth, body.primaryId);
    const dups = await Promise.all(ids.map((d) => this.loadVisible(db, auth, d)));
    const all = [primary, ...dups];
    const byId = new Map(all.map((r) => [r.id, r]));
    for (const winner of Object.values(body.fieldWinners)) if (!byId.has(winner)) throw new AppException('RECORD_MERGE_INVALID', 'A field winner is not one of the merged contacts');

    const pick = <K extends MergeField>(field: K): ContactRow[K] => {
      const w = body.fieldWinners[field];
      if (w) return byId.get(w)![field];
      const own = primary[field];
      if (own !== null && own !== undefined && own !== '') return own;
      return dups.find((d) => d[field] !== null && d[field] !== undefined && d[field] !== '')?.[field] ?? own;
    };
    const merged = Object.fromEntries(MERGE_FIELDS.map((f) => [f, pick(f)])) as { [K in MergeField]: ContactRow[K] };
    if (merged.ownerId !== primary.ownerId) await this.assignable(db, auth, merged.ownerId, primary.ownerId);
    const allPhones = all.flatMap((r) => [...(r.phone ? [{ label: 'mobile' as const, value: r.phone }] : []), ...parsePhones(r.additionalPhones)]);
    const allEmails = all.flatMap((r) => [...(r.email ? [{ label: 'work' as const, value: r.email }] : []), ...parseEmails(r.additionalEmails)]);
    const custom = all.reduceRight<CustomFieldValues>((acc, r) => ({ ...parseCustom(r.customFields), ...acc }), {});
    const now = new Date();

    await db.$transaction(async (tx) => {
      // free the duplicates' phones first (unique per workspace)
      await tx.contact.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now, mergedIntoId: primary.id, phone: null, version: { increment: 1 } } });
      for (const model of ['lead', 'deal', 'quotation', 'invoice', 'meeting', 'meetingAttendee', 'conversation', 'consentRecord'] as const) {
        await (tx[model] as unknown as { updateMany: (a: { where: object; data: object }) => Promise<unknown> }).updateMany({ where: { contactId: { in: ids } }, data: { contactId: primary.id } });
      }
      await tx.contact.update({
        where: { id: primary.id },
        data: {
          name: merged.name,
          title: merged.title,
          phone: merged.phone,
          email: merged.email,
          city: merged.city,
          gstin: merged.gstin,
          pan: merged.pan,
          companyId: merged.companyId,
          ownerId: merged.ownerId,
          billingAddress: json(merged.billingAddress),
          shippingAddress: json(merged.shippingAddress),
          stateCode: normalizeAddress(parseAddressSafe(merged.billingAddress))?.stateCode ?? primary.stateCode,
          additionalPhones: dedupePoints(allPhones, merged.phone),
          additionalEmails: dedupePoints(allEmails, merged.email, (v) => v.toLowerCase()),
          tags: normalizeTags(all.flatMap((r) => r.tags)),
          dnd: all.some((r) => r.dnd),
          customFields: custom as Prisma.InputJsonObject,
          lastActivityAt: now,
          version: { increment: 1 },
        },
      });
      await tx.crmNote.updateMany({ where: { entityType: 'contact', entityId: { in: ids } }, data: { entityId: primary.id } });
    });

    const row = await db.contact.findUniqueOrThrow({ where: { id: primary.id }, include: CONTACT_INCLUDE });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'contact.merge', entityType: 'contact', entityId: primary.id, diff: { mergedIds: ids } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'contact.merged', wid, { primaryId: primary.id, mergedIds: ids }, { actor: actor.event });
    await publishSafe(this.events, this.logger, 'contact.updated', wid, { contact: toContactListItem(row), changed: ['merged'] }, { actor: actor.event });
    return this.present(db, auth, row);
  }

  // ---------------------------------------------------------------- bulk

  async bulk(auth: AuthContext, req: Request, body: CrmBulkAction): Promise<BulkResult> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    if (body.action === 'assign') {
      if (body.ownerId !== auth.userId) requirePermission(auth, 'leads.assign', 'You cannot assign contacts to other users');
      if (body.ownerId) await this.assignable(db, auth, body.ownerId, null);
    }
    if (body.action === 'delete') requirePermission(auth, 'contacts.delete', 'You cannot delete contacts');
    const ids = [...new Set(body.ids)];
    const visible = await db.contact.findMany({ where: { AND: [{ id: { in: ids } }, await this.visibleWhere(auth)] }, select: { id: true, tags: true } });
    const ok = new Set(visible.map((v) => v.id));
    const failed = ids.filter((i) => !ok.has(i)).map((i) => ({ id: i, code: 'NOT_FOUND', message: 'Contact not found' }));
    if (body.action === 'delete') {
      for (const v of visible) await this.remove(auth, req, v.id);
    } else {
      for (const v of visible) {
        const data: Prisma.ContactUncheckedUpdateManyInput =
          body.action === 'assign'
            ? { ownerId: body.ownerId }
            : body.action === 'add_tags'
              ? { tags: normalizeTags([...v.tags, ...body.tags]) }
              : { tags: v.tags.filter((t) => !body.tags.includes(t)) };
        await db.contact.updateMany({ where: { id: v.id }, data: { ...data, version: { increment: 1 } } });
      }
      if (visible.length) {
        const rows = await db.contact.findMany({ where: { id: { in: [...ok] } }, include: CONTACT_INCLUDE });
        const actor = await requestActor(db, auth);
        for (const r of rows) await publishSafe(this.events, this.logger, 'contact.updated', wid, { contact: toContactListItem(r), changed: [body.action === 'assign' ? 'ownerId' : 'tags'] }, { actor: actor.event });
      }
    }
    return { succeeded: visible.length, failed };
  }

  /** Touch lastActivityAt (notes, meetings, documents). */
  async touch(db: TenantDb, id: string, at = new Date()): Promise<void> {
    await db.contact.updateMany({ where: { id }, data: { lastActivityAt: at } });
  }
}

function parseAddressSafe(v: unknown) {
  return v && typeof v === 'object' ? (v as Parameters<typeof normalizeAddress>[0]) : null;
}
