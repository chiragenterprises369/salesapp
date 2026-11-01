'use client';

import {
  LEAD_SORT_FIELDS,
  type LeadFilters,
  type LeadsViewMode,
  type SavedView,
} from '@vistar/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { STAGES } from './lead-meta';

/**
 * Small client stores local to the Leads page (frontend-app). Shared Board/Table state lives in
 * lib/leads/state.ts; these hold Table preferences, saved views (mock) and "just created" ids.
 */

export type LeadSortField = (typeof LEAD_SORT_FIELDS)[number];
export interface TableSort {
  sort: LeadSortField;
  dir: 'asc' | 'desc';
}

export const DEFAULT_SORT: TableSort = { sort: 'createdAt', dir: 'desc' };

interface TablePrefs {
  sort: TableSort;
  /** Column id -> visible. Missing = default visibility. */
  columns: Record<string, boolean>;
  setSort: (sort: TableSort) => void;
  setColumnVisible: (id: string, visible: boolean) => void;
  resetColumns: () => void;
}

export const useTablePrefs = create<TablePrefs>()(
  persist(
    (set) => ({
      sort: DEFAULT_SORT,
      columns: {},
      setSort: (sort) => set({ sort }),
      setColumnVisible: (id, visible) => set((s) => ({ columns: { ...s.columns, [id]: visible } })),
      resetColumns: () => set({ columns: {} }),
    }),
    { name: 'vistar.leads.table', storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);

// ---------------------------------------------------------------- saved views (mock, local)

const stageId = (key: string) => STAGES.find((s) => s.key === key)?.id;

const SEED_VIEWS: SavedView[] = [
  {
    id: '0190f5a0-0000-7000-8000-700000000001',
    name: 'Hot IndiaMART leads',
    entity: 'lead',
    filters: { source: ['indiamart'], temperature: ['hot'] },
    columns: [],
    viewMode: null,
    isShared: true,
    ownerId: null,
  },
  {
    id: '0190f5a0-0000-7000-8000-700000000002',
    name: 'My open follow-ups',
    entity: 'lead',
    filters: {
      ownerId: ['me'],
      stageId: [stageId('contacted'), stageId('interested')].filter((x): x is string => !!x),
      sort: 'nextFollowUpAt',
      dir: 'asc',
    },
    columns: [],
    viewMode: 'table',
    isShared: true,
    ownerId: null,
  },
  {
    id: '0190f5a0-0000-7000-8000-700000000003',
    name: 'High value quotes',
    entity: 'lead',
    filters: {
      stageId: [stageId('quote_sent')].filter((x): x is string => !!x),
      scoreMin: 50,
      sort: 'valueInr',
      dir: 'desc',
    },
    columns: [],
    viewMode: 'table',
    isShared: true,
    ownerId: null,
  },
];

interface SavedViewsState {
  views: SavedView[];
  add: (view: {
    name: string;
    filters: LeadFilters;
    sort?: TableSort;
    viewMode: LeadsViewMode | null;
    ownerId: string | null;
  }) => SavedView;
  remove: (id: string) => void;
}

export const useSavedViews = create<SavedViewsState>()(
  persist(
    (set) => ({
      views: SEED_VIEWS,
      add: ({ name, filters, sort, viewMode, ownerId }) => {
        const view: SavedView = {
          id: crypto.randomUUID(),
          name,
          entity: 'lead',
          filters: { ...filters, ...(sort ? { sort: sort.sort, dir: sort.dir } : {}) },
          columns: [],
          viewMode,
          isShared: false,
          ownerId,
        };
        set((s) => ({ views: [...s.views, view] }));
        return view;
      },
      remove: (id) => set((s) => ({ views: s.views.filter((v) => v.id !== id) })),
    }),
    { name: 'vistar.leads.savedViews', storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);

/** Split a saved view's filters into LeadFilters + optional Table sort. */
export function splitSavedView(view: SavedView): { filters: LeadFilters; sort: TableSort | null } {
  const { sort, dir, ...filters } = view.filters;
  return { filters, sort: sort ? { sort, dir: dir ?? 'desc' } : null };
}

// ---------------------------------------------------------------- recently created rows

interface RecentLeads {
  ids: ReadonlySet<string>;
  /** Mark ids as new for ~2 s (rows slide in with a highlight). */
  mark: (ids: Iterable<string>) => void;
}

export const useRecentLeads = create<RecentLeads>()((set) => ({
  ids: new Set<string>(),
  mark: (ids) => {
    const list = [...ids];
    set((s) => ({ ids: new Set([...s.ids, ...list]) }));
    setTimeout(() => {
      set((s) => {
        const next = new Set(s.ids);
        list.forEach((id) => next.delete(id));
        return { ids: next };
      });
    }, 2200);
  },
}));
