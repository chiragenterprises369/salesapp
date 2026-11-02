'use client';

import { formatInr } from '@vistar/shared';
import { useState } from 'react';
import { useLeadsList } from '@/lib/leads/data';
import { useCan } from '@/lib/session/session';
import { useAccounts, useContacts } from '../parties';
import { useDeals } from '../deals';
import { RecordPicker, type PickerOption } from './record-picker';

type Common = { id?: string; value: PickerOption | null; onChange: (v: PickerOption | null) => void; disabled?: boolean; invalid?: boolean; describedBy?: string };

export function AccountPicker(props: Common) {
  const [q, setQ] = useState('');
  const can = useCan('accounts.read');
  const list = useAccounts({ q: q || undefined, sort: 'name', dir: 'asc' }, { enabled: can });
  const options = (list.data?.pages[0]?.items ?? []).slice(0, 20).map((a) => ({ id: a.id, label: a.name, meta: [a.city, a.gstin].filter(Boolean).join(' · ') }));
  return <RecordPicker {...props} options={options} loading={list.isFetching} onQueryChange={setQ} placeholder="Pick an account" emptyText={q ? 'No account matches.' : 'No accounts yet.'} />;
}

export function ContactPicker({ accountId, ...props }: Common & { accountId?: string | null }) {
  const [q, setQ] = useState('');
  const can = useCan('contacts.read');
  const list = useContacts({ q: q || undefined, accountId: accountId ?? undefined, sort: 'name', dir: 'asc' }, { enabled: can });
  const options = (list.data?.pages[0]?.items ?? []).slice(0, 20).map((c) => ({ id: c.id, label: c.name, meta: [c.account?.name, c.phone, c.email].filter(Boolean).join(' · ') }));
  return <RecordPicker {...props} options={options} loading={list.isFetching} onQueryChange={setQ} placeholder="Pick a contact" emptyText={q ? 'No contact matches.' : 'No contacts yet.'} />;
}

export function DealPicker(props: Common) {
  const [q, setQ] = useState('');
  const can = useCan('deals.read');
  const list = useDeals({ q: q || undefined, status: ['open'], sort: 'updatedAt', dir: 'desc' }, { enabled: can });
  const options = (list.data?.pages[0]?.items ?? []).slice(0, 20).map((d) => ({ id: d.id, label: d.title, meta: [d.account?.name, formatInr(d.valueInr)].filter(Boolean).join(' · ') }));
  return <RecordPicker {...props} options={options} loading={list.isFetching} onQueryChange={setQ} placeholder="Pick a deal" emptyText={q ? 'No open deal matches.' : 'No open deals.'} />;
}

export function LeadPicker(props: Common) {
  const [q, setQ] = useState('');
  const list = useLeadsList({ q: q || undefined }, { sort: 'createdAt', dir: 'desc' }, 20);
  const options = (list.data?.pages[0]?.items ?? []).map((l) => ({ id: l.id, label: l.name, meta: [l.companyName, l.phone].filter(Boolean).join(' · ') }));
  return <RecordPicker {...props} options={options} loading={list.isFetching} onQueryChange={setQ} placeholder="Pick a lead" emptyText={q ? 'No lead matches.' : 'No leads yet.'} />;
}
