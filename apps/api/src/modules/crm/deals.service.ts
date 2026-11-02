import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_DEAL_PIPELINE_KEY,
  DEFAULT_DEAL_STAGES,
  type BulkResult,
  type Deal,
  type DealBoard,
  type DealBoardQuery,
  type DealBulkAction,
  type DealCreate,
  type DealFilters,
  type DealListItem,
  type DealListQuery,
  type DealMove,
  type DealUpdate,
  type LineItemInput,
  type Page,
  type Pipeline,
  type StageType,
} from '@vistar/shared';
import { generateKeyBetween } from 'fractional-indexing';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { assertInTenant, type TenantPrisma } from '../../infra/prisma/tenant.js';
import { computeLines, resolveLines, type ComputedLine } from '../catalog/line-resolver.js';
import { applyPatch, changedKeys, loadFieldDefs, roleKeyOf, validateValues, visibleFor } from '../customization/custom-values.js';
import { publishSafe, requestActor, requirePermission, type TenantDb } from '../leads/lib/context.js';
import { toPipeline, toStage } from '../pipeline/pipeline.mapper.js';
import { DEAL_DETAIL_INCLUDE, DEAL_LIST_INCLUDE, toDeal, toDealListItem, toLineItem, type DealDetailRow, type DealListRow } from './crm.mapper.js';
import { isUniqueViolation, sortBy } from './lib/db.js';
import { and, ownerFilter, ownerScope, pageArgs, pageOut } from './lib/paging.js';
import { emptyToNull, num, parseCustom } from './lib/values.js';

const versionConflict = () => new AppException('VERSION_CONFLICT', 'Someone else changed this deal. Reload to see the latest version.');
const COLUMN_ORDER: Prisma.DealOrderByWithRelationInput[] = [{ position: 'asc' }, { id: 'asc' }];

function between(a: string | null, b: string | null): string {
  try {
    return generateKeyBetween(a, b);
  } catch {
    try {
      return generateKeyBetween(a, null);
    } catch {
      return generateKeyBetween(null, null);
    }
  }
}

