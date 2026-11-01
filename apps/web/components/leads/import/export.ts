'use client';

import type { LeadFilters, LeadListItem } from '@vistar/shared';
import { format } from 'date-fns';
import Papa from 'papaparse';
import { getLeadsSource } from '@/lib/leads/data';
import { SOURCE_LABEL, TEMPERATURE_LABEL } from '../lead-meta';
import type { TableSort } from '../stores';

/** Trigger a browser download for a text file. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\uFEFF', text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** All leads matching the filters (paged through the leads source, 200 per page). */
export async function fetchAllLeads(
  filters: LeadFilters,
  sort: TableSort,
): Promise<LeadListItem[]> {
  const out: LeadListItem[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const page = await getLeadsSource().list({ ...filters, ...sort, limit: 200, cursor });
    out.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

/**
 * Export the current filtered list as CSV (Wave 1: client-side over the mock source; Wave 3:
 * GET /leads/export, which is audited). Formula-like cells are escaped for spreadsheet safety.
 */
export async function exportLeadsCsv(
  filters: LeadFilters,
  sort: TableSort,
  stageName: (stageId: string) => string | undefined,
): Promise<number> {
  const leads = await fetchAllLeads(filters, sort);
  const rows = leads.map((l) => ({
    Name: l.name,
    Company: l.companyName ?? '',
    Phone: l.phone ?? '',
    Email: l.email ?? '',
    City: l.city ?? '',
    Source: SOURCE_LABEL[l.source],
    Stage: stageName(l.stageId) ?? '',
    Owner: l.owner?.name ?? 'Unassigned',
    'Value (INR)': l.valueInr,
    Score: l.score,
    Temperature: TEMPERATURE_LABEL[l.temperature],
    Tags: l.tags.join(', '),
    'Next follow-up': l.nextFollowUpAt
      ? format(new Date(l.nextFollowUpAt), 'yyyy-MM-dd HH:mm')
      : '',
    Created: format(new Date(l.createdAt), 'yyyy-MM-dd HH:mm'),
  }));
  const csv = Papa.unparse(rows, { escapeFormulae: true });
  downloadText(`vistar-leads-${format(new Date(), 'yyyy-MM-dd')}.csv`, csv);
  return leads.length;
}
