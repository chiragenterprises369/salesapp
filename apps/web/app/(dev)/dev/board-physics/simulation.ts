'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { Board, LeadListItem, Pipeline } from '@vistar/shared';
import { createEventSimulator, mockLeads, mockPipeline } from '@vistar/shared/fixtures';
import { applyMoveToBoard, getLeadsSource } from '@/lib/leads/data';
import { toast } from '@/components/ui/toast';
import type { CommitMove } from '@/features/pipeline/drag/types';

/**
 * Demo-only data helpers for /dev/board-physics: a 2,500-lead stress board (isolated query
 * client), and "realtime" events from createEventSimulator applied to the cache the same way the
 * realtime updaters will (stage.changed -> applyMoveToBoard, lead.created -> top of its column).
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

function insertTop(b: Board, lead: LeadListItem): Board {
  return {
    ...b,
    columns: b.columns.map((c) =>
      c.stage.id === lead.stageId && !c.leads.some((l) => l.id === lead.id)
        ? { ...c, leads: [lead, ...c.leads], count: c.count + 1, totalValueInr: c.totalValueInr + lead.valueInr }
        : c,
    ),
  };
}

export interface RealtimeSim {
  /** A teammate moves a visible card to another stage (top of the target column). */
  moveByTeammate: () => void;
  /** A new lead arrives in the first stage ("New"). */
  newLead: () => void;
}

/**
 * Realtime simulator bound to a query client. `persist` writes through the mock leads source
 * (normal mode) so later refetches agree; stress mode only patches the local cache.
 */
export function createRealtimeSim(client: QueryClient, pipelineId: string, persist: boolean): RealtimeSim {
  const sim = createEventSimulator({ seed: 2026 });
  const key = ['board', pipelineId];
  const current = () => client.getQueriesData<Board>({ queryKey: key }).find(([, b]) => !!b)?.[1];

  return {
    moveByTeammate() {
      const board = current();
      if (!board) return;
      const sources = board.columns.filter((c) => c.leads.length > 0);
      const from = sources[Math.floor(Math.random() * sources.length)];
      if (!from) return;
      const lead = from.leads[Math.floor(Math.random() * Math.min(5, from.leads.length))]!;
      const targets = board.columns.filter((c) => c.stage.id !== from.stage.id);
      const to = targets[Math.floor(Math.random() * targets.length)];
      if (!to) return;
      const afterId = to.leads[0]?.id ?? null;
      client.setQueriesData<Board>({ queryKey: key }, (b) => (b ? applyMoveToBoard(b, { lead, fromStageId: from.stage.id, toStageId: to.stage.id, beforeId: null, afterId }) : b));
      if (persist) void getLeadsSource().move(lead.id, { stageId: to.stage.id, beforeLeadId: null, afterLeadId: afterId }).catch(() => undefined);
    },
    newLead() {
      const board = current();
      const first = board?.columns[0]?.stage;
      if (!board || !first) return;
      let created: LeadListItem | null = null;
      for (let i = 0; i < 60 && !created; i++) {
        for (const e of sim.next()) if (e.type === 'lead.created') created = (e.payload as { lead: LeadListItem }).lead;
      }
      if (!created) return;
      const lead: LeadListItem = { ...created, id: crypto.randomUUID(), stageId: first.id, pipelineId: board.pipeline.id, position: '0' };
      if (!persist) {
        client.setQueriesData<Board>({ queryKey: key }, (b) => (b ? insertTop(b, lead) : b));
        return;
      }
      void getLeadsSource()
        .create({ name: lead.name, companyName: lead.companyName ?? undefined, phone: lead.phone ?? undefined, city: lead.city ?? undefined, valueInr: lead.valueInr, stageId: first.id, source: lead.source, tags: lead.tags, customFields: {} })
        .then((saved) => client.setQueriesData<Board>({ queryKey: key }, (b) => (b ? insertTop(b, saved) : b)))
        .catch(() => undefined);
    },
  };
}
