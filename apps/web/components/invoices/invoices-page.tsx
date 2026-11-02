'use client';

import { formatPaise, INVOICE_STATUSES, type InvoiceListItem } from '@vistar/shared';
import { Plus, ReceiptIndianRupee } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { useNow } from '@/components/common/use-now';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { useInvoices, type InvoiceQuery } from '@/lib/crm/documents';
import { ago, formatDay, INVOICE_STATUS } from '@/lib/crm/format';
import { flatPages } from '@/lib/crm/parties';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { CrmTable, type CrmColumn } from '@/lib/crm/ui/crm-table';
import { useListState } from '@/lib/crm/ui/list-state';
import { ClearFilters, ColumnSetsMenu, CrmSearch, FacetFilter, ListToolbar } from '@/lib/crm/ui/list-toolbar';
import { useColumnPrefs } from '@/lib/crm/ui/use-column-prefs';
import { useCan, useMe } from '@/lib/session/session';

interface Filters {
  status?: string[];
  overdue?: string[];
  mine?: string[];
}

export function invoiceChip(i: Pick<InvoiceListItem, 'status' | 'overdue'>) {
  return i.overdue ? <Chip tone="red">Overdue</Chip> : <Chip tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Chip>;
}

/** Invoices with GST, payments and balance due. */
export function InvoicesPage() {
  return (
    <RequirePermission anyOf={['invoices.read']}>
      <Invoices />
    </RequirePermission>
  );
}

function Invoices() {
  useCrmRealtime();
  const me = useMe();
  const now = useNow(60_000);
  const list = useListState<Filters>('invoices', { filters: {}, sort: { key: 'issueDate', dir: 'desc' } });
  const query: InvoiceQuery = {
    q: list.q || undefined,
    status: list.filters.status as InvoiceQuery['status'],
    overdue: list.filters.overdue?.length ? true : undefined,
    ownerId: list.filters.mine?.length ? ['me'] : undefined,
    sort: list.sort.key as InvoiceQuery['sort'],
    dir: list.sort.dir,
  };
  const q = useInvoices(query);
  const rows = flatPages(q.data);
  const canCreate = useCan('invoices.create');

  const columns = useMemo<CrmColumn<InvoiceListItem>[]>(
    () => [
      { id: 'number', label: 'Number', hideable: false, sortKey: 'number', cell: (r) => (r.number ? <span className="font-mono text-xs">{r.number}</span> : <span className="text-muted-strong">Draft</span>) },
      { id: 'buyer', label: 'Buyer', cell: (r) => r.buyerName },
      { id: 'date', label: 'Date', sortKey: 'issueDate', firstDir: 'desc', cell: (r) => formatDay(r.issueDate) },
      { id: 'due', label: 'Due', sortKey: 'dueDate', firstDir: 'asc', cell: (r) => formatDay(r.dueDate) },
      { id: 'tax', label: 'GST', defaultHidden: true, cell: (r) => (r.taxMode === 'inter' ? 'IGST' : 'CGST + SGST') },
      { id: 'total', label: 'Total', align: 'right', sortKey: 'totalPaise', firstDir: 'desc', cell: (r) => formatPaise(r.totalPaise) },
      { id: 'paid', label: 'Paid', align: 'right', cell: (r) => (r.paidPaise ? formatPaise(r.paidPaise) : '') },
      { id: 'balance', label: 'Balance', align: 'right', cell: (r) => (r.status === 'draft' || r.status === 'cancelled' ? '' : formatPaise(r.balancePaise)) },
      { id: 'status', label: 'Status', cell: invoiceChip },
      { id: 'quotation', label: 'Quotation', defaultHidden: true, cell: (r) => (r.quotationId ? <Link className="focus-ring rounded-sm hover:underline" href={`/app/quotations/${r.quotationId}`}>Open</Link> : '') },
      { id: 'owner', label: 'Owner', cell: (r) => r.owner?.name ?? '' },
      { id: 'updated', label: 'Updated', sortKey: 'updatedAt', firstDir: 'desc', defaultHidden: true, cell: (r) => ago(r.updatedAt, now) },
    ],
    [now],
  );
  const prefs = useColumnPrefs('invoices', columns);
  const status = q.isPending ? 'loading' : q.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <PageHeader
        title="Invoices"
        description="GST invoices with gap-free numbers per financial year, payments and balance due."
        actions={
          canCreate && (
            <Button variant="primary" asChild>
              <Link href="/app/invoices/new">
                <Plus aria-hidden />
                New invoice
              </Link>
            </Button>
          )
        }
      />
      <ListToolbar>
        <CrmSearch className="w-full sm:w-72" value={list.q} onChange={list.setQ} placeholder="Search number or buyer" label="Search invoices" />
        <FacetFilter label="Status" options={INVOICE_STATUSES.map((s) => ({ value: s, label: INVOICE_STATUS[s].label }))} value={list.filters.status} onChange={(s) => list.setFilters({ status: s })} />
        <FacetFilter label="Due" options={[{ value: 'overdue', label: 'Overdue only' }]} value={list.filters.overdue} onChange={(overdue) => list.setFilters({ overdue })} />
        {me?.role.dataScope !== 'own' && <FacetFilter label="Owner" options={[{ value: 'me', label: 'Mine only' }]} value={list.filters.mine} onChange={(mine) => list.setFilters({ mine })} />}
        <ClearFilters active={list.hasFilters} onClear={list.resetFilters} />
        <div className="ml-auto">
          <ColumnSetsMenu {...prefs.menu} />
        </div>
      </ListToolbar>
      <CrmTable
        label="Invoices"
        rows={rows}
        getId={(r) => r.id}
        columns={columns}
        visible={prefs.visible}
        status={status}
        onRetry={() => void q.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        rowHref={(r) => `/app/invoices/${r.id}`}
        hasMore={q.hasNextPage}
        loadingMore={q.isFetchingNextPage}
        onLoadMore={() => void q.fetchNextPage()}
        mobileCard={(r) => (
          <Link href={`/app/invoices/${r.id}`} className="focus-ring block rounded-sm">
            <span className="flex justify-between gap-2">
              <span className="truncate text-sm font-medium text-fg">{r.buyerName}</span>
              <span className="text-sm tabular-nums">{formatPaise(r.totalPaise)}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-strong">
              {r.number ?? 'Draft'} · {formatDay(r.issueDate)} {invoiceChip(r)}
            </span>
          </Link>
        )}
        empty={
          list.hasFilters
            ? { icon: <ReceiptIndianRupee />, title: 'No invoices match these filters', description: 'Clear the filters or search for another number.', action: <Button onClick={list.resetFilters}>Clear filters</Button> }
            : {
                icon: <ReceiptIndianRupee />,
                title: 'No invoices yet',
                description: 'Convert an accepted quotation or create an invoice. Numbers are given when you issue it.',
                action: canCreate && (
                  <Button variant="primary" asChild>
                    <Link href="/app/invoices/new">New invoice</Link>
                  </Button>
                ),
              }
        }
      />
    </div>
  );
}
