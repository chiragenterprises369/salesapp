'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { Board, LeadFilters, LeadListItem, LeadListQuery, LeadMove, Page } from '@vistar/shared';
import { generateKeyBetween } from 'fractional-indexing';
import { toast } from '@/components/ui/toast';
import { mockLeadsSource } from './mock-source';

/**
 * ONE data layer for the Leads page (Board + Table share this cache). OWNER: orchestrator.
 * Wave 1 uses the in-memory mock source; Wave 3 swaps getLeadsSource() to the HTTP client
 * without changing any hook signature. Realtime events (Wave 3) patch these same query keys.
 */
export interface LeadsSource {
  list(query: LeadListQuery): Promise<Page<LeadListItem>>;
  board(pipelineId: string, filters: LeadFilters, perColumn?: number): Promise<Board>;
  move(leadId: string, move: LeadMove): Promise<LeadListItem>;
}

export function getLeadsSource(): LeadsSource {
  return mockLeadsSource;
}

export type LeadSort = Pick<LeadListQuery, 'sort' | 'dir'>;

/** Query keys. First segment matches SYNC_SCOPES ('leads', 'board') for resync invalidation. */
export const leadKeys = {
  all: ['leads'] as const,
  lists: () => ['leads', 'list'] as const,
  list: (filters: LeadFilters, sort: LeadSort) => ['leads', 'list', { filters, sort }] as const,
  detail: (id: string) => ['leads', 'detail', id] as const,
  boards: () => ['board'] as const,
  board: (pipelineId: string, filters: LeadFilters) => ['board', pipelineId, { filters }] as const,
};

/** Table view: infinite list with the shared filters. */
export function useLeadsList(filters: LeadFilters, sort: LeadSort = { sort: 'createdAt', dir: 'desc' }, limit = 50) {
  return useInfiniteQuery({
    queryKey: leadKeys.list(filters, sort),
    queryFn: ({ pageParam }) => getLeadsSource().list({ ...filters, ...sort, limit, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

/** Board view: columns with the shared filters. */
export function useLeadsBoard(pipelineId: string, filters: LeadFilters) {
  return useQuery({
    queryKey: leadKeys.board(pipelineId, filters),
    queryFn: () => getLeadsSource().board(pipelineId, filters),
    placeholderData: keepPreviousData,
  });
}

type Snapshot = Array<[QueryKey, unknown]>;

/** Apply a move to a cached board (pure; used by optimistic updates and realtime stage.changed). */
export function applyMoveToBoard(board: Board, lead: LeadListItem, toStageId: string, beforeId?: string | null, afterId?: string | null): Board {
  const columns = board.columns.map((c) => ({ ...c, leads: c.leads.filter((l) => l.id !== lead.id) }));
  const from = board.columns.find((c) => c.leads.some((l) => l.id === lead.id));
  const target = columns.find((c) => c.stage.id === toStageId);
  if (!target) return board;
  const moved: LeadListItem = { ...lead, stageId: toStageId };
  let index = target.leads.length;
  if (beforeId) index = target.leads.findIndex((l) => l.id === beforeId) + 1;
  else if (afterId) index = Math.max(0, target.leads.findIndex((l) => l.id === afterId));
  target.leads.splice(index, 0, moved);
  return {
    ...board,
    columns: columns.map((c) => {
      const wasFrom = from && c.stage.id === from.stage.id;
      const isTarget = c.stage.id === toStageId;
      if (wasFrom && isTarget) return c;
      if (wasFrom) return { ...c, count: c.count - 1, totalValueInr: c.totalValueInr - lead.valueInr };
      if (isTarget) return { ...c, count: c.count + 1, totalValueInr: c.totalValueInr + lead.valueInr };
      return c;
    }),
  };
}

/** Optimistic lead move with rollback. Updates every cached board and list. */
export function useMoveLead(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lead, move }: { lead: LeadListItem; move: LeadMove }) => getLeadsSource().move(lead.id, move),
    onMutate: async ({ lead, move }) => {
      await qc.cancelQueries({ queryKey: ['board', pipelineId] });
      const snapshot: Snapshot = [...qc.getQueriesData({ queryKey: ['board', pipelineId] }), ...qc.getQueriesData({ queryKey: leadKeys.lists() })];
      qc.setQueriesData<Board>({ queryKey: ['board', pipelineId] }, (b) =>
        b ? applyMoveToBoard(b, lead, move.stageId, move.beforeLeadId, move.afterLeadId) : b,
      );
      patchListItem(qc, { ...lead, stageId: move.stageId });
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error('Could not move the lead. It is back in its original stage.');
    },
    onSuccess: (saved) => {
      qc.setQueriesData<Board>({ queryKey: ['board', pipelineId] }, (b) =>
        b ? { ...b, columns: b.columns.map((c) => ({ ...c, leads: c.leads.map((l) => (l.id === saved.id ? saved : l)) })) } : b,
      );
      patchListItem(qc, saved);
    },
  });
}

function patchListItem(qc: ReturnType<typeof useQueryClient>, lead: LeadListItem) {
  qc.setQueriesData<{ pages: Page<LeadListItem>[]; pageParams: unknown[] }>({ queryKey: leadKeys.lists() }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((l) => (l.id === lead.id ? { ...l, ...lead } : l)) })) } : data,
  );
}

/** Position between two neighbours (server does the same; exported for mocks/tests). */
export function positionBetween(before: string | null | undefined, after: string | null | undefined): string {
  return generateKeyBetween(before ?? null, after ?? null);
}
