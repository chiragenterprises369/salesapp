import { Injectable, Logger } from '@nestjs/common';
import type { Board, LeadFilters, LeadListItem, LeadMove, Page, Pipeline, Stage, StageCreate, StageUpdate } from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { ActivityService } from '../leads/activity.service.js';
import { LEAD_LIST_INCLUDE, toLeadListItem } from '../leads/lead.mapper.js';
import { positionBetween } from '../leads/lead-position.js';
import { buildLeadWhere } from '../leads/lead-query.js';
import { stageDates, syncDealsForStage } from '../leads/lead-stage.js';
import { LeadsService } from '../leads/leads.service.js';
import { publishSafe, requestActor, type TenantDb } from '../leads/lib/context.js';
import { decodeCursor, encodeCursor, isUuid } from '../leads/lib/cursor.js';
import { stageKey, toPipeline, toStage } from './pipeline.mapper.js';

interface ColumnCursor extends Record<string, unknown> {
  p: string;
  id: string;
}
const isColumnCursor = (c: Record<string, unknown>): c is ColumnCursor => typeof c.p === 'string' && isUuid(c.id);

const COLUMN_ORDER: Prisma.LeadOrderByWithRelationInput[] = [{ position: 'asc' }, { id: 'asc' }];
const versionConflict = () => new AppException('VERSION_CONFLICT', 'Someone else moved or changed this lead. Reload the board.');

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly activities: ActivityService,
    private readonly leads: LeadsService,
  ) {}

  private async loadPipeline(db: TenantDb, id: string) {
    const pipeline = await db.pipeline.findUnique({ where: { id }, include: { stages: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } } });
    if (!pipeline) throw notFound('Pipeline');
    return pipeline;
  }

  async list(auth: AuthContext): Promise<{ items: Pipeline[] }> {
    const rows = await this.prisma.forTenant(auth.workspaceId).pipeline.findMany({
      include: { stages: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return { items: rows.map(toPipeline) };
  }

  // ------------------------------------------------------------------ board

  /** Columns in stage order; count + value per column come from one groupBy over the same filters + scope as the list. */
  async board(auth: AuthContext, id: string, q: LeadFilters & { perColumn: number }): Promise<Board> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const pipeline = await this.loadPipeline(db, id);
    const where: Prisma.LeadWhereInput = { AND: [await buildLeadWhere(auth, this.scope, q), { pipelineId: id }] };
    const groups = await db.lead.groupBy({ by: ['stageId'], where, _count: { _all: true }, _sum: { valueInr: true } });
    const stats = new Map(groups.map((g) => [g.stageId, { count: g._count._all, value: g._sum.valueInr ?? 0 }]));

    const columns = await Promise.all(
      pipeline.stages.map(async (stage) => {
        const s = stats.get(stage.id);
        const rows = s
          ? await db.lead.findMany({ where: { AND: [where, { stageId: stage.id }] }, orderBy: COLUMN_ORDER, take: q.perColumn + 1, include: LEAD_LIST_INCLUDE })
          : [];
        const page = rows.slice(0, q.perColumn);
        const last = page.at(-1);
        return {
          stage: toStage(stage),
          count: s?.count ?? 0,
          totalValueInr: s?.value ?? 0,
          leads: page.map(toLeadListItem),
          nextCursor: rows.length > q.perColumn && last ? encodeCursor({ p: last.position, id: last.id }) : null,
        };
      }),
    );
    return { pipeline: toPipeline(pipeline), columns };
  }

  async columnPage(auth: AuthContext, id: string, stageId: string, q: LeadFilters & { cursor?: string; limit: number }): Promise<Page<LeadListItem>> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const stage = await db.stage.findFirst({ where: { id: stageId, pipelineId: id } });
    if (!stage) throw notFound('Stage');
    const and: Prisma.LeadWhereInput[] = [await buildLeadWhere(auth, this.scope, q), { pipelineId: id, stageId }];
    if (q.cursor) {
      const c = decodeCursor(q.cursor, isColumnCursor);
      and.push({ OR: [{ position: { gt: c.p } }, { position: c.p, id: { gt: c.id } }] });
    }
    const rows = await db.lead.findMany({ where: { AND: and }, orderBy: COLUMN_ORDER, take: q.limit + 1, include: LEAD_LIST_INCLUDE });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return { items: page.map(toLeadListItem), nextCursor: rows.length > q.limit && last ? encodeCursor({ p: last.position, id: last.id }) : null };
  }

  // ------------------------------------------------------------------ stages

  async createStage(auth: AuthContext, pipelineId: string, body: StageCreate): Promise<Stage> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const pipeline = await this.loadPipeline(db, pipelineId);
    const stages = pipeline.stages;
    let insertAt = stages.length;
    if (body.afterStageId === null) insertAt = 0;
    else if (body.afterStageId) {
      const idx = stages.findIndex((s) => s.id === body.afterStageId);
      if (idx < 0) throw new AppException('STAGE_NOT_IN_PIPELINE', 'That stage is not in this pipeline');
      insertAt = idx + 1;
    }
    const key = stageKey(body.name, new Set(stages.map((s) => s.key)));
    const created = await db.$transaction(async (tx) => {
      const stage = await tx.stage.create({
        data: { workspaceId: auth.workspaceId, pipelineId, key, name: body.name.trim(), type: body.type, color: body.color ?? null, probability: body.probability, order: insertAt },
      });
      const ordered = [...stages.slice(0, insertAt), stage, ...stages.slice(insertAt)];
      await this.writeOrder(tx, ordered);
      return tx.stage.findUniqueOrThrow({ where: { id: stage.id } });
    });
    return toStage(created);
  }

  /** Persist order = index for every stage whose order changed. */
  private async writeOrder(tx: TenantDb, ordered: Array<{ id: string; order: number }>): Promise<void> {
    for (const [i, s] of ordered.entries()) {
      if (s.order !== i) await tx.stage.update({ where: { id: s.id }, data: { order: i } });
    }
  }

  async reorderStages(auth: AuthContext, pipelineId: string, stageIds: string[]): Promise<Pipeline> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const pipeline = await this.loadPipeline(db, pipelineId);
    const current = new Map(pipeline.stages.map((s) => [s.id, s]));
    const unique = new Set(stageIds);
    if (unique.size !== stageIds.length || unique.size !== current.size || stageIds.some((sid) => !current.has(sid))) {
      throw new AppException('STAGE_NOT_IN_PIPELINE', 'Send every stage of this pipeline exactly once');
    }
    await db.$transaction(async (tx) => this.writeOrder(tx, stageIds.map((sid) => current.get(sid)!)));
    return toPipeline(await this.loadPipeline(db, pipelineId));
  }

  async updateStage(auth: AuthContext, id: string, body: StageUpdate): Promise<Stage> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const stage = await db.stage.findUnique({ where: { id } });
    if (!stage) throw notFound('Stage');
    const updated = await db.stage.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.probability !== undefined ? { probability: body.probability } : {}),
      },
    });
    return toStage(updated);
  }

  async deleteStage(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const stage = await db.stage.findUnique({ where: { id } });
    if (!stage) throw notFound('Stage');
    // Workspace-wide count on purpose: a stage is in use even if the caller cannot see those leads.
    if (await db.lead.count({ where: { stageId: id, deletedAt: null } })) {
      throw new AppException('STAGE_IN_USE', 'Move the leads in this stage to another stage first');
    }
    const siblings = await db.stage.findMany({ where: { pipelineId: stage.pipelineId, id: { not: id } }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    if (!siblings.length) throw new AppException('VALIDATION_FAILED', 'A pipeline needs at least one stage');
    await db.$transaction(async (tx) => {
      // Soft-deleted leads still reference the stage (FK): park them on the first remaining stage.
      await tx.lead.updateMany({ where: { stageId: id }, data: { stageId: siblings[0]!.id } });
      await tx.stage.deleteMany({ where: { id } });
      await this.writeOrder(tx, siblings);
    });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'stage.delete', entityType: 'stage', entityId: id, diff: { pipelineId: stage.pipelineId, key: stage.key, name: stage.name } }, actor.summary?.name);
    return { ok: true };
  }

  // ------------------------------------------------------------------ move

  async move(auth: AuthContext, leadId: string, body: LeadMove): Promise<LeadListItem> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const lead = await this.leads.loadVisible(db, auth, leadId);
    if (body.expectedVersion !== undefined && body.expectedVersion !== lead.version) throw versionConflict();
    const stage = await db.stage.findUnique({ where: { id: body.stageId } });
    if (!stage) throw notFound('Stage');
    const actor = await requestActor(db, auth);
    const now = new Date();
    const stageChanged = stage.id !== lead.stageId;

    const { moved, rows } = await db.$transaction(async (tx) => {
      const position = await positionBetween(tx, stage.id, lead.id, body.beforeLeadId, body.afterLeadId);
      const res = await tx.lead.updateMany({
        where: { id: lead.id, version: lead.version, deletedAt: null },
        data: {
          stageId: stage.id,
          pipelineId: stage.pipelineId,
          position,
          version: { increment: 1 },
          ...(stageChanged ? { lastActivityAt: now, ...stageDates(stage.type, now) } : {}),
        },
      });
      if (res.count !== 1) throw versionConflict();
      const rows = [];
      if (stageChanged) {
        await syncDealsForStage(tx, wid, [lead], stage.type, now);
        rows.push(await tx.activity.create({ data: this.activities.data(wid, actor, lead.id, 'stage_changed', { fromStageId: lead.stageId, toStageId: stage.id }, now) }));
      }
      return { moved: await tx.lead.findUniqueOrThrow({ where: { id: lead.id }, include: LEAD_LIST_INCLUDE }), rows };
    });

    const item = toLeadListItem(moved);
    await publishSafe(this.events, this.logger, 'stage.changed', wid, { lead: item, fromStageId: lead.stageId, toStageId: stage.id, position: moved.position }, { actor: actor.event });
    await this.activities.publishCreated(db, wid, rows, actor);
    return item;
  }
}
