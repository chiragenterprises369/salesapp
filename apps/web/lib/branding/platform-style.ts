'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { readDesignCookie } from './boot';
import { isComponentStyle, type ComponentStyle } from './types';

/**
 * Component design of the Super Admin console. The console is not a workspace, so it has its own
 * choice in System settings. ADAPTER: kept in this browser (localStorage, mirrored in the design
 * cookie) until the platform setting exists (requests-19.md).
 */
const KEY = 'vistar.ui.platform.componentStyle';
const listeners = new Set<() => void>();

function read(): ComponentStyle {
  try {
    const v = window.localStorage.getItem(KEY);
    if (isComponentStyle(v)) return v;
  } catch {
    /* ignore */
  }
  return readDesignCookie().p;
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

export function usePlatformComponentStyle(): ComponentStyle {
  return useSyncExternalStore(subscribe, read, () => 'standard');
}

export function useSetPlatformComponentStyle() {
  return useCallback((value: ComponentStyle) => {
    try {
      window.localStorage.setItem(KEY, value);
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  }, []);
}
