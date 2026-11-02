import type { DealBoard, DealListItem } from '@vistar/shared';
import { generateKeyBetween } from 'fractional-indexing';

/** Pure: move a deal between columns of a cached board (counts and totals follow). */
export function applyDealMove(board: DealBoard, deal: DealListItem, toStageId: string, beforeId?: string | null, afterId?: string | null): DealBoard {
  const fromStageId = deal.stageId;
  const target = board.columns.find((c) => c.stage.id === toStageId);
  if (!target) return board;
  const prob = target.stage.probability ?? deal.probability;
  const moved: DealListItem = { ...deal, stageId: toStageId, status: target.stage.type, probability: prob, weightedValueInr: Math.round((deal.valueInr * prob) / 100) };
  return {
    ...board,
    columns: board.columns.map((c) => {
      const isSource = c.stage.id === fromStageId;
      const isTarget = c.stage.id === toStageId;
      if (!isSource && !isTarget) return c;
      let deals = c.deals.filter((d) => d.id !== deal.id);
      let { count, totalValueInr, weightedValueInr } = c;
      if (isSource && !isTarget) {
        count = Math.max(0, count - 1);
        totalValueInr = Math.max(0, totalValueInr - deal.valueInr);
        weightedValueInr = Math.max(0, weightedValueInr - deal.weightedValueInr);
      }
      if (isTarget) {
        let index = deals.length;
        if (beforeId && deals.some((d) => d.id === beforeId)) index = deals.findIndex((d) => d.id === beforeId) + 1;
        else if (afterId && deals.some((d) => d.id === afterId)) index = deals.findIndex((d) => d.id === afterId);
        const prev = deals[index - 1]?.position ?? null;
        const next = deals[index]?.position ?? null;
        let position = moved.position;
        try {
          position = generateKeyBetween(prev, next);
        } catch {
          // keep the old position when neighbours are out of order
        }
        deals = [...deals.slice(0, index), { ...moved, position }, ...deals.slice(index)];
        if (!isSource) {
          count += 1;
          totalValueInr += moved.valueInr;
          weightedValueInr += moved.weightedValueInr;
        }
      }
      return { ...c, deals, count, totalValueInr, weightedValueInr };
    }),
  };
}
