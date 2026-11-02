'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeadFilters, LeadsViewMode, SavedView } from '@vistar/shared';
import { useCallback, useMemo } from 'react';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';
import { useMe } from '@/lib/session/session';
import { useSavedViews, type TableSort } from './stores';

export interface NewSavedView {
  name: string;
  filters: LeadFilters;
  sort?: TableSort;
  viewMode: LeadsViewMode | null;
  ownerId: string | null;
}

/**
 * Saved views: GET/POST/DELETE /views (shared views plus the caller's own). The test-only mock data
 * mode keeps the localStorage store with its seed views.
 */
export function useSavedViewList(): { views: SavedView[]; add: (v: NewSavedView) => Promise<SavedView>; remove: (id: string) => Promise<void> } {
  const mock = isMockData();
  const me = useMe();
  const qc = useQueryClient();
  const local = useSavedViews((s) => s.views);
  const addLocal = useSavedViews((s) => s.add);
  const removeLocal = useSavedViews((s) => s.remove);
  const key = useMemo(() => ['leads', 'views', me?.user.id ?? null] as const, [me?.user.id]);

  const query = useQuery({ queryKey: key, queryFn: async () => (await api.call('viewList')).items, enabled: !mock && !!me });
  const create = useMutation({
    mutationFn: (v: NewSavedView) =>
      api.call('viewCreate', {
        body: {
          name: v.name,
          filters: { ...v.filters, ...(v.sort ? { sort: v.sort.sort, dir: v.sort.dir } : {}) },
          columns: [],
          viewMode: v.viewMode,
          isShared: false,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const del = useMutation({ mutationFn: (id: string) => api.call('viewDelete', { params: { id } }), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });

  const add = useCallback(async (v: NewSavedView) => (mock ? addLocal(v) : create.mutateAsync(v)), [mock, addLocal, create]);
  const remove = useCallback(
    async (id: string) => {
      if (mock) removeLocal(id);
      else await del.mutateAsync(id);
    },
    [mock, removeLocal, del],
  );
  return { views: mock ? local : (query.data ?? []), add, remove };
}
