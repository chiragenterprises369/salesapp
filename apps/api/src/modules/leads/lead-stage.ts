import type { StageType } from '@vistar/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { TenantDb } from './lib/context.js';

/** Lead date fields to write when a lead enters a stage of `type`. */
export function stageDates(type: StageType, now: Date): { stageChangedAt: Date; wonAt: Date | null; lostAt: Date | null } {
  return { stageChangedAt: now, wonAt: type === 'won' ? now : null, lostAt: type === 'lost' ? now : null };
}

interface DealLead {
  id: string;
  name: string;
  companyName: string | null;
  productInterest: string | null;
  valueInr: number;
}

/**
 * Keep Deal records in step with board moves (DECISIONS D-007: the board moves leads, deals hold revenue).
 * Entering won/lost closes open deals; a lead entering won with no deal at all gets one at its value.
 * Back to an open stage re-opens closed deals. Call inside the transaction that moves the leads.
 */
export async function syncDealsForStage(db: TenantDb, workspaceId: string, leads: DealLead[], type: StageType, now: Date): Promise<void> {
  if (!leads.length) return;
  const ids = leads.map((l) => l.id);
  if (type === 'open') {
    await moveDeals(db, { leadId: { in: ids }, status: { not: 'open' }, deletedAt: null }, 'open', { status: 'open', closedAt: null });
    return;
  }
  await moveDeals(db, { leadId: { in: ids }, status: 'open', deletedAt: null }, type, { status: type, closedAt: now });
  if (type !== 'won') return;
  const withDeal = new Set((await db.deal.findMany({ where: { leadId: { in: ids } }, select: { leadId: true } })).map((d) => d.leadId));
  const missing = leads.filter((l) => !withDeal.has(l.id) && l.valueInr > 0);
  if (missing.length) {
    await db.deal.createMany({
      data: missing.map((l) => ({
        workspaceId,
        leadId: l.id,
        title: `${l.productInterest ?? 'Order'} for ${l.companyName ?? l.name}`.slice(0, 200),
        valueInr: l.valueInr,
        status: 'won' as const,
        closedAt: now,
      })),
    });
  }
}

/**
 * Change deal status and keep the Deals board in step (change #19 wave B): deals on a deal pipeline move to the
 * first stage of the new type (won, lost, or the first open stage); deals without a pipeline only change status.
 */
async function moveDeals(db: TenantDb, where: Prisma.DealWhereInput, type: StageType, data: { status: StageType; closedAt: Date | null }): Promise<void> {
  const deals = await db.deal.findMany({ where, select: { id: true, pipelineId: true } });
  if (!deals.length) return;
  const byPipeline = new Map<string | null, string[]>();
  for (const d of deals) byPipeline.set(d.pipelineId, [...(byPipeline.get(d.pipelineId) ?? []), d.id]);
  for (const [pipelineId, dealIds] of byPipeline) {
    const stage = pipelineId ? await db.stage.findFirst({ where: { pipelineId, type, archivedAt: null }, orderBy: { order: 'asc' }, select: { id: true } }) : null;
    await db.deal.updateMany({ where: { id: { in: dealIds } }, data: { ...data, ...(stage ? { stageId: stage.id } : {}), version: { increment: 1 } } });
  }
}

/**
 * A stage leads may be moved/created into: exists in the tenant (else NOT_FOUND) and neither the stage nor
 * its pipeline is archived (else STAGE_NOT_IN_PIPELINE). Archived stages only keep the leads already in them.
 */
export async function activeStageOrThrow(db: TenantDb, id: string) {
  const stage = await db.stage.findUnique({ where: { id }, include: { pipeline: { select: { archivedAt: true, entity: true } } } });
  // deal pipeline stages (change #19 wave B) are not lead stages
  if (!stage || stage.pipeline.entity !== 'lead') throw notFound('Stage');
  if (stage.archivedAt || stage.pipeline.archivedAt) throw new AppException('STAGE_NOT_IN_PIPELINE', 'This stage is archived. Choose an active stage');
  return stage;
}
