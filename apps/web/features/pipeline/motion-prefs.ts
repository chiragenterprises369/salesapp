'use client';

import { useSyncExternalStore } from 'react';

/**
 * Board "Flat mode" preference (plain cards, no depth or physics; motion becomes short fades).
 * Per device in localStorage, synced across tabs. prefers-reduced-motion / the user's reduced
 * motion setting apply on top through useReducedMotion().
 */
const KEY = 'vistar.board.flatMode';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setBoardFlatMode(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, '1');
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode / quota: keep the in-memory toggle working for this tab.
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function useBoardFlatMode(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
