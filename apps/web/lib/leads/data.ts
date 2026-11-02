'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  Board,
  BulkResult,
  LeadBulkAction,
  LeadCreate,
  Lead,
  LeadFilters,
  LeadListItem,
  LeadListQuery,
  LeadMove,
  LeadUpdate,
  Page,
} from '@vistar/shared';
import { generateKeyBetween } from 'fractional-indexing';
import { toast } from '@/components/ui/toast';
import { isMockData } from '../api/data-source';
import { httpLeadsSource } from './http-source';
import { mockLeadsSource } from './mock-source';

/**
 * ONE data layer for the Leads page (Board + Table share this cache). OWNER: orchestrator.
 * The source is the HTTP API (lib/leads/http-source); the in-memory mock source is used only in the
 * test-only mock data mode (lib/api/data-source). Hook signatures are the same for both, and
 * realtime events patch these same query keys.
 */
export interface LeadsSource {
  list(query: LeadListQuery): Promise<Page<LeadListItem>>;
  board(pipelineId: string, filters: LeadFilters, perColumn?: number): Promise<Board>;
  /** Next page of one board column (cursor from BoardColumn.nextCursor). */
  columnPage(pipelineId: string, stageId: string, filters: LeadFilters, cursor: string, limit?: number): Promise<Page<LeadListItem>>;
  get(id: string): Promise<Lead>;
  create(input: LeadCreate): Promise<Lead>;
  update(id: string, patch: LeadUpdate): Promise<Lead>;
  bulk(action: LeadBulkAction): Promise<BulkResult>;
  move(leadId: string, move: LeadMove): Promise<LeadListItem>;
}

export function getLeadsSource(): LeadsSource {
  return isMockData() ? mockLeadsSource : httpLeadsSource;
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

export interface BoardMove {
  /** The moved lead (any stageId; fields are copied onto the card). */
  lead: LeadListItem;
  fromStageId: string | null;
  toStageId: string;
  beforeId?: string | null;
  afterId?: string | null;
  /** Fractional position in the target stage; used to place the card when no neighbours are given. */
  position?: string | null;
}

/**
 * Apply a move to a cached board (pure). Used by optimistic updates, rollback and realtime
 * `stage.changed` (pass `fromStageId` from the event so counts stay right even when the card is
 * not loaded in the source column). Placement: after `beforeId`, before `afterId`, else by
 * `position`, else at the end of the column.
 */
export function applyMoveToBoard(board: Board, move: BoardMove): Board {
  const { lead, fromStageId, toStageId, beforeId, afterId, position } = move;
  if (!board.columns.some((c) => c.stage.id === toStageId)) return board;
  const moved: LeadListItem = { ...lead, stageId: toStageId, ...(position ? { position } : {}) };
  const sameStage = fromStageId === toStageId;

  return {
    ...board,
    columns: board.columns.map((c) => {
      const isSource = c.stage.id === fromStageId;
      const isTarget = c.stage.id === toStageId;
      if (!isSource && !isTarget) return c;
      let leads = c.leads.filter((l) => l.id !== lead.id);
      let { count, totalValueInr } = c;
      if (isSource && !sameStage) {
        count = Math.max(0, count - 1);
        totalValueInr = Math.max(0, totalValueInr - lead.valueInr);
      }
      if (isTarget) {
        let index = leads.length;
        if (beforeId && leads.some((l) => l.id === beforeId)) index = leads.findIndex((l) => l.id === beforeId) + 1;
        else if (afterId && leads.some((l) => l.id === afterId)) index = leads.findIndex((l) => l.id === afterId);
        else if (moved.position) {
          const at = leads.findIndex((l) => l.position > moved.position);
          index = at === -1 ? leads.length : at;
        }
        // A card that belongs beyond the loaded page stays unloaded (count still changes).
        const beyondPage = index === leads.length && c.nextCursor !== null && !beforeId && !afterId;
        if (!beyondPage) leads = [...leads.slice(0, index), moved, ...leads.slice(index)];
        if (!sameStage) {
          count += 1;
          totalValueInr += lead.valueInr;
        }
      }
      return { ...c, leads, count, totalValueInr };
    }),
  };
}

/**
 * Optimistic lead move with per-lead rollback. Updates every cached board and list.
 * No neighbours = end of the target column (matches LeadMoveSchema).
 */
export function useMoveLead(pipelineId: string) {
  const qc = useQueryClient();
  const boardKey = ['board', pipelineId] as const;
  return useMutation({
    mutationFn: ({ lead, move }: { lead: LeadListItem; move: LeadMove }) => getLeadsSource().move(lead.id, move),
    onMutate: async ({ lead, move }) => {
      await Promise.all([qc.cancelQueries({ queryKey: boardKey }), qc.cancelQueries({ queryKey: leadKeys.lists() })]);
      qc.setQueriesData<Board>({ queryKey: boardKey }, (b) =>
        b ? applyMoveToBoard(b, { lead, fromStageId: lead.stageId, toStageId: move.stageId, beforeId: move.beforeLeadId, afterId: move.afterLeadId }) : b,
      );
      patchListItem(qc, { ...lead, stageId: move.stageId });
      return { original: lead };
    },
    onError: (_err, { move }, ctx) => {
      if (!ctx) return;
      const { original } = ctx;
      // Roll back ONLY this lead so other in-flight moves survive.
      qc.setQueriesData<Board>({ queryKey: boardKey }, (b) =>
        b ? applyMoveToBoard(b, { lead: original, fromStageId: move.stageId, toStageId: original.stageId, position: original.position }) : b,
      );
      patchListItem(qc, original);
      toast.error(`Could not move ${original.name}. It is back in its original stage.`);
    },
    onSuccess: (saved, { move }) => {
      qc.setQueriesData<Board>({ queryKey: boardKey }, (b) =>
        b ? { ...b, columns: b.columns.map((c) => (c.stage.id === move.stageId ? { ...c, leads: c.leads.map((l) => (l.id === saved.id ? saved : l)) } : c)) } : b,
      );
      patchListItem(qc, saved);
    },
  });
}

/** Exported for realtime updaters: replace a lead in every cached list page. */
export function patchListItem(qc: ReturnType<typeof useQueryClient>, lead: LeadListItem) {
  qc.setQueriesData<{ pages: Page<LeadListItem>[]; pageParams: unknown[] }>({ queryKey: leadKeys.lists() }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((l) => (l.id === lead.id ? { ...l, ...lead } : l)) })) } : data,
  );
}

