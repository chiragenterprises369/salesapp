'use client';

import { LeadFiltersSchema, type LeadFilters } from '@vistar/shared';
import { create } from 'zustand';

/**
 * Leads page client state SHARED by the Board and Table views. OWNER: orchestrator.
 * Lives outside both views so switching Board <-> Table never resets search, filters, owner,
 * date range, active saved view, selection, open filter panel or scroll positions.
 */
export interface LeadsScrollState {
  board: { left: number; columns: Record<string, number> };
  table: { top: number };
}

export interface LeadsViewState {
  filters: LeadFilters;
  activeSavedViewId: string | null;
  /** Selected lead ids (bulk actions). Board uses it in "Select" mode; Table via row checkboxes. */
  selectedIds: ReadonlySet<string>;
  /** Board-only: card clicks toggle selection instead of opening the lead. */
  boardSelectMode: boolean;
  filtersPanelOpen: boolean;
  scroll: LeadsScrollState;

  setFilters: (patch: Partial<LeadFilters>) => void;
  replaceFilters: (filters: LeadFilters, savedViewId?: string | null) => void;
  resetFilters: () => void;
  toggleSelected: (id: string) => void;
  setSelected: (ids: Iterable<string>) => void;
  clearSelection: () => void;
  setBoardSelectMode: (on: boolean) => void;
  setFiltersPanelOpen: (open: boolean) => void;
  setBoardScroll: (patch: Partial<LeadsScrollState['board']>) => void;
  setBoardColumnScroll: (stageId: string, top: number) => void;
  setTableScroll: (top: number) => void;
}

const EMPTY_FILTERS: LeadFilters = {};

export const useLeadsViewState = create<LeadsViewState>()((set) => ({
  filters: EMPTY_FILTERS,
  activeSavedViewId: null,
  selectedIds: new Set<string>(),
  boardSelectMode: false,
  filtersPanelOpen: false,
  scroll: { board: { left: 0, columns: {} }, table: { top: 0 } },

  setFilters: (patch) => set((s) => ({ filters: compact({ ...s.filters, ...patch }), activeSavedViewId: null })),
  replaceFilters: (filters, savedViewId = null) => set({ filters: compact(filters), activeSavedViewId: savedViewId }),
  resetFilters: () => set({ filters: EMPTY_FILTERS, activeSavedViewId: null }),
  toggleSelected: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),
  setSelected: (ids) => set({ selectedIds: new Set(ids) }),
  clearSelection: () => set({ selectedIds: new Set<string>(), boardSelectMode: false }),
  setBoardSelectMode: (on) => set((s) => ({ boardSelectMode: on, selectedIds: on ? s.selectedIds : new Set<string>() })),
  setFiltersPanelOpen: (open) => set({ filtersPanelOpen: open }),
  setBoardScroll: (patch) => set((s) => ({ scroll: { ...s.scroll, board: { ...s.scroll.board, ...patch } } })),
  setBoardColumnScroll: (stageId, top) =>
    set((s) => ({ scroll: { ...s.scroll, board: { ...s.scroll.board, columns: { ...s.scroll.board.columns, [stageId]: top } } } })),
  setTableScroll: (top) => set((s) => ({ scroll: { ...s.scroll, table: { top } } })),
}));

/** Drop empty values so query keys stay stable. */
function compact(filters: LeadFilters): LeadFilters {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as LeadFilters;
}

/** Filters -> URLSearchParams (comma-separated arrays). Use for shareable links. */
export function filtersToSearchParams(filters: LeadFilters, base?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of Object.keys(LeadFiltersSchema.shape)) params.delete(key);
  for (const [k, v] of Object.entries(compact(filters))) params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  return params;
}

/** URLSearchParams -> filters. Each key is parsed on its own so one bad value never drops the rest. */
export function searchParamsToFilters(params: URLSearchParams): LeadFilters {
  const out: Record<string, unknown> = {};
  const shape = LeadFiltersSchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown } }>;
  for (const key of Object.keys(shape)) {
    let v: string | null = params.get(key);
    if (!v) continue;
    // Accept date-only values for date filters (start of that day, local time).
    if ((key === 'createdFrom' || key === 'createdTo') && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const d = new Date(`${v}T00:00:00`);
      if (key === 'createdTo') d.setHours(23, 59, 59, 999);
      v = d.toISOString();
    }
    const parsed = shape[key]!.safeParse(v);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return compact(out as LeadFilters);
}
