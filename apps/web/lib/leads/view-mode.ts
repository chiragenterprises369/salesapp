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
 * URL ?view= > this session's toggle > user setting (server) > localStorage > workspace default > "board".
 *
 * frontend-app wires `userSetting` / `workspaceDefault` from the /auth/me query and `persist`
 * to PATCH /me/settings { leadsViewMode } (update the me cache on success).
 */
export interface UseLeadsViewModeOptions {
  /** undefined while settings are loading; null when the user never chose. */
  userSetting?: LeadsViewMode | null;
  workspaceDefault?: LeadsViewMode | null;
  persist?: (mode: LeadsViewMode) => Promise<unknown> | void;
}

// Session choice + localStorage mirror in one tiny external store (shared by every hook instance).
let sessionChoice: LeadsViewMode | null = null;
let localSnapshot: string | null | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== LEADS_VIEW_STORAGE_KEY) return;
    localSnapshot = e.newValue;
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function readLocal(): string | null {
  if (localSnapshot !== undefined) return localSnapshot;
  try {
    localSnapshot = window.localStorage.getItem(LEADS_VIEW_STORAGE_KEY);
  } catch {
    localSnapshot = null;
  }
  return localSnapshot;
}

const getSession = () => sessionChoice;

function choose(mode: LeadsViewMode) {
  sessionChoice = mode;
  localSnapshot = mode;
  try {
    window.localStorage.setItem(LEADS_VIEW_STORAGE_KEY, mode);
  } catch {
    /* private mode: the session choice and server setting still apply */
  }
  emit();
}

export function useLeadsViewMode({ userSetting, workspaceDefault, persist }: UseLeadsViewModeOptions = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const local = useSyncExternalStore(subscribe, readLocal, () => null);
  const session = useSyncExternalStore(subscribe, getSession, () => null);
  const urlParam = searchParams.get(LEADS_VIEW_QUERY_PARAM);

  const mode = useMemo(
    () => resolveLeadsViewMode({ urlParam, sessionChoice: session, userSetting, localStorageValue: local, workspaceDefault }),
    [urlParam, session, userSetting, local, workspaceDefault],
  );

  const setMode = useCallback(
    (next: LeadsViewMode) => {
      choose(next);
      // Keep a shareable URL only if this visit already used one.
      if (urlParam) {
        const params = new URLSearchParams(searchParams.toString());
        params.set(LEADS_VIEW_QUERY_PARAM, next);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
      void Promise.resolve(persist?.(next)).catch(() => undefined);
    },
    [persist, urlParam, searchParams, router, pathname],
  );

  /** Shareable link for a view (keeps other params, e.g. filters). */
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

/** Test helper: reset module state between tests. */
export function __resetLeadsViewModeForTests() {
  sessionChoice = null;
  localSnapshot = undefined;
  emit();
}
