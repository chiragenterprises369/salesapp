'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { Board, LeadListItem, Page } from '@vistar/shared';
import { leadKeys } from '@/lib/leads/data';

/** Look up lead list items already in the cache (Table pages and Board columns). */
export function findCachedLeads(qc: QueryClient, ids: Iterable<string>): LeadListItem[] {
  const wanted = new Set(ids);
  const found = new Map<string, LeadListItem>();
  for (const [, data] of qc.getQueriesData<{ pages: Page<LeadListItem>[] }>({
    queryKey: leadKeys.lists(),
  })) {
    data?.pages.forEach((p) => p.items.forEach((l) => wanted.has(l.id) && found.set(l.id, l)));
  }
  for (const [, board] of qc.getQueriesData<Board>({ queryKey: leadKeys.boards() })) {
    board?.columns?.forEach((c) =>
      c.leads.forEach((l) => wanted.has(l.id) && !found.has(l.id) && found.set(l.id, l)),
    );
  }
  return [...found.values()];
}
