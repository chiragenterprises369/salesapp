'use client';

import { useMe, useSessionStore } from '@/lib/session/session';

/**
 * Legacy Board "Flat mode" (before SPEC 28.1). Flat is now one of the Board skins (user setting
 * `leads.boardSkin`, picked in the board toolbar). An old per-device `vistar.board.flatMode=1` is
 * migrated once to boardSkin "flat" by useBoardAppearance(), then removed.
 */
export const LEGACY_FLAT_MODE_KEY = 'vistar.board.flatMode';

export function readLegacyFlatMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LEGACY_FLAT_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearLegacyFlatMode() {
  try {
    window.localStorage.removeItem(LEGACY_FLAT_MODE_KEY);
  } catch {
    // Private mode: nothing stored, nothing to clear.
  }
}

/**
 * Compatibility for the physics demo page (/dev/board-physics): "Flat mode" maps onto the Board
 * skin setting. On = Flat, off = Depth. The Board itself reads the resolved skin instead.
 */
export function setBoardFlatMode(on: boolean) {
  void useSessionStore
    .getState()
    .updateSettings({ boardSkin: on ? 'flat' : 'depth' })
    .catch(() => undefined);
}

/** True when the signed-in person chose the Flat skin. */
export function useBoardFlatMode(): boolean {
  return useMe()?.settings.boardSkin === 'flat';
}
