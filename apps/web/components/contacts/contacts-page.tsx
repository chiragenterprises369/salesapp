'use client';

import { INDIAN_STATES, stateName, type ContactListItem } from '@vistar/shared';
import { Contact as ContactIcon, Mail, MapPin, Phone, Plus, Tag } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { useNow } from '@/components/common/use-now';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { useTagNames } from '@/lib/api/directory';
import { ago, formatPhone } from '@/lib/crm/format';
import { flatPages, useContactMutations, useContacts, type ContactQuery } from '@/lib/crm/parties';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { CrmTable, type CrmColumn } from '@/lib/crm/ui/crm-table';
import { useListState } from '@/lib/crm/ui/list-state';
import { PartyBulkBar } from '@/lib/crm/ui/party-bulk-bar';
import { ClearFilters, ColumnSetsMenu, CrmSearch, FacetFilter, ListToolbar, OwnerFilter } from '@/lib/crm/ui/list-toolbar';
import { useColumnPrefs } from '@/lib/crm/ui/use-column-prefs';
import { useCan } from '@/lib/session/session';
import { ContactFormSheet } from './contact-form';

interface Filters {
  ownerId?: string[];
  stateCode?: string[];
  tag?: string[];
}

const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s.code, label: s.name }));

/** Contacts (people): search, filters, column sets, bulk assign, tag and delete, create. */
export function ContactsPage() {
  return (
    <RequirePermission anyOf={['contacts.read']}>
      <ContactsList />
    </RequirePermission>
  );
}

