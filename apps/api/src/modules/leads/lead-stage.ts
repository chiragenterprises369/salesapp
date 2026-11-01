import type { StageType } from '@vistar/shared';
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
    await db.deal.updateMany({ where: { leadId: { in: ids }, status: { not: 'open' } }, data: { status: 'open', closedAt: null } });
    return;
  }
  await db.deal.updateMany({ where: { leadId: { in: ids }, status: 'open' }, data: { status: type, closedAt: now } });
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
