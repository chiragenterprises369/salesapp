'use client';

import { useCallback, useState } from 'react';
import { create } from 'zustand';
import type { ListSort } from './crm-table';

/**
 * Search, filters, sort and selection of a CRM list. Kept in memory for the tab (not persisted), so
 * opening a record and coming back keeps the list as it was. Selection is cleared when filters change.
 */
export interface ListState<F extends object> {
  q: string;
  filters: F;
  sort: ListSort;
}

interface Store {
  lists: Record<string, ListState<object>>;
  put: (key: string, next: ListState<object>) => void;
}

const useLists = create<Store>()((set) => ({
  lists: {},
  put: (key, next) => set((s) => ({ lists: { ...s.lists, [key]: next } })),
}));

export function useListState<F extends object>(key: string, defaults: { filters: F; sort: ListSort }) {
  const stored = useLists((s) => s.lists[key]) as ListState<F> | undefined;
  const put = useLists((s) => s.put);
  const state: ListState<F> = stored ?? { q: '', filters: defaults.filters, sort: defaults.sort };
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const update = useCallback(
    (patch: Partial<ListState<F>>) => {
      const current = (useLists.getState().lists[key] as ListState<F> | undefined) ?? { q: '', filters: defaults.filters, sort: defaults.sort };
      put(key, { ...current, ...patch } as ListState<object>);
      if ('q' in patch || 'filters' in patch) setSelected(new Set());
    },
    // defaults are literals from the caller; the key identifies the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, put],
  );

  return {
    ...state,
    setQ: (q: string) => update({ q }),
    setFilters: (patch: Partial<F>) => update({ filters: { ...state.filters, ...patch } }),
    resetFilters: () => update({ filters: defaults.filters, q: '' }),
    setSort: (sort: ListSort) => update({ sort }),
    selected,
    setSelected,
    clearSelection: () => setSelected(new Set()),
    hasFilters: !!state.q || JSON.stringify(state.filters) !== JSON.stringify(defaults.filters),
  };
}