/** Deal value in whole rupees from the line taxable values. */
const valueFromLines = (lines: readonly ComputedLine[]): number => Math.round(lines.reduce((s, l) => s + l.taxablePaise, 0) / 100);

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);
  /** Workspaces whose default deal pipeline exists and legacy deals are placed (per process). */
  private readonly ready = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- deal pipeline

  /**
   * The default deal pipeline (key `deals`, DEFAULT_DEAL_STAGES), created on first use, plus a backfill
   * that places deals without a stage (legacy rows, deals auto-created by lead moves) by their status.
   */
  async ensurePipeline(workspaceId: string): Promise<{ id: string }> {
    const db = this.prisma.forTenant(workspaceId);
    let pipeline = await db.pipeline.findFirst({ where: { entity: 'deal', archivedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true } });
    if (!pipeline) {
      try {
        pipeline = await db.$transaction(async (tx) => {
          const p = await tx.pipeline.create({ data: { workspaceId, key: DEFAULT_DEAL_PIPELINE_KEY, name: 'Deals', entity: 'deal', isDefault: false }, select: { id: true } });
          await tx.stage.createMany({ data: DEFAULT_DEAL_STAGES.map((s, order) => ({ workspaceId, pipelineId: p.id, key: s.key, name: s.name, type: s.type, probability: s.probability, order })) });
          return p;
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        pipeline = await db.pipeline.findFirstOrThrow({ where: { key: DEFAULT_DEAL_PIPELINE_KEY }, select: { id: true } });
      }
    }
    if (!this.ready.has(workspaceId) || (await db.deal.count({ where: { stageId: null } }))) {
      const stages = await db.stage.findMany({ where: { pipelineId: pipeline.id, archivedAt: null }, orderBy: { order: 'asc' } });
      for (const type of ['open', 'won', 'lost'] as const) {
        const stage = stages.find((s) => s.type === type);
        if (stage) await db.deal.updateMany({ where: { stageId: null, status: type }, data: { stageId: stage.id, pipelineId: pipeline.id } });
      }
      this.ready.add(workspaceId);
    }
    return pipeline;
  }

  async pipelines(workspaceId: string): Promise<{ items: Pipeline[] }> {
    await this.ensurePipeline(workspaceId);
    const rows = await this.prisma.forTenant(workspaceId).pipeline.findMany({
      where: { entity: 'deal', archivedAt: null },
      include: { stages: { where: { archivedAt: null }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return { items: rows.map(toPipeline) };
  }

  /** An active stage of a deal pipeline. */
  private async dealStage(db: TenantDb, stageId: string, pipelineId?: string) {
    const stage = await db.stage.findFirst({ where: { id: stageId, archivedAt: null, pipeline: { entity: 'deal', archivedAt: null } } });
    if (!stage || (pipelineId && stage.pipelineId !== pipelineId)) throw new AppException('STAGE_NOT_IN_PIPELINE', 'That stage is not on the deal pipeline');
    return stage;
  }

  private async firstOpenStage(db: TenantDb, pipelineId: string) {
    const stage = await db.stage.findFirst({ where: { pipelineId, archivedAt: null, type: 'open' }, orderBy: { order: 'asc' } });
    if (!stage) throw new AppException('STAGE_NOT_IN_PIPELINE', 'Add an open stage to the deal pipeline first');
    return stage;
  }

  // ---------------------------------------------------------------- reads

  async visibleWhere(auth: AuthContext): Promise<Prisma.DealWhereInput> {
    return and<Prisma.DealWhereInput>({ deletedAt: null }, await ownerScope(this.scope, auth));
  }

  async loadVisible(db: TenantDb, auth: AuthContext, id: string): Promise<DealDetailRow> {
    const row = await db.deal.findFirst({ where: { AND: [{ id }, await this.visibleWhere(auth)] }, include: DEAL_DETAIL_INCLUDE });
    if (!row) throw notFound('Deal');
    return row;
  }

  async present(db: TenantDb, auth: AuthContext, row: DealDetailRow): Promise<Deal> {
    const [defs, roleKey] = await Promise.all([loadFieldDefs(db, 'deal'), roleKeyOf(db, auth)]);
    const dto = toDeal(
      row,
      row.lines.map((l) => {
        const taxable = num(l.taxablePaise);
        return toLineItem(l, { grossPaise: taxable, discountPaise: 0, taxablePaise: taxable, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: taxable });
      }),
    );
    // gross and discount from the stored inputs (the GST split depends on the document, not the deal)
    dto.lines = dto.lines.map((l) => {
      const gross = Math.round(l.quantity * l.unitPricePaise);
      return { ...l, grossPaise: gross, discountPaise: gross - l.taxablePaise };
    });
    return { ...dto, customFields: visibleFor(defs, dto.customFields, roleKey) };
  }

  private async filtersWhere(auth: AuthContext, q: DealFilters, pipelineId: string): Promise<Prisma.DealWhereInput> {
    const text = q.q?.trim();
    return and<Prisma.DealWhereInput>(
      await this.visibleWhere(auth),
      { pipelineId },
      ownerFilter(auth, q.ownerId),
      q.stageId?.length ? { stageId: { in: q.stageId } } : null,
      q.status?.length ? { status: { in: q.status } } : null,
      q.accountId ? { companyId: q.accountId } : null,
      q.contactId ? { contactId: q.contactId } : null,
      q.leadId ? { leadId: q.leadId } : null,
      q.valueMin !== undefined || q.valueMax !== undefined ? { valueInr: { ...(q.valueMin !== undefined ? { gte: q.valueMin } : {}), ...(q.valueMax !== undefined ? { lte: q.valueMax } : {}) } } : null,
      q.expectedCloseFrom || q.expectedCloseTo
        ? { expectedCloseAt: { ...(q.expectedCloseFrom ? { gte: new Date(q.expectedCloseFrom) } : {}), ...(q.expectedCloseTo ? { lt: new Date(q.expectedCloseTo) } : {}) } }
        : null,
      text
        ? { OR: [{ title: { contains: text, mode: 'insensitive' } }, { company: { name: { contains: text, mode: 'insensitive' } } }, { contact: { name: { contains: text, mode: 'insensitive' } } }] }
        : null,
    );
  }

  async list(auth: AuthContext, q: DealListQuery): Promise<Page<DealListItem> & { total: number }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const pipelineId = q.pipelineId ?? (await this.ensurePipeline(auth.workspaceId)).id;
    if (q.pipelineId) await this.ensurePipeline(auth.workspaceId);
    const where = await this.filtersWhere(auth, q, pipelineId);
    const { skip, take } = pageArgs(q.cursor, q.limit);
    const [rows, total] = await Promise.all([
      db.deal.findMany({ where, orderBy: sortBy<Prisma.DealOrderByWithRelationInput[]>(q.sort, q.dir, ['expectedCloseAt']), skip, take, include: DEAL_LIST_INCLUDE }),
      db.deal.count({ where }),
    ]);
    const page = pageOut(rows, skip, q.limit);
    return { items: page.rows.map(toDealListItem), nextCursor: page.nextCursor, total };
  }

  async board(auth: AuthContext, q: DealBoardQuery): Promise<DealBoard> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const def = await this.ensurePipeline(auth.workspaceId);
    const pipeline = await db.pipeline.findFirst({
      where: { id: q.pipelineId ?? def.id, entity: 'deal' },
      include: { stages: { where: { archivedAt: null }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!pipeline) throw notFound('Pipeline');
    const where = await this.filtersWhere(auth, q, pipeline.id);
    const [groups, overrides] = await Promise.all([
      db.deal.groupBy({ by: ['stageId'], where, _count: { _all: true }, _sum: { valueInr: true } }),
      db.deal.findMany({ where: { AND: [where, { probability: { not: null } }] }, select: { stageId: true, valueInr: true, probability: true } }),
    ]);
    const columns = await Promise.all(
      pipeline.stages.map(async (stage) => {
        const g = groups.find((x) => x.stageId === stage.id);
        const total = g?._sum.valueInr ?? 0;
        const own = overrides.filter((o) => o.stageId === stage.id);
        const ownValue = own.reduce((s, o) => s + o.valueInr, 0);
        const stageProb = stage.type === 'won' ? 100 : stage.type === 'lost' ? 0 : stage.probability;
        const weighted = Math.round(((total - ownValue) * stageProb) / 100 + own.reduce((s, o) => s + (o.valueInr * (stage.type === 'open' ? (o.probability ?? 0) : stageProb)) / 100, 0));
        const rows = g ? await db.deal.findMany({ where: { AND: [where, { stageId: stage.id }] }, orderBy: COLUMN_ORDER, take: q.perColumn + 1, include: DEAL_LIST_INCLUDE }) : [];
        const page = pageOut(rows, 0, q.perColumn);
        return { stage: toStage(stage), count: g?._count._all ?? 0, totalValueInr: total, weightedValueInr: weighted, deals: page.rows.map(toDealListItem), nextCursor: page.nextCursor };
      }),
    );
    return { pipeline: toPipeline(pipeline), columns };
  }

  async get(auth: AuthContext, id: string): Promise<Deal> {
    const db = this.prisma.forTenant(auth.workspaceId);
    await this.ensurePipeline(auth.workspaceId);
    return this.present(db, auth, await this.loadVisible(db, auth, id));
  }

  // ---------------------------------------------------------------- writes

  private async assignable(db: TenantDb, auth: AuthContext, ownerId: string | null | undefined, current: string | null): Promise<void> {
    if (ownerId === undefined || ownerId === current) return;
    if (ownerId !== auth.userId) requirePermission(auth, 'leads.assign', 'You cannot assign deals to other users');
    if (ownerId && (await db.user.count({ where: { id: ownerId, isActive: true, deletedAt: null } })) !== 1) throw notFound('User');
  }

  private async lines(db: TenantDb, inputs: readonly LineItemInput[]): Promise<ComputedLine[]> {
    if (!inputs.length) return [];
    return computeLines(await resolveLines(db, inputs), null, null).lines;
  }

  private lineData(workspaceId: string, dealId: string, lines: readonly ComputedLine[]): Prisma.DealLineCreateManyInput[] {
    return lines.map((l) => ({
      workspaceId,
      dealId,
      position: l.position,
      productId: l.productId,
      name: l.name,
      description: l.description,
      hsnSac: l.hsnSac,
      unit: l.unit,
      quantity: String(l.quantity),
      unitPricePaise: BigInt(l.unitPricePaise),
      discountKind: l.discountKind,
      discountValue: String(l.discountValue),
      gstRate: l.gstRate,
      taxablePaise: BigInt(l.taxablePaise),
    }));
  }

  private closeFields(type: StageType, now: Date, lostReason?: string | null) {
    return type === 'open' ? { status: type, closedAt: null, lostReason: null } : { status: type, closedAt: now, ...(type === 'lost' ? { lostReason: lostReason ?? null } : { lostReason: null }) };
  }

  async create(auth: AuthContext, body: DealCreate): Promise<Deal> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const def = await this.ensurePipeline(wid);
    const ownerId = body.ownerId !== undefined ? body.ownerId : auth.dataScope !== 'all' ? auth.userId : null;
    await this.assignable(db, auth, ownerId, null);
    await assertInTenant(db as TenantPrisma, { company: body.accountId, contact: body.contactId, lead: body.leadId });
    const pipelineId = body.pipelineId ?? def.id;
    const stage = body.stageId ? await this.dealStage(db, body.stageId, pipelineId) : await this.firstOpenStage(db, pipelineId);
    const defs = await loadFieldDefs(db, 'deal');
    const customFields = applyPatch({}, await validateValues(db, auth, defs, body.customFields, { mode: 'create', pathPrefix: 'customFields' }));
    const lines = await this.lines(db, body.lines);
    // contact and account default from the lead
    const lead = body.leadId ? await db.lead.findFirst({ where: { id: body.leadId }, select: { contactId: true, companyId: true } }) : null;
    const now = new Date();
    const id = await db.$transaction(async (tx) => {
      const first = await tx.deal.findFirst({ where: { stageId: stage.id }, orderBy: COLUMN_ORDER, select: { position: true } });
      const created = await tx.deal.create({
        data: {
          workspaceId: wid,
          title: body.title.trim(),
          valueInr: lines.length ? valueFromLines(lines) : body.valueInr,
          pipelineId: stage.pipelineId,
          stageId: stage.id,
          position: between(null, first?.position ?? null),
          probability: body.probability ?? null,
          ownerId,
          companyId: body.accountId ?? lead?.companyId ?? null,
          contactId: body.contactId ?? lead?.contactId ?? null,
          leadId: body.leadId ?? null,
          description: emptyToNull(body.description),
          expectedCloseAt: body.expectedCloseAt ? new Date(body.expectedCloseAt) : null,
          customFields: customFields as Prisma.InputJsonObject,
          ...this.closeFields(stage.type, now, body.lostReason),
        },
        select: { id: true },
      });
      if (lines.length) await tx.dealLine.createMany({ data: this.lineData(wid, created.id, lines) });
      return created.id;
    });
    const row = await db.deal.findUniqueOrThrow({ where: { id }, include: DEAL_DETAIL_INCLUDE });
    const actor = await requestActor(db, auth);
    await publishSafe(this.events, this.logger, 'deal.created', wid, { deal: toDealListItem(row) }, { actor: actor.event });
    return this.present(db, auth, row);
  }

  async update(auth: AuthContext, id: string, body: DealUpdate): Promise<Deal> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    await this.ensurePipeline(wid);
    const current = await this.loadVisible(db, auth, id);
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) throw versionConflict();
    await this.assignable(db, auth, body.ownerId, current.ownerId);
    await assertInTenant(db as TenantPrisma, { company: body.accountId, contact: body.contactId, lead: body.leadId });
    const now = new Date();
    const data: Record<string, unknown> = {};
    const changed: string[] = [];
    const set = (key: string, value: unknown, prev: unknown) => {
      const a = value instanceof Date ? value.getTime() : value;
      const b = prev instanceof Date ? prev.getTime() : prev;
      if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) return;
      data[key] = value;
      changed.push(key);
    };
    if (body.title !== undefined) set('title', body.title.trim(), current.title);
    if (body.ownerId !== undefined) set('ownerId', body.ownerId, current.ownerId);
    if (body.accountId !== undefined) set('companyId', body.accountId, current.companyId);
    if (body.contactId !== undefined) set('contactId', body.contactId, current.contactId);
    if (body.leadId !== undefined) set('leadId', body.leadId, current.leadId);
    if (body.expectedCloseAt !== undefined) set('expectedCloseAt', body.expectedCloseAt ? new Date(body.expectedCloseAt) : null, current.expectedCloseAt);
    if (body.probability !== undefined) set('probability', body.probability, current.probability);
    if (body.description !== undefined) set('description', emptyToNull(body.description), current.description);
    if (body.lostReason !== undefined) set('lostReason', emptyToNull(body.lostReason), current.lostReason);
    let lines: ComputedLine[] | null = null;
    if (body.lines !== undefined) {
      lines = await this.lines(db, body.lines);
      changed.push('lines');
      if (lines.length) set('valueInr', valueFromLines(lines), current.valueInr);
    }
    if (body.valueInr !== undefined && !(lines && lines.length) && !(body.lines === undefined && current.lines.length)) set('valueInr', body.valueInr, current.valueInr);
    let stageMove: { id: string; pipelineId: string; type: StageType } | null = null;
    if (body.stageId !== undefined && body.stageId !== current.stageId) {
      stageMove = await this.dealStage(db, body.stageId, current.pipelineId ?? undefined);
      changed.push('stageId');
    }
    if (body.customFields !== undefined) {
      const defs = await loadFieldDefs(db, 'deal');
      const prev = parseCustom(current.customFields);
      const next = applyPatch(prev, await validateValues(db, auth, defs, body.customFields, { mode: 'update', pathPrefix: 'customFields' }));
      if (changedKeys(prev, next).length) {
        data.customFields = next;
        changed.push('customFields');
      }
    }
    if (!changed.length) return this.present(db, auth, current);

    await db.$transaction(async (tx) => {
      if (stageMove) {
        const last = await tx.deal.findFirst({ where: { stageId: stageMove.id, id: { not: id } }, orderBy: [{ position: 'desc' }, { id: 'desc' }], select: { position: true } });
        Object.assign(data, { stageId: stageMove.id, pipelineId: stageMove.pipelineId, position: between(last?.position ?? null, null), ...this.closeFields(stageMove.type, now, (data.lostReason as string | null | undefined) ?? current.lostReason) });
      }
      const res = await tx.deal.updateMany({ where: { id, version: current.version, deletedAt: null }, data: { ...(data as Prisma.DealUncheckedUpdateManyInput), version: { increment: 1 } } });
      if (res.count !== 1) throw versionConflict();
      if (lines) {
        await tx.dealLine.deleteMany({ where: { dealId: id } });
        if (lines.length) await tx.dealLine.createMany({ data: this.lineData(wid, id, lines) });
      }
    });
    const row = await db.deal.findUniqueOrThrow({ where: { id }, include: DEAL_DETAIL_INCLUDE });
    const actor = await requestActor(db, auth);
    const item = toDealListItem(row);
    await publishSafe(this.events, this.logger, 'deal.updated', wid, { deal: item, changed }, { actor: actor.event });
    if (stageMove) await publishSafe(this.events, this.logger, 'deal.moved', wid, { deal: item, fromStageId: current.stageId, toStageId: stageMove.id, position: row.position }, { actor: actor.event });
    return this.present(db, auth, row);
  }

  async move(auth: AuthContext, id: string, body: DealMove): Promise<Deal> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    await this.ensurePipeline(wid);
    const deal = await this.loadVisible(db, auth, id);
    if (body.expectedVersion !== undefined && body.expectedVersion !== deal.version) throw versionConflict();
    const stage = await this.dealStage(db, body.stageId, deal.pipelineId ?? undefined);
    const now = new Date();
    await db.$transaction(async (tx) => {
      const neighbour = (nid: string | null | undefined) => (nid && nid !== id ? tx.deal.findFirst({ where: { id: nid, stageId: stage.id, deletedAt: null }, select: { position: true } }) : null);
      const before = await neighbour(body.beforeDealId);
      const after = await neighbour(body.afterDealId);
      let position: string;
      if (before && after && before.position < after.position) position = between(before.position, after.position);
      else if (before) {
        const next = await tx.deal.findFirst({ where: { stageId: stage.id, deletedAt: null, id: { not: id }, position: { gt: before.position } }, orderBy: COLUMN_ORDER, select: { position: true } });
        position = between(before.position, next?.position ?? null);
      } else if (after) {
        const prev = await tx.deal.findFirst({ where: { stageId: stage.id, deletedAt: null, id: { not: id }, position: { lt: after.position } }, orderBy: [{ position: 'desc' }, { id: 'desc' }], select: { position: true } });
        position = between(prev?.position ?? null, after.position);
      } else {
        const last = await tx.deal.findFirst({ where: { stageId: stage.id, id: { not: id } }, orderBy: [{ position: 'desc' }, { id: 'desc' }], select: { position: true } });
        position = between(last?.position ?? null, null);
      }
      const stageChanged = stage.id !== deal.stageId;
      const res = await tx.deal.updateMany({
        where: { id, version: deal.version, deletedAt: null },
        data: { stageId: stage.id, pipelineId: stage.pipelineId, position, version: { increment: 1 }, ...(stageChanged ? this.closeFields(stage.type, now, body.lostReason) : {}) },
      });
      if (res.count !== 1) throw versionConflict();
    });
    const row = await db.deal.findUniqueOrThrow({ where: { id }, include: DEAL_DETAIL_INCLUDE });
    const actor = await requestActor(db, auth);
    await publishSafe(this.events, this.logger, 'deal.moved', wid, { deal: toDealListItem(row), fromStageId: deal.stageId, toStageId: stage.id, position: row.position }, { actor: actor.event });
    return this.present(db, auth, row);
  }

  async remove(auth: AuthContext, req: Request | null, id: string): Promise<{ ok: true }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const deal = await this.loadVisible(db, auth, id);
    await db.deal.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'deal.delete', entityType: 'deal', entityId: id, diff: { title: deal.title, valueInr: deal.valueInr, ownerId: deal.ownerId } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'deal.deleted', wid, { dealIds: [id] }, { actor: actor.event });
    return { ok: true };
  }

  async bulk(auth: AuthContext, req: Request, body: DealBulkAction): Promise<BulkResult> {
    const db = this.prisma.forTenant(auth.workspaceId);
    if (body.action === 'assign') {
      if (body.ownerId !== auth.userId) requirePermission(auth, 'leads.assign', 'You cannot assign deals to other users');
      await this.assignable(db, auth, body.ownerId, null);
    }
    if (body.action === 'delete') requirePermission(auth, 'deals.delete', 'You cannot delete deals');
    const ids = [...new Set(body.ids)];
    const visible = await db.deal.findMany({ where: { AND: [{ id: { in: ids } }, await this.visibleWhere(auth)] }, select: { id: true } });
    const ok = new Set(visible.map((v) => v.id));
    const failed: BulkResult['failed'] = ids.filter((i) => !ok.has(i)).map((i) => ({ id: i, code: 'NOT_FOUND', message: 'Deal not found' }));
    let succeeded = 0;
    for (const v of visible) {
      try {
        if (body.action === 'delete') await this.remove(auth, req, v.id);
        else if (body.action === 'assign') await this.update(auth, v.id, { ownerId: body.ownerId });
        else await this.move(auth, v.id, { stageId: body.stageId });
        succeeded++;
      } catch (err) {
        const code = err instanceof AppException ? err.code : 'INTERNAL_ERROR';
        failed.push({ id: v.id, code, message: err instanceof AppException ? err.message : 'Could not update this deal' });
      }
    }
    return { succeeded, failed };
  }

  /** Deals of a lead/contact/account for related lists. */
  async listFor(auth: AuthContext, where: Prisma.DealWhereInput, take = 50): Promise<DealListItem[]> {
    const db = this.prisma.forTenant(auth.workspaceId);
    await this.ensurePipeline(auth.workspaceId);
    const rows: DealListRow[] = await db.deal.findMany({ where: { AND: [where, await this.visibleWhere(auth)] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, include: DEAL_LIST_INCLUDE });
    return rows.map(toDealListItem);
  }
}
