'use client';

import type { LeadListItem } from '@vistar/shared';
import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardController } from './controller';
import type { CardHandle, DragState } from './types';

const BoardControllerContext = createContext<BoardController | null>(null);

export const BoardControllerProvider = BoardControllerContext.Provider;

export function useBoardController(): BoardController {
  const ctrl = useContext(BoardControllerContext);
  if (!ctrl) throw new Error('useBoardController must be used inside LeadsBoardView');
  return ctrl;
}

/** Subscribe to a slice of the drag state. Selectors must return primitives or stable references. */
export function useDragState<T>(selector: (s: DragState) => T): T {
  return useStore(useBoardController().store, selector);
}

/**
 * Column layout pass, run by the static and the virtual list after their cards changed:
 * records rest geometry, FLIPs cards whose rest position moved, and reports cards that arrived
 * from another column (the board flies them in after all columns ran).
 */
export function useColumnLayout(
  stageId: string,
  leads: readonly LeadListItem[],
  measure: (h: CardHandle) => { top: number; height: number } | null,
) {
  const ctrl = useBoardController();
  const prevTops = useRef<Map<string, number> | null>(null);
  const prevIds = useRef<Set<string> | null>(null);

  useLayoutEffect(() => {
    ctrl.invalidate(stageId);
    const before = prevIds.current;
    const tops = new Map<string, number>();
    const ids = new Set<string>();
    for (const lead of leads) {
      ids.add(lead.id);
      if (before && !before.has(lead.id)) ctrl.noteArrival(lead.id);
      const h = ctrl.cards.get(lead.id);
      if (!h || h.stageId !== stageId) continue;
      const m = measure(h);
      if (!m) continue;
      tops.set(lead.id, m.top);
      ctrl.relayout(h, prevTops.current?.get(lead.id), m.top, m.height);
    }
    prevTops.current = tops;
    prevIds.current = ids;
  }, [ctrl, stageId, leads, measure]);
}
