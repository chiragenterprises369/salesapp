'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CaptureForm, RouteBody, RoutingRule } from '@vistar/shared';
import { crmKeys } from './keys';
import { getCrmSource } from './source';

/** Lead routing rules and lead capture forms (company settings). */
const src = () => getCrmSource();

export function useRoutingRules(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: crmKeys.routing.rules(), queryFn: () => src().routing.list(), enabled: opts.enabled ?? true });
}

export function useRoutingMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: crmKeys.routing.all });
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'routingRuleCreate'>) => src().routing.create(body), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: RouteBody<'routingRuleUpdate'> }) => src().routing.update(id, patch), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => src().routing.remove(id), onSuccess: refresh }),
    reorder: useMutation({
      mutationFn: (ids: string[]) => src().routing.reorder(ids),
      onMutate: async (ids) => {
        await qc.cancelQueries({ queryKey: crmKeys.routing.rules() });
        const prev = qc.getQueryData<RoutingRule[]>(crmKeys.routing.rules());
        if (prev) qc.setQueryData(crmKeys.routing.rules(), ids.map((id, i) => ({ ...prev.find((r) => r.id === id)!, priority: i + 1 })).filter((r) => r.id));
        return { prev };
      },
      onError: (_e, _ids, ctx) => ctx?.prev && qc.setQueryData(crmKeys.routing.rules(), ctx.prev),
      onSettled: refresh,
    }),
    test: useMutation({ mutationFn: (body: RouteBody<'routingTest'>) => src().routing.test(body) }),
  };
}

export function useCaptureForms(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: crmKeys.capture.list(), queryFn: () => src().capture.list(), enabled: opts.enabled ?? true });
}

export function useCaptureForm(id: string | null) {
  return useQuery({ queryKey: crmKeys.capture.detail(id ?? ''), queryFn: () => src().capture.get(id!), enabled: !!id });
}

export function useCaptureSubmissions(id: string) {
  return useInfiniteQuery({
    queryKey: crmKeys.capture.submissions(id),
    queryFn: ({ pageParam }) => src().capture.submissions(id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useCaptureMutations() {
  const qc = useQueryClient();
  const put = (f: CaptureForm) => {
    qc.setQueryData(crmKeys.capture.detail(f.id), f);
    return qc.invalidateQueries({ queryKey: crmKeys.capture.list() });
  };
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'captureFormCreate'>) => src().capture.create(body), onSuccess: put }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: RouteBody<'captureFormUpdate'> }) => src().capture.update(id, patch), onSuccess: put }),
    remove: useMutation({ mutationFn: (id: string) => src().capture.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.capture.all }) }),
  };
}
