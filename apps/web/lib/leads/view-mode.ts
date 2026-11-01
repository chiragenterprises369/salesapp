'use client';

import {
  LEADS_VIEW_QUERY_PARAM,
  LEADS_VIEW_STORAGE_KEY,
  resolveLeadsViewMode,
  type LeadsViewMode,
} from '@vistar/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * Leads page Board | Table mode. OWNER: orchestrator. Resolution (see resolveLeadsViewMode):
 * URL ?view= > user setting (server) > localStorage > workspace default > "board".
 *
 * frontend-app wires `userSetting` / `workspaceDefault` from the /auth/me query and `persist`
 * to PATCH /me/settings { leadsViewMode }.
 */
export interface UseLeadsViewModeOptions {
  /** undefined while settings are loading; null when the user never chose. */
  userSetting?: LeadsViewMode | null;
  workspaceDefault?: LeadsViewMode | null;
  persist?: (mode: LeadsViewMode) => Promise<unknown> | void;
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === LEADS_VIEW_STORAGE_KEY && cb();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}
function readLocal(): string | null {
  try {
    return window.localStorage.getItem(LEADS_VIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeLocal(mode: LeadsViewMode) {
  try {
    window.localStorage.setItem(LEADS_VIEW_STORAGE_KEY, mode);
  } catch {
    /* private mode: server setting still persists */
  }
  listeners.forEach((l) => l());
}

export function useLeadsViewMode({ userSetting, workspaceDefault, persist }: UseLeadsViewModeOptions = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const local = useSyncExternalStore(subscribe, readLocal, () => null);
  const urlParam = searchParams.get(LEADS_VIEW_QUERY_PARAM);

  const mode = useMemo(
    () => resolveLeadsViewMode({ urlParam, userSetting, localStorageValue: local, workspaceDefault }),
    [urlParam, userSetting, local, workspaceDefault],
  );

  const setMode = useCallback(
    (next: LeadsViewMode) => {
      writeLocal(next);
      // Keep a shareable URL only if the visit already used one.
      if (urlParam) {
        const params = new URLSearchParams(searchParams.toString());
        params.set(LEADS_VIEW_QUERY_PARAM, next);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
      void persist?.(next);
    },
    [persist, urlParam, searchParams, router, pathname],
  );

  /** Shareable link for the current view (keeps other params, e.g. filters). */
  const shareHref = useCallback(
    (m: LeadsViewMode = mode) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(LEADS_VIEW_QUERY_PARAM, m);
      return `${pathname}?${params.toString()}`;
    },
    [mode, pathname, searchParams],
  );

  return { mode, setMode, shareHref, fromUrl: urlParam !== null && mode === urlParam } as const;
}
