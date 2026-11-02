'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Module panels the floor workspace can open over the floor (SPEC 29.11). */
export type ModuleId = 'leads' | 'inbox' | 'tasks' | 'calls' | 'dashboard' | 'today';

/** `dock` = beside the floor (the floor narrows), `float` = over the floor (the floor keeps its size). */
export type DockLayout = 'dock' | 'float';

export const PANEL_MIN_WIDTH = 360;
/** The floor keeps at least this much width beside a docked panel. */
export const FLOOR_MIN_WIDTH = 420;

interface WorkspaceUi {
  /** Open module tabs, in the order they were opened. */
  tabs: ModuleId[];
  /** Shown module; null = no panel open. */
  active: ModuleId | null;
  /** Chosen layout; null = automatic (dock on very wide areas, float otherwise). */
  layout: DockLayout | null;
  widths: Partial<Record<DockLayout, number>>;
  /** Bumped to remount the Leads page after the floor changed its filters in the URL. */
  leadsKey: number;
  open: (m: ModuleId) => void;
  close: (m: ModuleId) => void;
  closeAll: () => void;
  setLayout: (l: DockLayout) => void;
  setWidth: (l: DockLayout, w: number) => void;
  remountLeads: () => void;
}

/**
 * Panel state of the floor workspace (tab-local; the layout and widths persist in localStorage, the
 * open panels do not, so the floor opens clean).
 */
export const useWorkspaceUi = create<WorkspaceUi>()(
  persist(
    (set) => ({
      tabs: [],
      active: null,
      layout: null,
      widths: {},
      leadsKey: 0,
      open: (m) => set((s) => ({ tabs: s.tabs.includes(m) ? s.tabs : [...s.tabs, m], active: m })),
      close: (m) =>
        set((s) => {
          const i = s.tabs.indexOf(m);
          if (i === -1) return s;
          const tabs = s.tabs.filter((t) => t !== m);
          const active = s.active === m ? (tabs[Math.min(i, tabs.length - 1)] ?? null) : s.active;
          return { tabs, active };
        }),
      closeAll: () => set({ tabs: [], active: null }),
      setLayout: (layout) => set({ layout }),
      setWidth: (l, w) => set((s) => ({ widths: { ...s.widths, [l]: Math.round(w) } })),
      remountLeads: () => set((s) => ({ leadsKey: s.leadsKey + 1 })),
    }),
    {
      name: 'vistar.floor.workspace',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ layout: s.layout, widths: s.widths }),
    },
  ),
);
