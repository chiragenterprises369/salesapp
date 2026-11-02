import { Injectable, Logger } from '@nestjs/common';
import { panFromGstin, stateCodeFromGstin, type Account, type AccountCreate, type AccountListItem, type AccountListQuery, type AccountUpdate, type BulkResult, type CrmBulkAction, type CrmMerge, type CustomFieldValues, type Page } from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { applyPatch, changedKeys, loadFieldDefs, roleKeyOf, validateValues, visibleFor } from '../customization/custom-values.js';
import { publishSafe, requestActor, requirePermission, type TenantDb } from '../leads/lib/context.js';
import { ACCOUNT_INCLUDE, toAccount, toAccountListItem, type AccountRow } from './crm.mapper.js';
import { jsonOrNull, sortBy } from './lib/db.js';
import { and, ownerFilter, pageArgs, pageOut, partyScope } from './lib/paging.js';
import { dedupePoints, emptyToNull, normalizeAddress, normalizeTags, parseAddress, parseCustom, parseEmails, parsePhones } from './lib/values.js';

const MERGE_FIELDS = ['name', 'industry', 'website', 'phone', 'email', 'gstin', 'pan', 'billingAddress', 'shippingAddress', 'ownerId'] as const;
type MergeField = (typeof MERGE_FIELDS)[number];
const versionConflict = () => new AppException('VERSION_CONFLICT', 'Someone else changed this account. Reload to see the latest version.');

