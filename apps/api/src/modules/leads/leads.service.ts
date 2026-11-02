import { Injectable, Logger } from '@nestjs/common';
import {
  LeadListQuerySchema,
  SavedViewSchema,
  type Activity,
  type CursorPaginationQuery,
  type CustomFieldValues,
  type FieldDefinition,
  type Lead as LeadDto,
  type LeadCreate,
  type LeadListItem,
  type LeadListQuery,
  type LeadUpdate,
  type NoteCreate,
  type Page,
  type Utm,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Lead as LeadRow, Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { applyPatch, changedKeys, loadFieldDefs, roleKeyOf, validateValues, visibleFor } from '../customization/custom-values.js';
import { entityUniqueErrors, lockUnique, uniqueDefsIn } from '../customization/unique.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RoutingService, type RoutedOwner } from '../routing/routing.service.js';
import { ActivityService } from './activity.service.js';
import { LEAD_DETAIL_INCLUDE, LEAD_LIST_INCLUDE, parseCustomFields, toLead, toLeadListItem, type LeadDetailRow } from './lead.mapper.js';
import { endOfColumn, topOfColumn } from './lead-position.js';
import { buildLeadWhere, leadCursorWhere, leadNextCursor, leadOrderBy } from './lead-query.js';
import { scoreLead } from './lead-score.js';
import { activeStageOrThrow, stageDates, syncDealsForStage } from './lead-stage.js';
import { afterTimeCursor, nextTimeCursor } from './lib/cursor.js';
import { publishSafe, requestActor, requirePermission, type RequestActor, type TenantDb } from './lib/context.js';

/** Internal options of LeadsService.create (capture forms, system callers). */
export interface LeadCreateOptions {
  captureFormId?: string;
  formName?: string;
  utm?: Utm;
  /** Actor for events and activities (e.g. a capture form instead of a user). */
  actor?: RequestActor;
  skipRouting?: boolean;
  /** false = no lead_assigned notification to the owner (capture form setting notifyOwner). */
  notify?: boolean;
}

/** Text fields copied from create/update input; '' clears the value. */
const TEXT_FIELDS = ['companyName', 'phone', 'email', 'city', 'state', 'productInterest', 'requirement'] as const;

export const normalizeTags = (tags: readonly string[]): string[] => [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
const emptyToNull = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === '' ? null : v.trim());

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly activities: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly routing: RoutingService,
  ) {}

  /** Tell the new owner about leads assigned to them by someone else (one notification per call). */
  async notifyAssigned(auth: AuthContext, actor: RequestActor, leads: Array<{ id: string; name: string; companyName: string | null }>, toUserId: string | null): Promise<void> {
    if (!toUserId || toUserId === auth.userId || !leads.length) return;
    const by = actor.summary?.name ?? 'A teammate';
    const single = leads.length === 1 ? leads[0]! : null;
    await this.notifications.notify(
      auth.workspaceId,
      toUserId,
      {
        type: 'lead_assigned',
        title: single ? `New lead: ${single.name}` : `${leads.length} leads assigned to you`,
        body: single ? `${by} assigned ${single.name}${single.companyName ? ` (${single.companyName})` : ''} to you` : `Assigned by ${by}`,
        path: single ? `/leads?lead=${single.id}` : '/leads?ownerId=me',
        data: { leadIds: leads.slice(0, 100).map((l) => l.id) },
      },
      actor.event,
    );
  }

  // ------------------------------------------------------------------ list

  /** Apply a saved view (`viewId`): stored filters first, explicit query params override them. */
  async resolveView<S extends z.ZodType>(auth: AuthContext, parsed: z.output<S> & { viewId?: string }, raw: Record<string, unknown>, schema: S): Promise<z.output<S>> {
    if (!parsed.viewId) return parsed;
    const view = await this.prisma.forTenant(auth.workspaceId).savedView.findFirst({
      where: { id: parsed.viewId, entity: 'lead', OR: [{ isShared: true }, ...(auth.userId ? [{ ownerId: auth.userId }] : [])] },
    });
    if (!view) throw notFound('Saved view');
    const stored = SavedViewSchema.shape.filters.safeParse(view.filters);
    const explicit = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''));
    const merged = schema.safeParse({ ...(stored.success ? stored.data : {}), ...explicit });
    if (!merged.success) throw new AppException('VALIDATION_FAILED', 'This saved view has invalid filters');
    return merged.data;
  }

  async list(auth: AuthContext, query: LeadListQuery, raw: Record<string, unknown>): Promise<Page<LeadListItem> & { total: number }> {
    const q = await this.resolveView(auth, query, raw, LeadListQuerySchema);
    const db = this.prisma.forTenant(auth.workspaceId);
    const base = await buildLeadWhere(auth, this.scope, q);
    const [{ rows, nextCursor }, total] = await Promise.all([this.page(db, base, q), db.lead.count({ where: base })]);
    return { items: rows.map(toLeadListItem), nextCursor, total };
  }

  /** One keyset page in (sort, id) order. Also used by the export stream. */
  async page(db: TenantDb, base: Prisma.LeadWhereInput, q: Pick<LeadListQuery, 'sort' | 'dir' | 'limit' | 'cursor'>) {
    const after = leadCursorWhere(q.cursor, q.sort, q.dir);
    const found = await db.lead.findMany({
      where: after ? { AND: [base, after] } : base,
      orderBy: leadOrderBy(q.sort, q.dir),
      take: q.limit + 1,
      include: LEAD_LIST_INCLUDE,
    });
    const rows = found.slice(0, q.limit);
    const last = rows.at(-1);
    return { rows, nextCursor: found.length > q.limit && last ? leadNextCursor(last, q.sort, q.dir) : null };
  }

  // ------------------------------------------------------------------ detail helpers

  /** Lead visible to the caller (tenant + data scope + not deleted), else NOT_FOUND. */
  async loadVisible(db: TenantDb, auth: AuthContext, id: string): Promise<LeadRow> {
    const lead = await db.lead.findFirst({ where: { id, deletedAt: null } });
    if (!lead || !(await this.scope.canSee(auth, lead.ownerId))) throw notFound('Lead');
    return lead;
  }

  async detail(db: TenantDb, id: string): Promise<LeadDetailRow> {
    return db.lead.findUniqueOrThrow({ where: { id }, include: LEAD_DETAIL_INCLUDE });
  }

  /** Owner ids must be active members of the workspace. */
  async assertAssignable(db: TenantDb, userId: string): Promise<void> {
    const ok = await db.user.count({ where: { id: userId, isActive: true, deletedAt: null } });
    if (ok !== 1) throw notFound('User');
  }

  /** First stage of the default pipeline (or of the oldest pipeline when none is marked default). Archived pipelines and stages are skipped. */
  async defaultStage(db: TenantDb) {
    const pipeline =
      (await db.pipeline.findFirst({ where: { isDefault: true, archivedAt: null, entity: 'lead' }, orderBy: { createdAt: 'asc' } })) ??
      (await db.pipeline.findFirst({ where: { archivedAt: null, entity: 'lead' }, orderBy: { createdAt: 'asc' } }));
    const stage = pipeline ? await db.stage.findFirst({ where: { pipelineId: pipeline.id, archivedAt: null }, orderBy: { order: 'asc' } }) : null;
    if (!stage) throw new AppException('STAGE_NOT_IN_PIPELINE', 'Set up a pipeline with at least one stage first');
    return stage;
  }

  // ------------------------------------------------------------------ custom fields

  /** Lead DTO for the caller: custom values hidden for the caller's role are removed. */
  async present(db: TenantDb, auth: AuthContext, row: LeadDetailRow, defs?: FieldDefinition[]): Promise<LeadDto> {
    const [fieldDefs, roleKey] = await Promise.all([defs ?? loadFieldDefs(db, 'lead'), roleKeyOf(db, auth)]);
    const dto = toLead(row);
    return { ...dto, customFields: visibleFor(fieldDefs, dto.customFields, roleKey) };
  }

  /** Unique lead custom fields (inside the write transaction, serialised per workspace). */
  async assertUniqueCustom(tx: TenantDb, workspaceId: string, defs: FieldDefinition[], values: CustomFieldValues, opts: { excludeId?: string; keys?: string[] } = {}): Promise<void> {
    if (!uniqueDefsIn(defs, values, opts.keys).length) return;
    await lockUnique(tx, `lead-unique:${workspaceId}`);
    const errors = await entityUniqueErrors(tx, 'lead', defs, values, { ...opts, pathPrefix: 'customFields' });
    if (errors.length) throw new AppException('FIELD_VALUE_NOT_UNIQUE', 'Another lead already uses one of these values', { details: errors });
  }

  /** Link (or create) the Contact for a lead: by phone (unique), else by email, else a new contact. */
  async linkContact(db: TenantDb, workspaceId: string, c: { name: string; phone: string | null; email: string | null; city: string | null }): Promise<string> {
    if (c.phone) {
      const contact = await db.contact.upsert({
        where: { workspaceId_phone: { workspaceId, phone: c.phone } },
        create: { workspaceId, name: c.name, phone: c.phone, email: c.email, city: c.city },
        update: {},
        select: { id: true },
      });
      return contact.id;
    }
    if (c.email) {
      const existing = await db.contact.findFirst({ where: { email: c.email, deletedAt: null }, select: { id: true } });
      if (existing) return existing.id;
    }
    const created = await db.contact.create({ data: { workspaceId, name: c.name, email: c.email, city: c.city }, select: { id: true } });
    return created.id;
  }

  /** Keep the workspace tag catalogue (Tag table) in step with tags used on leads. */
  async ensureTags(db: TenantDb, workspaceId: string, tags: readonly string[]): Promise<void> {
    if (!tags.length) return;
    await db.tag.createMany({ data: [...new Set(tags)].map((name) => ({ workspaceId, name })), skipDuplicates: true });
  }

  // ------------------------------------------------------------------ CRUD

  async get(auth: AuthContext, id: string): Promise<LeadDto> {
    const db = this.prisma.forTenant(auth.workspaceId);
    await this.loadVisible(db, auth, id);
    return this.present(db, auth, await this.detail(db, id));
  }

  /**
   * Create a lead. Without an owner (admin or API key create without ownerId, capture forms, webhooks)
   * lead routing picks one (RoutingService; change #19 wave B).
   */
  async create(auth: AuthContext, body: LeadCreate, opts: LeadCreateOptions = {}): Promise<LeadDto> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const actor = opts.actor ?? (await requestActor(db, auth));

    let ownerId = body.ownerId ?? (auth.dataScope !== 'all' ? auth.userId : null);
    if (ownerId && ownerId !== auth.userId) requirePermission(auth, 'leads.assign', 'You cannot assign leads to other users');
    if (ownerId) await this.assertAssignable(db, ownerId);
    let routed: RoutedOwner | null = null;
    if (!ownerId && body.ownerId === undefined && !opts.skipRouting) {
      routed = await this.routing.assign(wid, {
        source: body.source,
        city: body.city ?? null,
        state: body.state ?? null,
        productInterest: body.productInterest ?? null,
        requirement: body.requirement ?? null,
        valueInr: body.valueInr,
        tags: body.tags,
        captureFormId: opts.captureFormId ?? null,
      });
      ownerId = routed.ownerId;
    }

    const stage = body.stageId ? await activeStageOrThrow(db, body.stageId) : await this.defaultStage(db);
    const defs = await loadFieldDefs(db, 'lead');
    const customFields = applyPatch({}, await validateValues(db, auth, defs, body.customFields, { mode: 'create', pathPrefix: 'customFields' }));

    const sourceRef = emptyToNull(body.sourceRef);
    if (sourceRef && (await db.lead.count({ where: { source: body.source, sourceRef } }))) {
      throw new AppException('LEAD_DUPLICATE', 'A lead with this source reference already exists');
    }

    const now = new Date();
    const fields = {
      name: body.name.trim(),
      companyName: emptyToNull(body.companyName),
      phone: emptyToNull(body.phone),
      email: emptyToNull(body.email)?.toLowerCase() ?? null,
      city: emptyToNull(body.city),
      state: emptyToNull(body.state),
      productInterest: emptyToNull(body.productInterest),
      requirement: emptyToNull(body.requirement),
    };
    const tags = normalizeTags(body.tags);
    const scored = scoreLead({ ...fields, source: body.source, valueInr: body.valueInr, tags, createdAt: now, lastActivityAt: null }, now);

    const { lead, rows } = await db.$transaction(async (tx) => {
      await this.assertUniqueCustom(tx, wid, defs, customFields);
      const contactId = await this.linkContact(tx, wid, fields);
      const position = await topOfColumn(tx, stage.id);
      const created = await tx.lead.create({
        data: {
          workspaceId: wid,
          ...fields,
          source: body.source,
          sourceRef,
          ownerId,
          pipelineId: stage.pipelineId,
          stageId: stage.id,
          position,
          valueInr: body.valueInr,
          score: scored.score,
          scoreBreakdown: scored.breakdown,
          temperature: scored.temperature,
          tags,
          customFields: customFields as Prisma.InputJsonObject,
          contactId,
          ...stageDates(stage.type, now),
          createdAt: now,
        },
      });
      if (stage.type === 'won') await syncDealsForStage(tx, wid, [created], 'won', now);
      const rows = await tx.activity.createManyAndReturn({
        data: [
          this.activities.data(wid, actor, created.id, 'lead_created', { source: body.source, ...(opts.captureFormId ? { formId: opts.captureFormId, formName: opts.formName, utm: opts.utm } : {}) }, now),
          ...(ownerId ? [this.activities.data(wid, actor, created.id, 'assigned', { fromUserId: null, toUserId: ownerId, rule: routed?.rule ?? 'manual' }, now)] : []),
        ],
      });
      return { lead: await this.detail(tx, created.id), rows };
    });

    await this.ensureTags(db, wid, tags);
    await publishSafe(this.events, this.logger, 'lead.created', wid, { lead: toLeadListItem(lead) }, { actor: actor.event });
    if (routed?.ownerId) await publishSafe(this.events, this.logger, 'lead.assigned', wid, { lead: toLeadListItem(lead), fromUserId: null, toUserId: routed.ownerId, rule: routed.rule }, { actor: actor.event });
    await this.activities.publishCreated(db, wid, rows, actor);
    if (opts.notify !== false) await this.notifyAssigned(auth, actor, [lead], ownerId);
    return this.present(db, auth, lead, defs);
  }

  async update(auth: AuthContext, id: string, body: LeadUpdate): Promise<LeadDto> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const current = await this.loadVisible(db, auth, id);
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) {
      throw new AppException('VERSION_CONFLICT', 'Someone else changed this lead. Reload to see the latest version.');
    }
    const actor = await requestActor(db, auth);
    const now = new Date();

    const data: Prisma.LeadUncheckedUpdateManyInput = {};
    const fieldChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
    const set = <K extends keyof LeadRow>(field: K, to: LeadRow[K], from: LeadRow[K] = current[field]) => {
      (data as Record<string, unknown>)[field] = to;
      fieldChanges.push({ field, from: from instanceof Date ? from.toISOString() : from, to: to instanceof Date ? to.toISOString() : to });
    };

    if (body.name !== undefined && body.name.trim() !== current.name) set('name', body.name.trim());
    for (const f of TEXT_FIELDS) {
      if (body[f] === undefined) continue;
      const next = f === 'email' ? (emptyToNull(body[f])?.toLowerCase() ?? null) : emptyToNull(body[f]);
      if (next !== current[f]) set(f, next);
    }
    if (body.valueInr !== undefined && body.valueInr !== current.valueInr) set('valueInr', body.valueInr);
    if (body.tags !== undefined) {
      const next = normalizeTags(body.tags);
      if (next.length !== current.tags.length || next.some((t) => !current.tags.includes(t))) set('tags', next);
    }
    let defs: FieldDefinition[] | undefined;
    let customKeys: string[] = [];
    let nextCustom: CustomFieldValues | null = null;
    if (body.customFields !== undefined) {
      defs = await loadFieldDefs(db, 'lead');
      const prev = parseCustomFields(current.customFields);
      const next = applyPatch(prev, await validateValues(db, auth, defs, body.customFields, { mode: 'update', pathPrefix: 'customFields' }));
      customKeys = changedKeys(prev, next);
      if (customKeys.length) {
        nextCustom = next;
        set('customFields', next as Prisma.JsonObject, prev as Prisma.JsonObject);
      }
    }
    if (body.nextFollowUpAt !== undefined) {
      const next = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;
      if ((next?.getTime() ?? null) !== (current.nextFollowUpAt?.getTime() ?? null)) set('nextFollowUpAt', next);
    }

    // owner
    let ownerChanged = false;
    if (body.ownerId !== undefined && body.ownerId !== current.ownerId) {
      requirePermission(auth, 'leads.assign', 'You cannot reassign leads');
      if (body.ownerId) await this.assertAssignable(db, body.ownerId);
      data.ownerId = body.ownerId;
      ownerChanged = true;
    }

    // stage
    let newStage: { id: string; pipelineId: string; type: LeadDto['stageType'] } | null = null;
    if (body.stageId !== undefined && body.stageId !== current.stageId) {
      newStage = await activeStageOrThrow(db, body.stageId);
      Object.assign(data, { stageId: newStage.id, pipelineId: newStage.pipelineId, lastActivityAt: now, ...stageDates(newStage.type, now) });
    }

    if (!fieldChanges.length && !ownerChanged && !newStage) return this.present(db, auth, await this.detail(db, id), defs);

    const merged = { ...current, ...(data as Partial<LeadRow>) };
    const scored = scoreLead(merged, now);
    if (scored.score !== current.score || scored.temperature !== current.temperature) {
      Object.assign(data, { score: scored.score, temperature: scored.temperature });
    }
    data.scoreBreakdown = scored.breakdown;

    const { lead, rows } = await db.$transaction(async (tx) => {
      if (nextCustom && defs) await this.assertUniqueCustom(tx, wid, defs, nextCustom, { excludeId: id, keys: customKeys });
      if (newStage) data.position = await endOfColumn(tx, newStage.id, id);
      const res = await tx.lead.updateMany({ where: { id, version: current.version, deletedAt: null }, data: { ...data, version: { increment: 1 } } });
      if (res.count !== 1) throw new AppException('VERSION_CONFLICT', 'Someone else changed this lead. Reload to see the latest version.');
      if (data.phone !== undefined && merged.phone) {
        const contactId = await this.linkContact(tx, wid, { name: merged.name, phone: merged.phone, email: merged.email, city: merged.city });
        if (contactId !== current.contactId) await tx.lead.update({ where: { id }, data: { contactId } });
      }
      if (newStage) await syncDealsForStage(tx, wid, [merged], newStage.type, now);
      const acts: Prisma.ActivityUncheckedCreateInput[] = fieldChanges.map((c) => this.activities.data(wid, actor, id, 'field_updated', c, now));
      if (ownerChanged) acts.push(this.activities.data(wid, actor, id, 'assigned', { fromUserId: current.ownerId, toUserId: data.ownerId as string | null, rule: 'manual' }, now));
      if (newStage) acts.push(this.activities.data(wid, actor, id, 'stage_changed', { fromStageId: current.stageId, toStageId: newStage.id }, now));
      const rows = acts.length ? await tx.activity.createManyAndReturn({ data: acts }) : [];
      return { lead: await this.detail(tx, id), rows };
    });

    if (Array.isArray(data.tags)) await this.ensureTags(db, wid, data.tags as string[]);
    const item = toLeadListItem(lead);
    const changed = Object.keys(data).filter((k) => k !== 'scoreBreakdown');
    await publishSafe(this.events, this.logger, 'lead.updated', wid, { lead: item, changed }, { actor: actor.event });
    if (ownerChanged) {
      await publishSafe(this.events, this.logger, 'lead.assigned', wid, { lead: item, fromUserId: current.ownerId, toUserId: lead.ownerId, rule: 'manual' }, { actor: actor.event });
      await this.notifyAssigned(auth, actor, [lead], lead.ownerId);
    }
    if (newStage) {
      await publishSafe(this.events, this.logger, 'stage.changed', wid, { lead: item, fromStageId: current.stageId, toStageId: lead.stageId, position: lead.position }, { actor: actor.event });
    }
    await this.activities.publishCreated(db, wid, rows, actor);
    return this.present(db, auth, lead, defs);
  }

  async remove(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const lead = await this.loadVisible(db, auth, id);
    const res = await db.lead.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    if (res.count !== 1) throw notFound('Lead');
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'lead.delete', entityType: 'lead', entityId: id, diff: { stageId: lead.stageId, ownerId: lead.ownerId } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'lead.deleted', wid, { leadIds: [id] }, { actor: actor.event });
    return { ok: true };
  }

  // ------------------------------------------------------------------ duplicates, timeline, notes

  async duplicates(auth: AuthContext, id: string): Promise<{ items: LeadListItem[] }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const lead = await this.loadVisible(db, auth, id);
    const or: Prisma.LeadWhereInput[] = [];
    if (lead.phone) or.push({ phone: lead.phone });
    if (lead.email) or.push({ email: { equals: lead.email, mode: 'insensitive' } });
    if (lead.companyName) {
      or.push({ name: { equals: lead.name, mode: 'insensitive' }, companyName: { equals: lead.companyName, mode: 'insensitive' } });
    }
    if (!or.length) return { items: [] };
    const base = await buildLeadWhere(auth, this.scope, {});
    const rows = await db.lead.findMany({
      where: { AND: [base, { id: { not: id } }, { OR: or }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      include: LEAD_LIST_INCLUDE,
    });
    return { items: rows.map(toLeadListItem) };
  }

  async timeline(auth: AuthContext, id: string, q: CursorPaginationQuery): Promise<Page<Activity>> {
    const db = this.prisma.forTenant(auth.workspaceId);
    await this.loadVisible(db, auth, id);
    const rows = await db.activity.findMany({
      where: { leadId: id, ...afterTimeCursor(q.cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return { items: await this.activities.toDtos(db, rows.slice(0, q.limit)), nextCursor: nextTimeCursor(rows, q.limit) };
  }

  async addNote(auth: AuthContext, id: string, body: NoteCreate): Promise<Activity> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    await this.loadVisible(db, auth, id);
    const actor = await requestActor(db, auth);
    const now = new Date();
    const { row, lead } = await db.$transaction(async (tx) => {
      const row = await tx.activity.create({ data: this.activities.data(wid, actor, id, 'note', { body: body.body }, now) });
      await tx.lead.update({ where: { id }, data: { lastActivityAt: now, version: { increment: 1 } } });
      return { row, lead: await tx.lead.findUniqueOrThrow({ where: { id }, include: LEAD_LIST_INCLUDE }) };
    });
    const [activity] = await this.activities.toDtos(db, [row], actor.summary);
    if (!activity) throw new AppException('INTERNAL_ERROR', 'Could not save the note');
    await publishSafe(this.events, this.logger, 'activity.created', wid, { activity }, { actor: actor.event });
    await publishSafe(this.events, this.logger, 'lead.updated', wid, { lead: toLeadListItem(lead), changed: ['lastActivityAt'] }, { actor: actor.event });
    return activity;
  }
}
