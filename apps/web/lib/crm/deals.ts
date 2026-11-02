'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DealBoard, DealBulkAction, DealFilters, DealListItem, DealListQuery, DealMove, DealUpdate, RouteBody } from '@vistar/shared';

export { applyDealMove } from './board-logic';
import { toast } from '@/components/ui/toast';
import { applyDealMove } from './board-logic';
import { crmKeys } from './keys';
import { getCrmSource } from './source';

/** Deals: pipelines, board and table (same filters), detail, moves with optimistic updates. */
const src = () => getCrmSource();

export type DealQuery = Partial<Omit<DealListQuery, 'cursor' | 'limit'>>;

export function useDealPipelines() {
  return useQuery({ queryKey: crmKeys.deals.pipelines(), queryFn: () => src().deals.pipelines(), staleTime: 5 * 60_000 });
}

export function useDeals(q: DealQuery, opts: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: crmKeys.deals.list(q),
    queryFn: ({ pageParam }) => src().deals.list({ ...q, limit: 50, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

export function useDealBoard(filters: Partial<DealFilters>, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: crmKeys.deals.board(filters),
    queryFn: () => src().deals.board({ ...filters, perColumn: 50 }),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

export function useDeal(id: string | null | undefined) {
  return useQuery({ queryKey: crmKeys.deals.detail(id ?? ''), queryFn: () => src().deals.get(id!), enabled: !!id });
}
export function useDealRelated(id: string) {
  return useQuery({ queryKey: crmKeys.deals.related(id), queryFn: () => src().deals.related(id) });
}
export function useDealTimeline(id: string) {
  return useInfiniteQuery({
    queryKey: crmKeys.deals.timeline(id),
    queryFn: ({ pageParam }) => src().deals.timeline(id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useMoveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deal, move }: { deal: DealListItem; move: DealMove }) => src().deals.move(deal.id, move),
    onMutate: async ({ deal, move }) => {
      await qc.cancelQueries({ queryKey: crmKeys.deals.boards() });
      const snapshot = qc.getQueriesData<DealBoard>({ queryKey: crmKeys.deals.boards() });
      qc.setQueriesData<DealBoard>({ queryKey: crmKeys.deals.boards() }, (b) => (b ? applyDealMove(b, deal, move.stageId, move.beforeDealId, move.afterDealId) : b));
      return { snapshot };
    },
    onError: (_e, { deal }, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(`Could not move ${deal.title}. It is back in its stage.`);
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ['deals', 'list'] }), qc.invalidateQueries({ queryKey: crmKeys.deals.boards() })]),
  });
}

export function useDealMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: crmKeys.deals.all });
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'dealCreate'>) => src().deals.create(body), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: DealUpdate }) => src().deals.update(id, patch),
      onSuccess: (d) => {
        qc.setQueryData(crmKeys.deals.detail(d.id), d);
        return Promise.all([qc.invalidateQueries({ queryKey: ['deals', 'list'] }), qc.invalidateQueries({ queryKey: crmKeys.deals.boards() })]);
      },
    }),
    remove: useMutation({ mutationFn: (id: string) => src().deals.remove(id), onSuccess: refresh }),
    bulk: useMutation({ mutationFn: (a: DealBulkAction) => src().deals.bulk(a), onSuccess: refresh }),
    addNote: useMutation({
      mutationFn: ({ id, body }: { id: string; body: string }) => src().deals.addNote(id, body),
      onSuccess: (_n, { id }) => qc.invalidateQueries({ queryKey: crmKeys.deals.timeline(id) }),
    }),
    convertLead: useMutation({
      mutationFn: ({ leadId, body }: { leadId: string; body: RouteBody<'leadConvert'> }) => src().deals.convertLead(leadId, body),
      onSuccess: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['contacts'] }), qc.invalidateQueries({ queryKey: ['accounts'] }), qc.invalidateQueries({ queryKey: ['leads'] })]),
    }),
  };
}
