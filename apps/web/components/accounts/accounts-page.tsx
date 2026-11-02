'use client';

import { formatInr, INDIAN_STATES, stateName, type AccountListItem, type IndianStateCode } from '@vistar/shared';
import { Building2, Globe, MapPin, Phone, Plus, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { useNow } from '@/components/common/use-now';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { useTagNames } from '@/lib/api/directory';
import { ago, formatPhone } from '@/lib/crm/format';
import { flatPages, useAccountMutations, useAccounts, type AccountQuery } from '@/lib/crm/parties';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { CrmTable, type CrmColumn } from '@/lib/crm/ui/crm-table';
import { useListState } from '@/lib/crm/ui/list-state';
import { ClearFilters, ColumnSetsMenu, CrmSearch, FacetFilter, ListToolbar, OwnerFilter } from '@/lib/crm/ui/list-toolbar';
import { PartyBulkBar } from '@/lib/crm/ui/party-bulk-bar';
import { useColumnPrefs } from '@/lib/crm/ui/use-column-prefs';
import { useCan } from '@/lib/session/session';
import { AccountFormSheet } from './account-form';

interface Filters {
  ownerId?: string[];
  stateCode?: IndianStateCode[];
  tag?: string[];
}

const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s.code, label: s.name }));

/** Accounts (companies): search, filters, column sets, bulk actions, create. */
export function AccountsPage() {
  return (
    <RequirePermission anyOf={['accounts.read']}>
      <AccountsList />
    </RequirePermission>
  );
}

