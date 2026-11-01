'use client';

import type { LeadListItem } from '@vistar/shared';
import { useMemo } from 'react';
import { useLeadsList } from '@/lib/leads/data';
import { useLeadsViewState } from '@/lib/leads/state';
import { countActiveFilters } from './filters-panel';
import { useTablePrefs } from './stores';

/** Shared list data for the Table and the mobile cards (infinite, shared filters + Table sort). */
export function useTableRows() {
  const filters = useLeadsViewState((s) => s.filters);
  const sort = useTablePrefs((s) => s.sort);
  const query = useLeadsList(filters, sort);
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: LeadListItem[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const l of page.items) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        out.push(l);
      }
    }
    return out;
  }, [query.data]);
  const total = query.data?.pages[0]?.total ?? rows.length;
  const hasFilters = countActiveFilters(filters) > 0 || !!filters.q;
  return { query, rows, total, hasFilters };
}
