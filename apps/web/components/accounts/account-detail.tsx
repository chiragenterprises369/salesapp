'use client';

import { formatInr, stateName } from '@vistar/shared';
import { CalendarPlus, FileText, Globe, Handshake, Mail, Merge, MoreHorizontal, Pencil, Phone, ReceiptIndianRupee, Trash2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { ContactFormSheet } from '@/components/contacts/contact-form';
import { DealFormSheet } from '@/components/deals/deal-form';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/leads/primitives/menu';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { formatPhone } from '@/lib/crm/format';
import { useAccount, useAccountDuplicates, useAccountMutations, useAccountRelated, useAccountTimeline } from '@/lib/crm/parties';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { CrmTimeline } from '@/lib/crm/ui/crm-timeline';
import { CustomFieldsCard } from '@/lib/crm/ui/custom-fields-card';
import { DetailError, DetailGrid, DetailHeader, DetailSection, DetailSkeleton, FieldList } from '@/lib/crm/ui/detail-layout';
import { formatAddress } from '@/lib/crm/ui/fields';
import { MergeDialog } from '@/lib/crm/ui/merge-dialog';
import { RelatedPanels } from '@/lib/crm/ui/related';
import { useCan } from '@/lib/session/session';
import { AccountFormSheet } from './account-form';

export function AccountDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={['accounts.read']}>
      <AccountDetail id={id} />
    </RequirePermission>
  );
}

