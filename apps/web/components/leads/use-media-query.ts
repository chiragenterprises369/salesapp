'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Live media query (server snapshot = `serverValue`). */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Desktop/tablet table layout from 768px; below that the Table view renders cards. */
export const useIsTableLayout = () => useMediaQuery('(min-width: 768px)', true);