/** GSTIN state must match the billing state when both are set (the GST state decides the tax type). */
function checkGstinState(gstin: string | null | undefined, billingStateCode: string | null | undefined): void {
  const fromGstin = stateCodeFromGstin(gstin);
  if (fromGstin && billingStateCode && fromGstin !== billingStateCode) {
    throw new AppException('VALIDATION_FAILED', 'The GSTIN belongs to a different state than the billing address', { details: [{ path: 'billingAddress.stateCode', message: 'Does not match the GSTIN state' }], status: 422 });
  }
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  async visibleWhere(auth: AuthContext): Promise<Prisma.CompanyWhereInput> {
    return and<Prisma.CompanyWhereInput>({ deletedAt: null }, await partyScope(this.scope, auth));
  }

  async loadVisible(db: TenantDb, auth: AuthContext, id: string): Promise<AccountRow> {
    const row = await db.company.findFirst({ where: { AND: [{ id }, await this.visibleWhere(auth)] }, include: ACCOUNT_INCLUDE });
    if (!row) throw notFound('Account');
    return row;
  }

  /** Sum of open deal values per account. */
  async openValues(db: TenantDb, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const groups = await db.deal.groupBy({ by: ['companyId'], where: { companyId: { in: ids }, status: 'open', deletedAt: null }, _sum: { valueInr: true } });
    return new Map(groups.filter((g) => g.companyId).map((g) => [g.companyId as string, g._sum.valueInr ?? 0]));
  }

  async present(db: TenantDb, auth: AuthContext, row: AccountRow): Promise<Account> {
    const [defs, roleKey, values] = await Promise.all([loadFieldDefs(db, 'company'), roleKeyOf(db, auth), this.openValues(db, [row.id])]);
    const dto = toAccount(row, values.get(row.id) ?? 0);
    return { ...dto, customFields: visibleFor(defs, dto.customFields, roleKey) };
  }

  async listItem(db: TenantDb, row: AccountRow): Promise<AccountListItem> {
    return toAccountListItem(row, (await this.openValues(db, [row.id])).get(row.id) ?? 0);
  }

  private async assignable(db: TenantDb, auth: AuthContext, ownerId: string | null | undefined, current: string | null): Promise<void> {
    if (ownerId === undefined || ownerId === current) return;
    if (ownerId !== auth.userId) requirePermission(auth, 'leads.assign', 'You cannot assign accounts to other users');
    if (ownerId && (await db.user.count({ where: { id: ownerId, isActive: true, deletedAt: null } })) !== 1) throw notFound('User');
  }

  // ---------------------------------------------------------------- list

  async list(auth: AuthContext, q: AccountListQuery): Promise<Page<AccountListItem> & { total: number }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const text = q.q?.trim();
    const where = and<Prisma.CompanyWhereInput>(
      await this.visibleWhere(auth),
      ownerFilter(auth, q.ownerId),
      q.tag?.length ? { tags: { hasSome: q.tag } } : null,
      q.industry ? { industry: { equals: q.industry, mode: 'insensitive' } } : null,
      q.city ? { city: { equals: q.city, mode: 'insensitive' } } : null,
      q.stateCode?.length ? { stateCode: { in: q.stateCode } } : null,
      q.createdFrom || q.createdTo ? { createdAt: { ...(q.createdFrom ? { gte: new Date(q.createdFrom) } : {}), ...(q.createdTo ? { lt: new Date(q.createdTo) } : {}) } } : null,
      text
        ? {
            OR: [
              { name: { contains: text, mode: 'insensitive' } },
              { gstin: { contains: text.toUpperCase() } },
              { email: { contains: text, mode: 'insensitive' } },
              { phone: { contains: text.replace(/[\s-]/g, '') } },
              { website: { contains: text, mode: 'insensitive' } },
            ],
          }
        : null,
    );
    const { skip, take } = pageArgs(q.cursor, q.limit);
    const [rows, total] = await Promise.all([
      db.company.findMany({ where, orderBy: sortBy<Prisma.CompanyOrderByWithRelationInput[]>(q.sort, q.dir, ['lastActivityAt']), skip, take, include: ACCOUNT_INCLUDE }),
      db.company.count({ where }),
    ]);
    const page = pageOut(rows, skip, q.limit);
    const values = await this.openValues(db, page.rows.map((r) => r.id));
    return { items: page.rows.map((r) => toAccountListItem(r, values.get(r.id) ?? 0)), nextCursor: page.nextCursor, total };
  }

  // ---------------------------------------------------------------- CRUD

  async create(auth: AuthContext, body: AccountCreate): Promise<Account> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const ownerId = body.ownerId !== undefined ? body.ownerId : auth.dataScope !== 'all' ? auth.userId : null;
    await this.assignable(db, auth, ownerId, null);
    const billing = normalizeAddress(body.billingAddress);
    checkGstinState(body.gstin, billing?.stateCode);
    const defs = await loadFieldDefs(db, 'company');
    const customFields = applyPatch({}, await validateValues(db, auth, defs, body.customFields, { mode: 'create', pathPrefix: 'customFields' }));
    const phone = body.phone ?? null;
    const email = body.email?.toLowerCase() ?? null;
    const row = await db.company.create({
      data: {
        workspaceId: wid,
        name: body.name.trim(),
        industry: emptyToNull(body.industry),
        website: body.website ?? null,
        phone,
        email,
        additionalPhones: dedupePoints(body.additionalPhones, phone),
        additionalEmails: dedupePoints(body.additionalEmails, email, (v) => v.toLowerCase()),
        gstin: body.gstin ?? null,
        pan: body.pan ?? panFromGstin(body.gstin),
        billingAddress: jsonOrNull(billing),
        shippingAddress: jsonOrNull(normalizeAddress(body.shippingAddress)),
        city: billing?.city ?? null,
        state: billing?.state ?? null,
        stateCode: billing?.stateCode ?? stateCodeFromGstin(body.gstin),
        ownerId,
        tags: normalizeTags(body.tags),
        customFields: customFields as Prisma.InputJsonObject,
      },
      include: ACCOUNT_INCLUDE,
    });
    const actor = await requestActor(db, auth);
    await publishSafe(this.events, this.logger, 'account.created', wid, { account: toAccountListItem(row) }, { actor: actor.event });
    return this.present(db, auth, row);
  }

  async get(auth: AuthContext, id: string): Promise<Account> {
    const db = this.prisma.forTenant(auth.workspaceId);
    return this.present(db, auth, await this.loadVisible(db, auth, id));
  }

  async update(auth: AuthContext, id: string, body: AccountUpdate): Promise<Account> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const current = await this.loadVisible(db, auth, id);
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) throw versionConflict();
    await this.assignable(db, auth, body.ownerId, current.ownerId);

    const data: Record<string, unknown> = {};
    const changed: string[] = [];
    const set = (key: string, value: unknown, prev: unknown) => {
      if (JSON.stringify(value ?? null) === JSON.stringify(prev ?? null)) return;
      data[key] = value;
      changed.push(key);
    };
    if (body.name !== undefined) set('name', body.name.trim(), current.name);
    if (body.industry !== undefined) set('industry', emptyToNull(body.industry), current.industry);
    if (body.website !== undefined) set('website', body.website, current.website);
    if (body.phone !== undefined) set('phone', body.phone, current.phone);
    if (body.email !== undefined) set('email', body.email?.toLowerCase() ?? null, current.email);
    const phone = body.phone !== undefined ? body.phone : current.phone;
    const email = body.email !== undefined ? (body.email?.toLowerCase() ?? null) : current.email;
    if (body.additionalPhones !== undefined) set('additionalPhones', dedupePoints(body.additionalPhones, phone), parsePhones(current.additionalPhones));
    if (body.additionalEmails !== undefined) set('additionalEmails', dedupePoints(body.additionalEmails, email, (v) => v.toLowerCase()), parseEmails(current.additionalEmails));
    if (body.gstin !== undefined) {
      set('gstin', body.gstin, current.gstin);
      if (body.gstin && body.pan === undefined && !current.pan) set('pan', panFromGstin(body.gstin), current.pan);
    }
    if (body.pan !== undefined) set('pan', body.pan, current.pan);
    const billing = body.billingAddress !== undefined ? normalizeAddress(body.billingAddress) : parseAddress(current.billingAddress);
    checkGstinState(body.gstin !== undefined ? body.gstin : current.gstin, billing?.stateCode);
    if (body.billingAddress !== undefined) {
      set('billingAddress', billing, current.billingAddress);
      set('city', billing?.city ?? null, current.city);
      set('state', billing?.state ?? null, current.state);
      set('stateCode', billing?.stateCode ?? stateCodeFromGstin(body.gstin ?? current.gstin), current.stateCode);
    }
    if (body.shippingAddress !== undefined) set('shippingAddress', normalizeAddress(body.shippingAddress), current.shippingAddress);
    if (body.ownerId !== undefined) set('ownerId', body.ownerId, current.ownerId);
    if (body.tags !== undefined) set('tags', normalizeTags(body.tags), current.tags);
    if (body.customFields !== undefined) {
      const defs = await loadFieldDefs(db, 'company');
      const prev = parseCustom(current.customFields);
      const next: CustomFieldValues = applyPatch(prev, await validateValues(db, auth, defs, body.customFields, { mode: 'update', pathPrefix: 'customFields' }));
      if (changedKeys(prev, next).length) {
        data.customFields = next;
        changed.push('customFields');
      }
    }
    if (!changed.length) return this.present(db, auth, current);
    for (const k of ['billingAddress', 'shippingAddress']) if (k in data) data[k] = jsonOrNull(data[k]);

    const res = await db.company.updateMany({ where: { id, version: current.version, deletedAt: null }, data: { ...(data as Prisma.CompanyUncheckedUpdateManyInput), version: { increment: 1 } } });
    if (res.count !== 1) throw versionConflict();
    const row = await db.company.findUniqueOrThrow({ where: { id }, include: ACCOUNT_INCLUDE });
    const actor = await requestActor(db, auth);
    await publishSafe(this.events, this.logger, 'account.updated', wid, { account: await this.listItem(db, row), changed }, { actor: actor.event });
    return this.present(db, auth, row);
  }

  async remove(auth: AuthContext, req: Request | null, id: string): Promise<{ ok: true }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const a = await this.loadVisible(db, auth, id);
    await db.$transaction(async (tx) => {
      await tx.company.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await tx.contact.updateMany({ where: { companyId: id }, data: { companyId: null } });
      await tx.lead.updateMany({ where: { companyId: id }, data: { companyId: null } });
    });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'account.delete', entityType: 'account', entityId: id, diff: { name: a.name, gstin: a.gstin, ownerId: a.ownerId } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'account.deleted', wid, { accountIds: [id] }, { actor: actor.event });
    return { ok: true };
  }

  // ---------------------------------------------------------------- duplicates and merge

  async duplicates(auth: AuthContext, id: string): Promise<{ items: AccountListItem[] }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const a = await this.loadVisible(db, auth, id);
    const or: Prisma.CompanyWhereInput[] = [{ name: { equals: a.name, mode: 'insensitive' } }];
    if (a.gstin) or.push({ gstin: a.gstin });
    if (a.pan) or.push({ pan: a.pan });
    if (a.phone) or.push({ phone: a.phone });
    if (a.email) or.push({ email: { equals: a.email, mode: 'insensitive' } });
    if (a.website) or.push({ website: { equals: a.website, mode: 'insensitive' } });
    const rows = await db.company.findMany({ where: { AND: [await this.visibleWhere(auth), { id: { not: id } }, { OR: or }] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, include: ACCOUNT_INCLUDE });
    const values = await this.openValues(db, rows.map((r) => r.id));
    return { items: rows.map((r) => toAccountListItem(r, values.get(r.id) ?? 0)) };
  }

  async merge(auth: AuthContext, req: Request, body: CrmMerge): Promise<Account> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const ids = [...new Set(body.duplicateIds)].filter((d) => d !== body.primaryId);
    if (!ids.length) throw new AppException('RECORD_MERGE_INVALID', 'Pick at least one other account to merge');
    const primary = await this.loadVisible(db, auth, body.primaryId);
    const dups = await Promise.all(ids.map((d) => this.loadVisible(db, auth, d)));
    const all = [primary, ...dups];
    const byId = new Map(all.map((r) => [r.id, r]));
    for (const winner of Object.values(body.fieldWinners)) if (!byId.has(winner)) throw new AppException('RECORD_MERGE_INVALID', 'A field winner is not one of the merged accounts');
    const pick = <K extends MergeField>(field: K): AccountRow[K] => {
      const w = body.fieldWinners[field];
      if (w) return byId.get(w)![field];
      const own = primary[field];
      if (own !== null && own !== undefined && own !== '') return own;
      return dups.find((d) => d[field] !== null && d[field] !== undefined && d[field] !== '')?.[field] ?? own;
    };
    const m = Object.fromEntries(MERGE_FIELDS.map((f) => [f, pick(f)])) as { [K in MergeField]: AccountRow[K] };
    if (m.ownerId !== primary.ownerId) await this.assignable(db, auth, m.ownerId, primary.ownerId);
    const billing = parseAddress(m.billingAddress);
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.company.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now, mergedIntoId: primary.id, version: { increment: 1 } } });
      for (const model of ['contact', 'lead', 'deal', 'quotation', 'invoice', 'meeting'] as const) {
        await (tx[model] as unknown as { updateMany: (a: { where: object; data: object }) => Promise<unknown> }).updateMany({ where: { companyId: { in: ids } }, data: { companyId: primary.id } });
      }
      await tx.company.update({
        where: { id: primary.id },
        data: {
          name: m.name,
          industry: m.industry,
          website: m.website,
          phone: m.phone,
          email: m.email,
          gstin: m.gstin,
          pan: m.pan,
          ownerId: m.ownerId,
          billingAddress: jsonOrNull(m.billingAddress),
          shippingAddress: jsonOrNull(m.shippingAddress),
          city: billing?.city ?? primary.city,
          state: billing?.state ?? primary.state,
          stateCode: billing?.stateCode ?? primary.stateCode,
          additionalPhones: dedupePoints(all.flatMap((r) => [...(r.phone ? [{ label: 'work' as const, value: r.phone }] : []), ...parsePhones(r.additionalPhones)]), m.phone),
          additionalEmails: dedupePoints(all.flatMap((r) => [...(r.email ? [{ label: 'work' as const, value: r.email }] : []), ...parseEmails(r.additionalEmails)]), m.email, (v) => v.toLowerCase()),
          tags: normalizeTags(all.flatMap((r) => r.tags)),
          customFields: all.reduceRight<CustomFieldValues>((acc, r) => ({ ...parseCustom(r.customFields), ...acc }), {}) as Prisma.InputJsonObject,
          lastActivityAt: now,
          version: { increment: 1 },
        },
      });
      await tx.crmNote.updateMany({ where: { entityType: 'account', entityId: { in: ids } }, data: { entityId: primary.id } });
    });
    const row = await db.company.findUniqueOrThrow({ where: { id: primary.id }, include: ACCOUNT_INCLUDE });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'account.merge', entityType: 'account', entityId: primary.id, diff: { mergedIds: ids } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'account.merged', wid, { primaryId: primary.id, mergedIds: ids }, { actor: actor.event });
    await publishSafe(this.events, this.logger, 'account.updated', wid, { account: await this.listItem(db, row), changed: ['merged'] }, { actor: actor.event });
    return this.present(db, auth, row);
  }

  // ---------------------------------------------------------------- bulk

  async bulk(auth: AuthContext, req: Request, body: CrmBulkAction): Promise<BulkResult> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    if (body.action === 'assign') {
      if (body.ownerId !== auth.userId) requirePermission(auth, 'leads.assign', 'You cannot assign accounts to other users');
      await this.assignable(db, auth, body.ownerId, null);
    }
    if (body.action === 'delete') requirePermission(auth, 'accounts.delete', 'You cannot delete accounts');
    const ids = [...new Set(body.ids)];
    const visible = await db.company.findMany({ where: { AND: [{ id: { in: ids } }, await this.visibleWhere(auth)] }, select: { id: true, tags: true } });
    const ok = new Set(visible.map((v) => v.id));
    const failed = ids.filter((i) => !ok.has(i)).map((i) => ({ id: i, code: 'NOT_FOUND', message: 'Account not found' }));
    if (body.action === 'delete') {
      for (const v of visible) await this.remove(auth, req, v.id);
      return { succeeded: visible.length, failed };
    }
    for (const v of visible) {
      const data: Prisma.CompanyUncheckedUpdateManyInput =
        body.action === 'assign' ? { ownerId: body.ownerId } : body.action === 'add_tags' ? { tags: normalizeTags([...v.tags, ...body.tags]) } : { tags: v.tags.filter((t) => !body.tags.includes(t)) };
      await db.company.updateMany({ where: { id: v.id }, data: { ...data, version: { increment: 1 } } });
    }
    if (visible.length) {
      const rows = await db.company.findMany({ where: { id: { in: [...ok] } }, include: ACCOUNT_INCLUDE });
      const values = await this.openValues(db, [...ok]);
      const actor = await requestActor(db, auth);
      for (const r of rows) await publishSafe(this.events, this.logger, 'account.updated', wid, { account: toAccountListItem(r, values.get(r.id) ?? 0), changed: [body.action === 'assign' ? 'ownerId' : 'tags'] }, { actor: actor.event });
    }
    return { succeeded: visible.length, failed };
  }

  async touch(db: TenantDb, id: string, at = new Date()): Promise<void> {
    await db.company.updateMany({ where: { id }, data: { lastActivityAt: at } });
  }
}
