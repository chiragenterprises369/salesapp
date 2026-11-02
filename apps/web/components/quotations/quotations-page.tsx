'use client';

import { formatPaise, QUOTATION_STATUSES, type QuotationListItem } from '@vistar/shared';
import { FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { useNow } from '@/components/common/use-now';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { useQuotations, type QuotationQuery } from '@/lib/crm/documents';
import { ago, formatDay, QUOTATION_STATUS } from '@/lib/crm/format';
import { flatPages } from '@/lib/crm/parties';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { CrmTable, type CrmColumn } from '@/lib/crm/ui/crm-table';
import { useListState } from '@/lib/crm/ui/list-state';
import { ClearFilters, ColumnSetsMenu, CrmSearch, FacetFilter, ListToolbar } from '@/lib/crm/ui/list-toolbar';
import { useColumnPrefs } from '@/lib/crm/ui/use-column-prefs';
import { useCan, useMe } from '@/lib/session/session';

interface Filters {
  status?: string[];
  mine?: string[];
}

/** Quotations with numbers per financial year, status, totals with GST. */
export function QuotationsPage() {
  return (
    <RequirePermission anyOf={['quotations.read']}>
      <Quotations />
    </RequirePermission>
  );
}

function Quotations() {
  useCrmRealtime();
  const me = useMe();
  const now = useNow(60_000);
  const list = useListState<Filters>('quotations', { filters: {}, sort: { key: 'issueDate', dir: 'desc' } });
  const query: QuotationQuery = {
    q: list.q || undefined,
    status: list.filters.status as QuotationQuery['status'],
    ownerId: list.filters.mine?.length ? ['me'] : undefined,
    sort: list.sort.key as QuotationQuery['sort'],
    dir: list.sort.dir,
  };
  const q = useQuotations(query);
  const rows = flatPages(q.data);
  const canCreate = useCan('quotations.create');

  const columns = useMemo<CrmColumn<QuotationListItem>[]>(
    () => [
      { id: 'number', label: 'Number', hideable: false, sortKey: 'number', cell: (r) => <span className="font-mono text-xs">{r.number}</span> },
      { id: 'buyer', label: 'Buyer', cell: (r) => r.buyerName },
      { id: 'account', label: 'Account', defaultHidden: true, cell: (r) => (r.account ? <Link className="focus-ring rounded-sm hover:underline" href={`/app/accounts/${r.account.id}`}>{r.account.name}</Link> : '') },
      { id: 'date', label: 'Date', sortKey: 'issueDate', firstDir: 'desc', cell: (r) => formatDay(r.issueDate) },
      { id: 'valid', label: 'Valid until', cell: (r) => formatDay(r.validUntil) },
      { id: 'tax', label: 'GST', cell: (r) => (r.taxMode === 'inter' ? 'IGST' : 'CGST + SGST') },
      { id: 'total', label: 'Total', align: 'right', sortKey: 'totalPaise', firstDir: 'desc', cell: (r) => formatPaise(r.totalPaise) },
      { id: 'status', label: 'Status', cell: (r) => <Chip tone={QUOTATION_STATUS[r.status].tone}>{QUOTATION_STATUS[r.status].label}</Chip> },
      { id: 'invoice', label: 'Invoice', cell: (r) => (r.convertedInvoiceId ? <Link className="focus-ring rounded-sm hover:underline" href={`/app/invoices/${r.convertedInvoiceId}`}>Invoiced</Link> : '') },
      { id: 'owner', label: 'Owner', cell: (r) => r.owner?.name ?? '' },
      { id: 'updated', label: 'Updated', sortKey: 'updatedAt', firstDir: 'desc', defaultHidden: true, cell: (r) => ago(r.updatedAt, now) },
    ],
    [now],
  );
  const prefs = useColumnPrefs('quotations', columns);
  const status = q.isPending ? 'loading' : q.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <PageHeader
        title="Quotations"
        description="GST quotations numbered per financial year. Send by link, track acceptance, convert to an invoice."
        actions={
          canCreate && (
            <Button variant="primary" asChild>
              <Link href="/app/quotations/new">
                <Plus aria-hidden />
                New quotation
              </Link>
            </Button>
          )
        }
      />
      <ListToolbar>
        <CrmSearch className="w-full sm:w-72" value={list.q} onChange={list.setQ} placeholder="Search number or buyer" label="Search quotations" />
        <FacetFilter label="Status" options={QUOTATION_STATUSES.map((s) => ({ value: s, label: QUOTATION_STATUS[s].label }))} value={list.filters.status} onChange={(s) => list.setFilters({ status: s })} />
        {me?.role.dataScope !== 'own' && <FacetFilter label="Owner" options={[{ value: 'me', label: 'Mine only' }]} value={list.filters.mine} onChange={(mine) => list.setFilters({ mine })} />}
        <ClearFilters active={list.hasFilters} onClear={list.resetFilters} />
        <div className="ml-auto">
          <ColumnSetsMenu {...prefs.menu} />
        </div>
      </ListToolbar>
      <CrmTable
        label="Quotations"
        rows={rows}
        getId={(r) => r.id}
        columns={columns}
        visible={prefs.visible}
        status={status}
        onRetry={() => void q.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        rowHref={(r) => `/app/quotations/${r.id}`}
        hasMore={q.hasNextPage}
        loadingMore={q.isFetchingNextPage}
        onLoadMore={() => void q.fetchNextPage()}
        mobileCard={(r) => (
          <Link href={`/app/quotations/${r.id}`} className="focus-ring block rounded-sm">
            <span className="flex justify-between gap-2">
              <span className="truncate text-sm font-medium text-fg">{r.buyerName}</span>
              <span className="text-sm tabular-nums">{formatPaise(r.totalPaise)}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-strong">
              {r.number} · {formatDay(r.issueDate)} <Chip tone={QUOTATION_STATUS[r.status].tone}>{QUOTATION_STATUS[r.status].label}</Chip>
            </span>
          </Link>
        )}
        empty={
          list.hasFilters
            ? { icon: <FileText />, title: 'No quotations match these filters', description: 'Clear the filters or search for another number.', action: <Button onClick={list.resetFilters}>Clear filters</Button> }
            : {
                icon: <FileText />,
                title: 'No quotations yet',
                description: 'Create a quotation for an account or from a deal. GST is worked out from your state and the place of supply.',
                action: canCreate && (
                  <Button variant="primary" asChild>
                    <Link href="/app/quotations/new">New quotation</Link>
                  </Button>
                ),
              }
        }
      />
    </div>
  );
}
