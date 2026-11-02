'use client';

import { stateName } from '@vistar/shared';
import { CalendarPlus, FileText, Handshake, Mail, Merge, MessageCircle, MoreHorizontal, Pencil, Phone, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/leads/primitives/menu';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { DealFormSheet } from '@/components/deals/deal-form';
import { formatPhone } from '@/lib/crm/format';
import { useContact, useContactDuplicates, useContactMutations, useContactRelated, useContactTimeline } from '@/lib/crm/parties';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { CrmTimeline } from '@/lib/crm/ui/crm-timeline';
import { CustomFieldsCard } from '@/lib/crm/ui/custom-fields-card';
import { DetailError, DetailGrid, DetailHeader, DetailSection, DetailSkeleton, FieldList } from '@/lib/crm/ui/detail-layout';
import { formatAddress } from '@/lib/crm/ui/fields';
import { MergeDialog } from '@/lib/crm/ui/merge-dialog';
import { RelatedPanels } from '@/lib/crm/ui/related';
import { useCan } from '@/lib/session/session';
import { ContactFormSheet } from './contact-form';

export function ContactDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={['contacts.read']}>
      <ContactDetail id={id} />
    </RequirePermission>
  );
}

function ContactDetail({ id }: { id: string }) {
  useCrmRealtime();
  const router = useRouter();
  const q = useContact(id);
  const related = useContactRelated(id);
  const timeline = useContactTimeline(id);
  const m = useContactMutations();
  const canUpdate = useCan('contacts.update');
  const canDelete = useCan('contacts.delete');
  const canMerge = useCan('contacts.merge');
  const canDeal = useCan('deals.create');
  const canQuote = useCan('quotations.create');
  const canMeet = useCan('calendar.create');
  const dupes = useContactDuplicates(id, canMerge && q.isSuccess);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [newDeal, setNewDeal] = useState(false);

  if (q.isPending) return <DetailSkeleton />;
  if (q.isError) return <DetailError error={q.error} onRetry={() => void q.refetch()} backHref="/app/contacts" backLabel="Back to contacts" noun="contact" />;
  const c = q.data;
  const duplicates = dupes.data ?? [];
  const docQuery = `contactId=${c.id}${c.account ? `&accountId=${c.account.id}` : ''}`;

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <DetailHeader
        backHref="/app/contacts"
        backLabel="Contacts"
        title={c.name}
        subtitle={[c.title, c.account?.name].filter(Boolean).join(' at ') || undefined}
        meta={
          <>
            {c.dnd && <Chip tone="red">Do not disturb</Chip>}
            {c.whatsappOptIn && <Chip tone="green">WhatsApp opt-in</Chip>}
          </>
        }
        actions={
          <>
            {c.phone && (
              <Button asChild>
                <a href={`tel:${c.phone}`}>
                  <Phone aria-hidden />
                  Call
                </a>
              </Button>
            )}
            {c.phone && !c.dnd && (
              <Button asChild variant="ghost">
                <a href={`https://wa.me/${c.phone.replace('+', '')}`} target="_blank" rel="noreferrer">
                  <MessageCircle aria-hidden />
                  WhatsApp
                </a>
              </Button>
            )}
            {c.email && (
              <Button asChild variant="ghost">
                <a href={`mailto:${c.email}`}>
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
                    Delete contact
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      {canMerge && duplicates.length > 0 && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-amber-border bg-status-amber-bg px-3 py-2 text-sm text-status-amber-fg">
          {duplicates.length === 1 ? 'One other contact' : `${duplicates.length} other contacts`} share this phone, email or name.
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
                  { label: 'Phone', value: c.phone ? <a className="focus-ring rounded-sm hover:underline" href={`tel:${c.phone}`}>{formatPhone(c.phone)}</a> : null },
                  { label: 'Email', value: c.email ? <a className="focus-ring rounded-sm hover:underline" href={`mailto:${c.email}`}>{c.email}</a> : null },
                  { label: 'Account', value: c.account ? <Link className="focus-ring rounded-sm hover:underline" href={`/app/accounts/${c.account.id}`}>{c.account.name}</Link> : null },
                  { label: 'City', value: [c.city, stateName(c.stateCode)].filter(Boolean).join(', ') },
                  { label: 'Owner', value: c.owner?.name ?? 'Unassigned' },
                  { label: 'GSTIN', value: c.gstin },
                  { label: 'PAN', value: c.pan },
                  { label: 'Other phones', value: c.additionalPhones.map((p) => `${formatPhone(p.value)} (${p.label})`).join(', ') },
                  { label: 'Other emails', value: c.additionalEmails.map((p) => `${p.value} (${p.label})`).join(', ') },
                  { label: 'Billing address', value: formatAddress(c.billingAddress), wide: true },
                  { label: 'Shipping address', value: c.shippingAddress ? formatAddress(c.shippingAddress) : c.billingAddress ? 'Same as billing' : null, wide: true },
                  { label: 'Tags', value: c.tags.length ? <span className="flex flex-wrap gap-1">{c.tags.map((t) => <Chip key={t}>{t}</Chip>)}</span> : null, wide: true },
                ]}
              />
            </DetailSection>
            <CustomFieldsCard target="contact" values={c.customFields} canUpdate={canUpdate} onSave={(customFields) => m.update.mutateAsync({ id: c.id, patch: { customFields, expectedVersion: c.version } })} />
            <DetailSection title="Timeline">
              <CrmTimeline query={timeline} canAddNote={canUpdate} onAddNote={(body) => m.addNote.mutateAsync({ id: c.id, body })} />
            </DetailSection>
          </>
        }
        side={
          <RelatedPanels
            data={related.data}
            loading={related.isPending}
            error={related.isError}
            onRetry={() => void related.refetch()}
            sections={['leads', 'deals', 'quotations', 'invoices', 'meetings']}
            actions={{
              deals: canDeal && (
                <Button size="sm" variant="ghost" onClick={() => setNewDeal(true)}>
                  New deal
                </Button>
              ),
              quotations: canQuote && (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/app/quotations/new?${docQuery}`}>New quotation</Link>
                </Button>
              ),
              meetings: canMeet && (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/app/calendar?new=1&${docQuery}`}>Schedule</Link>
                </Button>
              ),
            }}
          />
        }
      />
      {editing && <ContactFormSheet open onOpenChange={setEditing} contact={c} />}
      {newDeal && (
        <DealFormSheet
          open
          onOpenChange={setNewDeal}
          defaults={{ contact: { id: c.id, label: c.name }, account: c.account ? { id: c.account.id, label: c.account.name } : null, title: c.account ? `${c.account.name} deal` : `${c.name} deal` }}
          onSaved={(d) => router.push(`/app/deals/${d.id}`)}
        />
      )}
      {merging && (
        <MergeDialog
          open
          onOpenChange={setMerging}
          noun="contact"
          primaryName={c.name}
          candidates={duplicates.map((d) => ({ id: d.id, name: d.name, meta: [formatPhone(d.phone), d.email, d.account?.name, d.owner?.name].filter(Boolean).join(' · ') }))}
          onMerge={(duplicateIds) => m.merge.mutateAsync({ primaryId: c.id, duplicateIds })}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${c.name}?`}
        description="Their leads, deals and documents stay; the link to this person is removed. This cannot be undone."
        confirmLabel="Delete contact"
        loading={m.remove.isPending}
        onConfirm={() =>
          void m.remove.mutateAsync(c.id).then(
            () => {
              toast.success(`${c.name} deleted`);
              router.push('/app/contacts');
            },
            (e: unknown) => toast.error(e instanceof Error ? e.message : 'The contact was not deleted. Try again.'),
          )
        }
      />
    </div>
  );
}