/** For rare cases that need a full snapshot (e.g. bulk actions). */
export function snapshotLeadCaches(qc: ReturnType<typeof useQueryClient>, pipelineId: string): Snapshot {
  return [...qc.getQueriesData({ queryKey: ['board', pipelineId] }), ...qc.getQueriesData({ queryKey: leadKeys.lists() })];
}

/** Position between two neighbours (server does the same; exported for mocks/tests). */
export function positionBetween(before: string | null | undefined, after: string | null | undefined): string {
  return generateKeyBetween(before ?? null, after ?? null);
}

/** Load more cards into one board column; appends to every cached board for this pipeline + filters. */
export function useLoadMoreColumn(pipelineId: string, filters: LeadFilters) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stageId, cursor }: { stageId: string; cursor: string }) => getLeadsSource().columnPage(pipelineId, stageId, filters, cursor),
    onSuccess: (page, { stageId }) => {
      qc.setQueryData<Board>(leadKeys.board(pipelineId, filters), (b) =>
        b
          ? {
              ...b,
              columns: b.columns.map((c) =>
                c.stage.id === stageId
                  ? { ...c, leads: [...c.leads, ...page.items.filter((i) => !c.leads.some((l) => l.id === i.id))], nextCursor: page.nextCursor }
                  : c,
              ),
            }
          : b,
      );
    },
  });
}

/** Lead detail (drawer and page share this key). */
export function useLead(id: string | null) {
  return useQuery({
    queryKey: leadKeys.detail(id ?? 'none'),
    queryFn: () => getLeadsSource().get(id as string),
    enabled: !!id,
  });
}

/** Create a lead; puts it at the TOP of its column in cached boards (D-037), then refreshes lists. */
export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LeadCreate) => getLeadsSource().create(input),
    onSuccess: async (lead) => {
      qc.setQueryData(leadKeys.detail(lead.id), lead);
      qc.setQueriesData<Board>({ queryKey: leadKeys.boards() }, (b) =>
        b && b.pipeline.id === lead.pipelineId
          ? {
              ...b,
              columns: b.columns.map((c) =>
                c.stage.id === lead.stageId && !c.leads.some((l) => l.id === lead.id)
                  ? { ...c, leads: [lead, ...c.leads], count: c.count + 1, totalValueInr: c.totalValueInr + lead.valueInr }
                  : c,
              ),
            }
          : b,
      );
      await qc.invalidateQueries({ queryKey: leadKeys.lists() });
    },
  });
}

/** Update a lead (inline edits, drawer). Patches detail + list items; boards refetch if stage/owner/value changed. */
export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LeadUpdate }) => getLeadsSource().update(id, patch),
    onSuccess: async (lead, { patch }) => {
      qc.setQueryData(leadKeys.detail(lead.id), lead);
      patchListItem(qc, lead);
      if ('stageId' in patch || 'ownerId' in patch || 'valueInr' in patch) await qc.invalidateQueries({ queryKey: leadKeys.boards() });
    },
  });
}

/** Bulk actions (assign, stage, tags, delete, WhatsApp template). Refetches affected caches. */
export function useBulkLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: LeadBulkAction) => getLeadsSource().bulk(action),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: leadKeys.all }), qc.invalidateQueries({ queryKey: leadKeys.boards() })]);
    },
  });
}