function AccountsList() {
  useCrmRealtime();
  const now = useNow(60_000);
  const list = useListState<Filters>('accounts', { filters: {}, sort: { key: 'createdAt', dir: 'desc' } });
  const tags = useTagNames();
  const query: AccountQuery = { q: list.q || undefined, ...list.filters, sort: list.sort.key as AccountQuery['sort'], dir: list.sort.dir };
  const q = useAccounts(query);
  const rows = flatPages(q.data);
  const m = useAccountMutations();
  const canCreate = useCan('accounts.create');
  const canUpdate = useCan('accounts.update');
  const canDelete = useCan('accounts.delete');
  const [creating, setCreating] = useState(false);

  const columns = useMemo<CrmColumn<AccountListItem>[]>(
    () => [
      { id: 'name', label: 'Account', hideable: false, sortKey: 'name', cell: (a) => a.name },
      { id: 'industry', label: 'Industry', cell: (a) => a.industry ?? '' },
      { id: 'gstin', label: 'GSTIN', cell: (a) => (a.gstin ? <span className="font-mono text-xs">{a.gstin}</span> : '') },
      { id: 'city', label: 'City', cell: (a) => [a.city, stateName(a.stateCode)].filter(Boolean).join(', ') },
      { id: 'phone', label: 'Phone', cell: (a) => formatPhone(a.phone) },
      { id: 'website', label: 'Website', defaultHidden: true, cell: (a) => a.website?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '' },
      { id: 'owner', label: 'Owner', cell: (a) => a.owner?.name ?? <span className="text-muted">Unassigned</span> },
      { id: 'contacts', label: 'Contacts', align: 'right', cell: (a) => a.contactCount },
      { id: 'deals', label: 'Open deals', align: 'right', cell: (a) => a.openDealCount },
      { id: 'pipeline', label: 'Open value', align: 'right', cell: (a) => (a.openDealValueInr ? formatInr(a.openDealValueInr, { compact: true }) : '') },
      { id: 'tags', label: 'Tags', defaultHidden: true, cell: (a) => <span className="flex gap-1">{a.tags.slice(0, 3).map((t) => <Chip key={t}>{t}</Chip>)}</span> },
      { id: 'activity', label: 'Last activity', sortKey: 'lastActivityAt', firstDir: 'desc', cell: (a) => ago(a.lastActivityAt, now) },
      { id: 'created', label: 'Added', sortKey: 'createdAt', firstDir: 'desc', defaultHidden: true, cell: (a) => ago(a.createdAt, now) },
    ],
    [now],
  );
  const prefs = useColumnPrefs('accounts', columns);
  const status = q.isPending ? 'loading' : q.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';
  const total = q.data?.pages[0]?.total;

  return (
    <div className="flex w-full min-w-0 flex-col pb-20">
      <PageHeader
        title="Accounts"
        description="Companies you sell to, with their GSTIN, addresses, people, deals and documents."
        meta={total !== undefined ? <Chip>{total}</Chip> : undefined}
        actions={
          canCreate && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              New account
            </Button>
          )
        }
      />
      <ListToolbar>
        <CrmSearch className="w-full sm:w-72" value={list.q} onChange={list.setQ} placeholder="Search name, GSTIN, phone, website" label="Search accounts" />
        <OwnerFilter value={list.filters.ownerId} onChange={(ownerId) => list.setFilters({ ownerId })} />
        <FacetFilter label="State" icon={<MapPin aria-hidden />} options={STATE_OPTIONS} value={list.filters.stateCode} onChange={(stateCode) => list.setFilters({ stateCode: stateCode as IndianStateCode[] | undefined })} />
        {tags.length > 0 && <FacetFilter label="Tag" icon={<Tag aria-hidden />} options={tags.map((t) => ({ value: t, label: t }))} value={list.filters.tag} onChange={(tag) => list.setFilters({ tag })} />}
        <ClearFilters active={list.hasFilters} onClear={list.resetFilters} />
        <div className="ml-auto">
          <ColumnSetsMenu {...prefs.menu} />
        </div>
      </ListToolbar>
      <CrmTable
        label="Accounts"
        rows={rows}
        getId={(a) => a.id}
        columns={columns}
        visible={prefs.visible}
        status={status}
        onRetry={() => void q.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        rowHref={(a) => `/app/accounts/${a.id}`}
        selection={canUpdate || canDelete ? { selected: list.selected, onChange: list.setSelected } : undefined}
        hasMore={q.hasNextPage}
        loadingMore={q.isFetchingNextPage}
        onLoadMore={() => void q.fetchNextPage()}
        rowActions={(a) => (
          <>
            {a.phone && (
              <Button asChild size="icon-sm" variant="ghost" aria-label={`Call ${a.name}`}>
                <a href={`tel:${a.phone}`}>
                  <Phone aria-hidden />
                </a>
              </Button>
            )}
            {a.website && (
              <Button asChild size="icon-sm" variant="ghost" aria-label={`Open the website of ${a.name}`}>
                <a href={a.website} target="_blank" rel="noreferrer">
                  <Globe aria-hidden />
                </a>
              </Button>
            )}
          </>
        )}
        mobileCard={(a) => (
          <Link href={`/app/accounts/${a.id}`} className="focus-ring block rounded-sm">
            <span className="block truncate text-sm font-medium text-fg">{a.name}</span>
            <span className="block truncate text-xs text-muted-strong">{[a.city, stateName(a.stateCode), a.gstin].filter(Boolean).join(' · ')}</span>
            <span className="block truncate text-xs text-muted-strong">
              {a.contactCount} {a.contactCount === 1 ? 'contact' : 'contacts'} · {a.openDealCount} open {a.openDealCount === 1 ? 'deal' : 'deals'}
            </span>
          </Link>
        )}
        empty={
          list.hasFilters
            ? { icon: <Building2 />, title: 'No accounts match these filters', description: 'Clear the filters or search for another name.', action: <Button onClick={list.resetFilters}>Clear filters</Button> }
            : {
                icon: <Building2 />,
                title: 'No accounts yet',
                description: 'Add the companies you sell to. Converting a lead with a company name creates its account.',
                action: canCreate && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus aria-hidden />
                    New account
                  </Button>
                ),
              }
        }
      />
      <PartyBulkBar
        noun={{ one: 'account', many: 'accounts' }}
        selected={list.selected}
        onClear={list.clearSelection}
        canUpdate={canUpdate}
        canDelete={canDelete}
        bulk={(a) => m.bulk.mutateAsync(a)}
        pending={m.bulk.isPending}
        deleteNote="Contacts, deals and documents stay; their link to the account is removed. This cannot be undone."
      />
      {creating && <AccountFormSheet open onOpenChange={setCreating} />}
    </div>
  );
}
