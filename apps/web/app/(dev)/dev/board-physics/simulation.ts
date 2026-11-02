'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { Board, LeadListItem, Pipeline } from '@vistar/shared';
import { mockLeads, mockPipeline } from '@vistar/shared/fixtures';
import { applyMoveToBoard } from '@/lib/leads/data';
import { toast } from '@/components/ui/toast';
import type { CommitMove } from '@/features/pipeline/drag/types';

/**
 * Demo-only data helpers for /dev/board-physics: a 2,500-lead stress board (isolated query
 * client) and its local move handler. "Realtime" events come from createRealtimeSim in
 * lib/leads/mock-realtime.ts (shared with the Leads page live feed).
 */

const byPosition = (a: LeadListItem, b: LeadListItem) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

/** Board with `count` deterministic mock leads, every card loaded (long columns virtualise). */
export function buildStressBoard(pipeline: Pipeline, count: number): Board {
  const keyOf = new Map(mockPipeline().stages.map((s) => [s.id, s.key]));
  const leads = mockLeads(count, 7);
  return {
    pipeline: { ...pipeline },
    columns: pipeline.stages.map((stage) => {
      const inStage = leads
        .filter((l) => keyOf.get(l.stageId) === stage.key)
        .map((l) => ({ ...l, stageId: stage.id, pipelineId: pipeline.id }))
        .sort(byPosition);
      return { stage, leads: inStage, count: inStage.length, totalValueInr: inStage.reduce((n, l) => n + l.valueInr, 0), nextCursor: null };
    }),
  };
}

const failRate = () => (window as unknown as { __vistarMockFailRate?: number }).__vistarMockFailRate ?? 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stress mode move handler: same optimistic + rollback contract as useMoveLead, on the local cache. */
export function stressCommit(client: QueryClient, pipelineId: string) {
  const key = ['board', pipelineId];
  return async (m: CommitMove) => {
    client.setQueriesData<Board>({ queryKey: key }, (b) =>
      b ? applyMoveToBoard(b, { lead: m.lead, fromStageId: m.fromStageId, toStageId: m.toStageId, beforeId: m.beforeLeadId, afterId: m.afterLeadId }) : b,
    );
    await wait(120 + Math.random() * 160);
    if (Math.random() < failRate()) {
      client.setQueriesData<Board>({ queryKey: key }, (b) =>
        b ? applyMoveToBoard(b, { lead: m.lead, fromStageId: m.toStageId, toStageId: m.fromStageId, position: m.lead.position }) : b,
      );
      toast.error(`Could not move ${m.lead.name}. It is back in its original stage.`);
      throw new Error('Mock failure');
    }
  };
}
