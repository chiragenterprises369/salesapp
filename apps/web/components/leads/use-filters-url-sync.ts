'use client';

import { LeadFiltersSchema } from '@vistar/shared';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { filtersToSearchParams, searchParamsToFilters, useLeadsViewState } from '@/lib/leads/state';

const FILTER_KEYS = Object.keys(LeadFiltersSchema.shape);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Mirrors the shared Leads filters into the URL so links are shareable.
 * On mount: URL filters (if any) win; otherwise the current shared state is written to the URL.
 * Afterwards every filter change replaces the URL (no history entries, no refetch of the page).
 */
export function useFiltersUrlSync() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const filters = useLeadsViewState((s) => s.filters);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      const fromUrl = searchParamsToFilters(new URLSearchParams(searchParams.toString()));
      const urlHasFilters = FILTER_KEYS.some((k) => searchParams.has(k));
      if (urlHasFilters && !same(fromUrl, filters)) {
        useLeadsViewState.getState().replaceFilters(fromUrl);
        return;
      }
      if (urlHasFilters) return;
    }
    const current = new URLSearchParams(window.location.search);
    const next = filtersToSearchParams(filters, current);
    if (next.toString() === current.toString()) return;
    const qs = next.toString();
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  }, [filters, pathname, searchParams]);
}