function AccountDetail({ id }: { id: string }) {
  useCrmRealtime();
  const router = useRouter();
  const q = useAccount(id);
  const related = useAccountRelated(id);
  const timeline = useAccountTimeline(id);
  const m = useAccountMutations();
  const canUpdate = useCan('accounts.update');
  const canDelete = useCan('accounts.delete');
  const canMerge = useCan('accounts.merge');
  const canContact = useCan('contacts.create');
  const canDeal = useCan('deals.create');
  const canQuote = useCan('quotations.create');
  const canInvoice = useCan('invoices.create');
  const canMeet = useCan('calendar.create');
  const dupes = useAccountDuplicates(id, canMerge && q.isSuccess);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [newContact, setNewContact] = useState(false);
  const [newDeal, setNewDeal] = useState(false);

  if (q.isPending) return <DetailSkeleton />;
  if (q.isError) return <DetailError error={q.error} onRetry={() => void q.refetch()} backHref="/app/accounts" backLabel="Back to accounts" noun="account" />;
  const a = q.data;
  const duplicates = dupes.data ?? [];
  const docQuery = `accountId=${a.id}`;

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <DetailHeader
        backHref="/app/accounts"
        backLabel="Accounts"
        title={a.name}
        subtitle={[a.industry, [a.city, stateName(a.stateCode)].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || undefined}
        meta={a.openDealValueInr > 0 ? <Chip tone="indigo">{formatInr(a.openDealValueInr, { compact: true })} open</Chip> : undefined}
        actions={
          <>
            {a.phone && (
              <Button asChild>
                <a href={`tel:${a.phone}`}>
                  <Phone aria-hidden />
                  Call
                </a>
              </Button>
            )}
            {a.email && (
              <Button asChild variant="ghost">
                <a href={`mailto:${a.email}`}>
                  <Mail aria-hidden />
                  Email
                </a>
              </Button>
            )}
            {canUpdate && (
              <Button variant="primary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                Edit
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" aria-label="More actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canContact && (
                  <DropdownMenuItem onSelect={() => setNewContact(true)}>
                    <UserPlus aria-hidden />
                    Add contact
                  </DropdownMenuItem>
                )}
                {canDeal && (
                  <DropdownMenuItem onSelect={() => setNewDeal(true)}>
                    <Handshake aria-hidden />
                    New deal
                  </DropdownMenuItem>
                )}
                {canQuote && (
                  <DropdownMenuItem onSelect={() => router.push(`/app/quotations/new?${docQuery}`)}>
                    <FileText aria-hidden />
                    New quotation
                  </DropdownMenuItem>
                )}
                {canInvoice && (
                  <DropdownMenuItem onSelect={() => router.push(`/app/invoices/new?${docQuery}`)}>
                    <ReceiptIndianRupee aria-hidden />
                    New invoice
                  </DropdownMenuItem>
                )}
                {canMeet && (
                  <DropdownMenuItem onSelect={() => router.push(`/app/calendar?new=1&${docQuery}`)}>
                    <CalendarPlus aria-hidden />
                    Schedule meeting
                  </DropdownMenuItem>
                )}
                {canMerge && duplicates.length > 0 && (
                  <DropdownMenuItem onSelect={() => setMerging(true)}>
                    <Merge aria-hidden />
                    Merge duplicates ({duplicates.length})
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
                    <Trash2 aria-hidden />
                    Delete account
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      {canMerge && duplicates.length > 0 && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-amber-border bg-status-amber-bg px-3 py-2 text-sm text-status-amber-fg">
          {duplicates.length === 1 ? 'One other account' : `${duplicates.length} other accounts`} share this GSTIN, phone or name.
          <Button size="sm" onClick={() => setMerging(true)}>
            <Merge aria-hidden />
            Review and merge
          </Button>
        </div>
      )}
      <DetailGrid
        main={
          <>
            <DetailSection title="Details">
              <FieldList
                columns={3}
                items={[
                  { label: 'GSTIN', value: a.gstin ? <span className="font-mono">{a.gstin}</span> : null },
                  { label: 'PAN', value: a.pan ? <span className="font-mono">{a.pan}</span> : null },
                  { label: 'Owner', value: a.owner?.name ?? 'Unassigned' },
                  { label: 'Phone', value: a.phone ? <a className="focus-ring rounded-sm hover:underline" href={`tel:${a.phone}`}>{formatPhone(a.phone)}</a> : null },
                  { label: 'Email', value: a.email ? <a className="focus-ring rounded-sm hover:underline" href={`mailto:${a.email}`}>{a.email}</a> : null },
                  {
                    label: 'Website',
                    value: a.website ? (
                      <a className="focus-ring inline-flex items-center gap-1 rounded-sm hover:underline" href={a.website} target="_blank" rel="noreferrer">
                        <Globe aria-hidden className="size-3.5" />
                        {a.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                      </a>
                    ) : null,
                  },
                  { label: 'Other phones', value: a.additionalPhones.map((p) => `${formatPhone(p.value)} (${p.label})`).join(', ') },
                  { label: 'Other emails', value: a.additionalEmails.map((p) => `${p.value} (${p.label})`).join(', ') },
                  { label: 'Open deals', value: `${a.openDealCount} · ${formatInr(a.openDealValueInr)}` },
                  { label: 'Billing address', value: formatAddress(a.billingAddress), wide: true },
                  { label: 'Shipping address', value: a.shippingAddress ? formatAddress(a.shippingAddress) : a.billingAddress ? 'Same as billing' : null, wide: true },
                  { label: 'Tags', value: a.tags.length ? <span className="flex flex-wrap gap-1">{a.tags.map((t) => <Chip key={t}>{t}</Chip>)}</span> : null, wide: true },
                ]}
              />
            </DetailSection>
            <CustomFieldsCard target="company" values={a.customFields} canUpdate={canUpdate} onSave={(customFields) => m.update.mutateAsync({ id: a.id, patch: { customFields, expectedVersion: a.version } })} />
            <DetailSection title="Timeline">
              <CrmTimeline query={timeline} canAddNote={canUpdate} onAddNote={(body) => m.addNote.mutateAsync({ id: a.id, body })} />
            </DetailSection>
          </>
        }
        side={
          <RelatedPanels
            data={related.data}
            loading={related.isPending}
            error={related.isError}
            onRetry={() => void related.refetch()}
            sections={['contacts', 'deals', 'quotations', 'invoices', 'leads', 'meetings']}
            actions={{
              contacts: canContact && (
                <Button size="sm" variant="ghost" onClick={() => setNewContact(true)}>
                  Add
                </Button>
              ),
              deals: canDeal && (
                <Button size="sm" variant="ghost" onClick={() => setNewDeal(true)}>
                  New deal
                </Button>
              ),
              quotations: canQuote && (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/app/quotations/new?${docQuery}`}>New</Link>
                </Button>
              ),
              invoices: canInvoice && (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/app/invoices/new?${docQuery}`}>New</Link>
                </Button>
              ),
            }}
          />
        }
      />
      {editing && <AccountFormSheet open onOpenChange={setEditing} account={a} />}
      {newContact && <ContactFormSheet open onOpenChange={setNewContact} defaults={{ account: { id: a.id, label: a.name } }} />}
      {newDeal && <DealFormSheet open onOpenChange={setNewDeal} defaults={{ account: { id: a.id, label: a.name }, title: `${a.name} deal` }} onSaved={(d) => router.push(`/app/deals/${d.id}`)} />}
      {merging && (
        <MergeDialog
          open
          onOpenChange={setMerging}
          noun="account"
          primaryName={a.name}
          candidates={duplicates.map((d) => ({ id: d.id, name: d.name, meta: [d.gstin, d.city, formatPhone(d.phone), d.owner?.name].filter(Boolean).join(' · ') }))}
          onMerge={(duplicateIds) => m.merge.mutateAsync({ primaryId: a.id, duplicateIds })}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${a.name}?`}
        description="Contacts, deals and documents stay; their link to the account is removed. This cannot be undone."
        confirmLabel="Delete account"
        loading={m.remove.isPending}
        onConfirm={() =>
          void m.remove.mutateAsync(a.id).then(
            () => {
              toast.success(`${a.name} deleted`);
              router.push('/app/accounts');
            },
            (e: unknown) => toast.error(e instanceof Error ? e.message : 'The account was not deleted. Try again.'),
          )
        }
      />
    </div>
  );
}
