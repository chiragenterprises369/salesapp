'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { create } from 'zustand';

/**
 * Lead detail drawer state lives in the URL (`?lead=<id>`) so links are shareable and the browser
 * Back button closes it. Uses the History API (Next keeps useSearchParams in sync) so opening the
 * drawer never refetches the page.
 */
export const LEAD_PARAM = 'lead';

/** Lead id we pushed a history entry for (close = history.back()); otherwise close = replace. */
let pushedFor: string | null = null;
/** Element that opened the drawer; focus returns here on close (there is no Dialog.Trigger). */
let opener: HTMLElement | null = null;

/** Return focus to the row, card or button that opened the drawer (or its row if it is now hidden). */
export function restoreDrawerFocus() {
  const el = opener;
  opener = null;
  if (!el || !el.isConnected) return;
  const visible =
    typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ visibilityProperty: true })
      : true;
  const target = visible ? el : el.closest<HTMLElement>('tr[tabindex], li, [data-index]');
  target?.focus({ preventScroll: true });
}

interface DrawerIntent {
  /** Focus the note composer when the drawer for this lead opens. */
  focusNoteFor: string | null;
  setFocusNote: (leadId: string | null) => void;
}

export const useDrawerIntent = create<DrawerIntent>()((set) => ({
  focusNoteFor: null,
  setFocusNote: (leadId) => set({ focusNoteFor: leadId }),
}));

function urlWith(pathname: string, params: URLSearchParams) {
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function useLeadDrawer() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const leadId = searchParams.get(LEAD_PARAM);

  const open = useCallback(
    (id: string, opts: { focusNote?: boolean } = {}) => {
      useDrawerIntent.getState().setFocusNote(opts.focusNote ? id : null);
      const params = new URLSearchParams(window.location.search);
      const alreadyOpen = params.has(LEAD_PARAM);
      if (
        !alreadyOpen &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
      )
        opener = document.activeElement;
      params.set(LEAD_PARAM, id);
      const url = urlWith(pathname, params);
      if (alreadyOpen) {
        window.history.replaceState(null, '', url);
        if (pushedFor) pushedFor = id;
      } else {
        window.history.pushState(null, '', url);
        pushedFor = id;
      }
    },
    [pathname],
  );

  const close = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const current = params.get(LEAD_PARAM);
    if (!current) return;
    if (pushedFor && pushedFor === current) {
      pushedFor = null;
      window.history.back();
      return;
    }
    pushedFor = null;
    params.delete(LEAD_PARAM);
    window.history.replaceState(null, '', urlWith(pathname, params));
  }, [pathname]);

  return { leadId, open, close } as const;
}
