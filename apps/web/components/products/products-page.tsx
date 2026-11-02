'use client';

import { formatPaise, GST_RATES, PRODUCT_UNIT_LABELS, type Product } from '@vistar/shared';
import { Package, Pencil, Percent, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { Segmented } from '@/components/dashboard/segmented';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { useProductMutations, useProducts, type ProductQuery } from '@/lib/crm/catalog';
import { flatPages } from '@/lib/crm/parties';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { CrmTable, type CrmColumn } from '@/lib/crm/ui/crm-table';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { useListState } from '@/lib/crm/ui/list-state';
import { ClearFilters, ColumnSetsMenu, CrmSearch, FacetFilter, ListToolbar } from '@/lib/crm/ui/list-toolbar';
import { useColumnPrefs } from '@/lib/crm/ui/use-column-prefs';
import { useCan } from '@/lib/session/session';
import { PriceListsPanel } from './price-lists';
import { ProductFormSheet } from './product-form';

interface Filters {
  gstRate?: string[];
  active?: string[];
  kind?: string[];
}

/** Products and services with HSN/SAC and GST rates, plus price lists. */
export function ProductsPage() {
  return (
    <RequirePermission anyOf={['products.read']}>
      <Products />
    </RequirePermission>
  );
}

function Products() {
  useCrmRealtime();
  const [tab, setTab] = useState<'products' | 'price-lists'>('products');
  const canManage = useCan('products.manage');
  const list = useListState<Filters>('products', { filters: { active: ['true'] }, sort: { key: 'name', dir: 'asc' } });
  const query: ProductQuery = {
    q: list.q || undefined,
    gstRate: list.filters.gstRate?.map(Number) as ProductQuery['gstRate'],
    active: list.filters.active?.length === 1 ? list.filters.active[0] === 'true' : undefined,
    kind: list.filters.kind?.length === 1 ? (list.filters.kind[0] as ProductQuery['kind']) : undefined,
    sort: list.sort.key as ProductQuery['sort'],
    dir: list.sort.dir,
  };
  const q = useProducts(query, { enabled: tab === 'products' });
  const rows = flatPages(q.data);
  const m = useProductMutations();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);

  const columns = useMemo<CrmColumn<Product>[]>(
    () => [
      { id: 'name', label: 'Product', hideable: false, sortKey: 'name', cell: (p) => <span className={p.active ? undefined : 'text-muted-strong line-through'}>{p.name}</span> },
      { id: 'sku', label: 'SKU', sortKey: 'sku', cell: (p) => <span className="font-mono text-xs">{p.sku}</span> },
      { id: 'kind', label: 'Type', cell: (p) => (p.kind === 'service' ? 'Service' : 'Goods') },
      { id: 'hsn', label: 'HSN/SAC', cell: (p) => <span className="font-mono text-xs">{p.hsnSac}</span> },
      { id: 'unit', label: 'Unit', cell: (p) => <span title={PRODUCT_UNIT_LABELS[p.unit]}>{p.unit}</span> },
      { id: 'gst', label: 'GST', align: 'right', cell: (p) => `${p.gstRate}%` },
      { id: 'price', label: 'Price (before GST)', align: 'right', sortKey: 'unitPricePaise', firstDir: 'desc', cell: (p) => formatPaise(p.unitPricePaise) },
      { id: 'withGst', label: 'Price with GST', align: 'right', defaultHidden: true, cell: (p) => formatPaise(Math.round(p.unitPricePaise * (1 + p.gstRate / 100))) },
      { id: 'status', label: 'Status', cell: (p) => (p.active ? <Chip tone="green">Active</Chip> : <Chip tone="grey">Inactive</Chip>) },
    ],
    [],
  );
  const prefs = useColumnPrefs('products', columns);
  const status = q.isPending ? 'loading' : q.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';

  const toggleActive = async (p: Product) => {
    try {
      await m.update.mutateAsync({ id: p.id, patch: { active: !p.active, expectedUpdatedAt: p.updatedAt } });
      toast.success(p.active ? `${p.name} is inactive` : `${p.name} is active again`);
    } catch (e) {
      toast.error(formErrorMessage(e));
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <PageHeader
        title="Products"
        description="Your catalogue with HSN/SAC codes and GST rates. Prices exclude GST."
        actions={
          canManage &&
          tab === 'products' && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              New product
            </Button>
          )
        }
      />
      <Segmented
        className="mb-3 self-start"
        label="Section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'products', label: 'Products' },
          { value: 'price-lists', label: 'Price lists' },
        ]}
      />
      {tab === 'price-lists' ? (
        <PriceListsPanel canManage={canManage} />
      ) : (
        <>
          <ListToolbar>
            <CrmSearch className="w-full sm:w-72" value={list.q} onChange={list.setQ} placeholder="Search name, SKU or HSN/SAC" label="Search products" />
            <FacetFilter label="GST rate" icon={<Percent aria-hidden />} options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} value={list.filters.gstRate} onChange={(gstRate) => list.setFilters({ gstRate })} />
            <FacetFilter label="Type" options={[{ value: 'goods', label: 'Goods' }, { value: 'service', label: 'Services' }]} value={list.filters.kind} onChange={(kind) => list.setFilters({ kind })} />
            <FacetFilter label="Status" options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} value={list.filters.active} onChange={(active) => list.setFilters({ active })} />
            <ClearFilters active={list.hasFilters} onClear={list.resetFilters} />
            <div className="ml-auto">
              <ColumnSetsMenu {...prefs.menu} />
            </div>
          </ListToolbar>
          <CrmTable
            label="Products"
            rows={rows}
            getId={(p) => p.id}
            columns={columns}
            visible={prefs.visible}
            status={status}
            onRetry={() => void q.refetch()}
            sort={list.sort}
            onSortChange={list.setSort}
            hasMore={q.hasNextPage}
            loadingMore={q.isFetchingNextPage}
            onLoadMore={() => void q.fetchNextPage()}
            rowActions={
              canManage
                ? (p) => (
                    <>
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void toggleActive(p)}>
                        {p.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </>
                  )
                : undefined
            }
            mobileCard={(p) => (
              <button type="button" className="focus-ring block w-full rounded-sm text-left" onClick={() => canManage && setEditing(p)} disabled={!canManage}>
                <span className="flex justify-between gap-2">
                  <span className="truncate text-sm font-medium text-fg">{p.name}</span>
                  <span className="text-sm tabular-nums">{formatPaise(p.unitPricePaise)}</span>
                </span>
                <span className="block text-xs text-muted-strong">
                  {p.sku} · HSN/SAC {p.hsnSac} · GST {p.gstRate}% · {p.unit}
                </span>
              </button>
            )}
            empty={
              list.hasFilters
                ? { icon: <Package />, title: 'No products match these filters', description: 'Clear the filters or search for another name.', action: <Button onClick={list.resetFilters}>Clear filters</Button> }
                : {
                    icon: <Package />,
                    title: 'No products yet',
                    description: 'Add what you sell with its HSN or SAC code and GST rate, then pick products on quotations and invoices.',
                    action: canManage && (
                      <Button variant="primary" onClick={() => setEditing('new')}>
                        <Plus aria-hidden />
                        New product
                      </Button>
                    ),
                  }
            }
          />
        </>
      )}
      {editing && <ProductFormSheet open onOpenChange={(o) => !o && setEditing(null)} product={editing === 'new' ? undefined : editing} />}
    </div>
  );
}
