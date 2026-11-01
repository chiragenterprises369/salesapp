'use client';

import { create } from 'zustand';

const KEY_COLLAPSED = 'vistar.shell.sidebarCollapsed';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY_COLLAPSED) === '1';
  } catch {
    return false;
  }
}

interface ShellState {
  /** Desktop sidebar collapsed to the icon rail (persisted on this device). */
  collapsed: boolean;
  mobileNavOpen: boolean;
  commandOpen: boolean;
  toggleCollapsed: () => void;
  setMobileNavOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
}

/**
 * Shell UI state. The shells render only after the session hydrates (guards show a skeleton first),
 * so reading localStorage at creation cannot cause a hydration mismatch.
 */
export const useShellStore = create<ShellState>()((set, get) => ({
  collapsed: readCollapsed(),
  mobileNavOpen: false,
  commandOpen: false,
  toggleCollapsed: () => {
    const collapsed = !get().collapsed;
    try {
      window.localStorage.setItem(KEY_COLLAPSED, collapsed ? '1' : '0');
    } catch {
      /* private mode: preference lasts for this tab */
    }
    set({ collapsed });
  },
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
}));