function ContactsList() {
  useCrmRealtime();
  const now = useNow(60_000);
  const list = useListState<Filters>('contacts', { filters: {}, sort: { key: 'createdAt', dir: 'desc' } });
  const tags = useTagNames();
  const query: ContactQuery = { q: list.q || undefined, ...list.filters, sort: list.sort.key as ContactQuery['sort'], dir: list.sort.dir };
  const q = useContacts(query);
  const rows = flatPages(q.data);
  const canCreate = useCan('contacts.create');
  const canUpdate = useCan('contacts.update');
  const canDelete = useCan('contacts.delete');
  const [creating, setCreating] = useState(false);
  const m = useContactMutations();

  const columns = useMemo<CrmColumn<ContactListItem>[]>(
    () => [
      {
        id: 'name',
        label: 'Name',
        hideable: false,
        sortKey: 'name',
        cell: (c) => (
          <span className="inline-flex items-center gap-2">
            <Avatar name={c.name} size="xs" aria-hidden />
            <span className="truncate">{c.name}</span>
            {c.dnd && <Chip tone="red">DND</Chip>}
          </span>
        ),
      },
      { id: 'title', label: 'Designation', cell: (c) => c.title ?? '' },
      { id: 'account', label: 'Account', cell: (c) => (c.account ? <Link className="focus-ring rounded-sm hover:underline" href={`/app/accounts/${c.account.id}`}>{c.account.name}</Link> : '') },
      { id: 'phone', label: 'Phone', cell: (c) => formatPhone(c.phone) },
      { id: 'email', label: 'Email', cell: (c) => c.email ?? '' },
      { id: 'city', label: 'City', cell: (c) => [c.city, stateName(c.stateCode)].filter(Boolean).join(', ') },
      { id: 'owner', label: 'Owner', cell: (c) => c.owner?.name ?? <span className="text-muted">Unassigned</span> },
      { id: 'tags', label: 'Tags', cell: (c) => <span className="flex gap-1">{c.tags.slice(0, 3).map((t) => <Chip key={t}>{t}</Chip>)}</span> },
      { id: 'leads', label: 'Leads', align: 'right', cell: (c) => c.leadCount },
      { id: 'deals', label: 'Open deals', align: 'right', cell: (c) => c.openDealCount },
      { id: 'activity', label: 'Last activity', sortKey: 'lastActivityAt', firstDir: 'desc', cell: (c) => ago(c.lastActivityAt, now) },
      { id: 'created', label: 'Added', sortKey: 'createdAt', firstDir: 'desc', defaultHidden: true, cell: (c) => ago(c.createdAt, now) },
    ],
    [now],
  );
  const prefs = useColumnPrefs('contacts', columns);
  const status = q.isPending ? 'loading' : q.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';
  const total = q.data?.pages[0]?.total;

  return (
    <div className="flex w-full min-w-0 flex-col pb-20">
      <PageHeader
        title="Contacts"
        description="People at your customers and prospects, with their leads, deals, quotations and invoices."
        meta={total !== undefined ? <Chip>{total}</Chip> : undefined}
        actions={
          canCreate && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              New contact
            </Button>
          )
        }
      />
      <ListToolbar>
        <CrmSearch className="w-full sm:w-72" value={list.q} onChange={list.setQ} placeholder="Search name, phone, email, GSTIN" label="Search contacts" />
        <OwnerFilter value={list.filters.ownerId} onChange={(ownerId) => list.setFilters({ ownerId })} />
        <FacetFilter label="State" icon={<MapPin aria-hidden />} options={STATE_OPTIONS} value={list.filters.stateCode} onChange={(stateCode) => list.setFilters({ stateCode })} />
        {tags.length > 0 && <FacetFilter label="Tag" icon={<Tag aria-hidden />} options={tags.map((t) => ({ value: t, label: t }))} value={list.filters.tag} onChange={(tag) => list.setFilters({ tag })} />}
        <ClearFilters active={list.hasFilters} onClear={list.resetFilters} />
        <div className="ml-auto">
          <ColumnSetsMenu {...prefs.menu} />
        </div>
      </ListToolbar>
      <CrmTable
        label="Contacts"
        rows={rows}
        getId={(c) => c.id}
        columns={columns}
        visible={prefs.visible}
        status={status}
        onRetry={() => void q.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        rowHref={(c) => `/app/contacts/${c.id}`}
        selection={canUpdate || canDelete ? { selected: list.selected, onChange: list.setSelected } : undefined}
        hasMore={q.hasNextPage}
        loadingMore={q.isFetchingNextPage}
        onLoadMore={() => void q.fetchNextPage()}
        rowActions={(c) => (
          <>
            {c.phone && (
              <Button asChild size="icon-sm" variant="ghost" aria-label={`Call ${c.name}`}>
                <a href={`tel:${c.phone}`}>
                  <Phone aria-hidden />
                </a>
              </Button>
            )}
            {c.email && (
              <Button asChild size="icon-sm" variant="ghost" aria-label={`Email ${c.name}`}>
                <a href={`mailto:${c.email}`}>
                  <Mail aria-hidden />
                </a>
              </Button>
            )}
          </>
        )}
        mobileCard={(c) => (
          <Link href={`/app/contacts/${c.id}`} className="focus-ring block rounded-sm">
            <span className="block truncate text-sm font-medium text-fg">{c.name}</span>
            <span className="block truncate text-xs text-muted-strong">{[c.title, c.account?.name].filter(Boolean).join(' at ')}</span>
            <span className="block truncate text-xs text-muted-strong">{[formatPhone(c.phone), c.city].filter(Boolean).join(' · ')}</span>
          </Link>
        )}
        empty={
          list.hasFilters
            ? { icon: <ContactIcon />, title: 'No contacts match these filters', description: 'Clear the filters or search for another name.', action: <Button onClick={list.resetFilters}>Clear filters</Button> }
            : {
                icon: <ContactIcon />,
                title: 'No contacts yet',
                description: 'Add the people you sell to, or convert a lead to create its contact and account.',
                action: canCreate && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus aria-hidden />
                    New contact
                  </Button>
                ),
              }
        }
      />
      <PartyBulkBar
        noun={{ one: 'contact', many: 'contacts' }}
        selected={list.selected}
        onClear={list.clearSelection}
        canUpdate={canUpdate}
        canDelete={canDelete}
        bulk={(a) => m.bulk.mutateAsync(a)}
        pending={m.bulk.isPending}
        deleteNote="Their leads, deals and documents stay; the link to this person is removed. This cannot be undone."
      />
      {creating && <ContactFormSheet open onOpenChange={setCreating} />}
    </div>
  );
}
