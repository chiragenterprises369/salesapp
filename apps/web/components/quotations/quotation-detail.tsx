'use client';

import { QUOTATION_TRANSITIONS, type DocumentShare, type Quotation, type QuotationStatus } from '@vistar/shared';
import { Check, Copy, FileDown, Link2, MoreHorizontal, Pencil, ReceiptIndianRupee, RotateCcw, Send, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/leads/primitives/menu';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { downloadQuotationPdf, saveFile, useQuotation, useQuotationMutations } from '@/lib/crm/documents';
import { formatDateTimeIn, formatDay, QUOTATION_STATUS } from '@/lib/crm/format';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { DetailError, DetailHeader, DetailSkeleton } from '@/lib/crm/ui/detail-layout';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { useCan, useMe } from '@/lib/session/session';
import { DocumentEditor } from './document-editor';
import { DocumentPreview } from './document-preview';
import { ShareDialog } from './share-dialog';

export function QuotationDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={['quotations.read']}>
      <QuotationDetail id={id} />
    </RequirePermission>
  );
}

function QuotationDetail({ id }: { id: string }) {
  useCrmRealtime();
  const router = useRouter();
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const q = useQuotation(id);
  const m = useQuotationMutations();
  const canUpdate = useCan('quotations.update');
  const canSend = useCan('quotations.send');
  const canDelete = useCan('quotations.delete');
  const canCreate = useCan('quotations.create');
  const canInvoice = useCan('invoices.create');
  const [editing, setEditing] = useState(false);
  const [share, setShare] = useState<DocumentShare | null>(null);
  const [reasonFor, setReasonFor] = useState<QuotationStatus | null>(null);
  const [reason, setReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (q.isPending) return <DetailSkeleton />;
  if (q.isError) return <DetailError error={q.error} onRetry={() => void q.refetch()} backHref="/app/quotations" backLabel="Back to quotations" noun="quotation" />;
  const d = q.data;
  const next = QUOTATION_TRANSITIONS[d.status];
  const fail = (e: unknown) => toast.error(formErrorMessage(e, 'That did not work. Try again.'));

  if (editing && d.status === 'draft') {
    return (
      <div className="flex w-full min-w-0 flex-col pb-6">
        <DetailHeader backHref={`/app/quotations/${d.id}`} backLabel={`Quotation ${d.number}`} title={`Edit ${d.number}`} subtitle="Drafts can change freely; sending freezes the seller and buyer details." />
        <DocumentEditor kind="quotation" existing={d} onDone={() => setEditing(false)} />
      </div>
    );
  }

  const setStatus = (status: QuotationStatus, why?: string | null) =>
    m.setStatus.mutate(
      { id: d.id, body: { status, reason: why ?? null, expectedVersion: d.version } },
      { onSuccess: (r) => toast.success(`Quotation ${r.number} is ${QUOTATION_STATUS[r.status].label.toLowerCase()}`), onError: fail },
    );
  const send = () =>
    m.send.mutate(
      { id: d.id },
      {
        onSuccess: (r) => {
          setShare(r.share);
          toast.success(`Quotation ${r.quotation.number} sent`);
        },
        onError: fail,
      },
    );
  const newLink = () => m.share.mutate({ id: d.id }, { onSuccess: setShare, onError: fail });
  const pdf = async () => {
    setDownloading(true);
    try {
      saveFile(await downloadQuotationPdf(d.id), `${d.number.replace(/\//g, '-')}.pdf`);
    } catch (e) {
      fail(e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <DetailHeader
        backHref="/app/quotations"
        backLabel="Quotations"
        title={`Quotation ${d.number}`}
        subtitle={[d.buyerName, `dated ${formatDay(d.issueDate)}`, d.validUntil ? `valid until ${formatDay(d.validUntil)}` : null].filter(Boolean).join(' · ')}
        meta={
          <>
            <Chip tone={QUOTATION_STATUS[d.status].tone}>{QUOTATION_STATUS[d.status].label}</Chip>
            <Chip>{d.taxMode === 'inter' ? 'IGST' : 'CGST + SGST'}</Chip>
          </>
        }
        actions={
          <>
            <Button onClick={() => void pdf()} loading={downloading}>
              <FileDown aria-hidden />
              Download PDF
            </Button>
            {d.status === 'draft' && canUpdate && (
              <Button onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                Edit
              </Button>
            )}
            {(d.status === 'draft' || d.status === 'expired') && canSend && (
              <Button variant="primary" loading={m.send.isPending} onClick={send}>
                <Send aria-hidden />
                Send
              </Button>
            )}
            {(d.status === 'accepted' || d.status === 'sent') && canInvoice && !d.convertedInvoiceId && (
              <Button
                variant={d.status === 'accepted' ? 'primary' : 'secondary'}
                loading={m.convert.isPending}
                onClick={() =>
                  m.convert.mutate(d.id, {
                    onSuccess: (inv) => {
                      toast.success('Invoice draft created from the quotation');
                      router.push(`/app/invoices/${inv.id}`);
                    },
                    onError: fail,
                  })
                }
              >
                <ReceiptIndianRupee aria-hidden />
                Convert to invoice
              </Button>
            )}
            {d.convertedInvoiceId && (
              <Button asChild>
                <Link href={`/app/invoices/${d.convertedInvoiceId}`}>
                  <ReceiptIndianRupee aria-hidden />
                  Open invoice
                </Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" aria-label="More actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {canUpdate && next.includes('accepted') && (
                  <DropdownMenuItem onSelect={() => setStatus('accepted')}>
                    <Check aria-hidden />
                    Mark as accepted
                  </DropdownMenuItem>
                )}
                {canUpdate && next.includes('rejected') && (
                  <DropdownMenuItem onSelect={() => setReasonFor('rejected')}>
                    <X aria-hidden />
                    Mark as rejected
                  </DropdownMenuItem>
                )}
                {canUpdate && next.includes('expired') && (
                  <DropdownMenuItem onSelect={() => setStatus('expired')}>
                    <X aria-hidden />
                    Mark as expired
                  </DropdownMenuItem>
                )}
                {canUpdate && next.includes('draft') && (
                  <DropdownMenuItem onSelect={() => setReasonFor('draft')}>
                    <RotateCcw aria-hidden />
                    Reopen as draft
                  </DropdownMenuItem>
                )}
                {canSend && d.status !== 'draft' && (
                  <DropdownMenuItem onSelect={newLink}>
                    <Link2 aria-hidden />
                    {d.share.active ? 'New share link' : 'Create share link'}
                  </DropdownMenuItem>
                )}
                {canSend && d.share.active && (
                  <DropdownMenuItem onSelect={() => m.revokeShare.mutate(d.id, { onSuccess: () => toast.success('Share link turned off'), onError: fail })}>
                    <Link2 aria-hidden />
                    Turn off the share link
                  </DropdownMenuItem>
                )}
                {canCreate && (
                  <DropdownMenuItem
                    onSelect={() =>
                      m.duplicate.mutate(d.id, {
                        onSuccess: (copy) => {
                          toast.success(`Copy ${copy.number} created as a draft`);
                          router.push(`/app/quotations/${copy.id}`);
                        },
                        onError: fail,
                      })
                    }
                  >
                    <Copy aria-hidden />
                    Duplicate
                  </DropdownMenuItem>
                )}
                {canDelete && d.status === 'draft' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
                      <Trash2 aria-hidden />
                      Delete draft
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-strong">
        {d.account && (
          <span>
            Account <Link className="focus-ring rounded-sm text-fg hover:underline" href={`/app/accounts/${d.account.id}`}>{d.account.name}</Link>
          </span>
        )}
        {d.contact && (
          <span>
            Contact <Link className="focus-ring rounded-sm text-fg hover:underline" href={`/app/contacts/${d.contact.id}`}>{d.contact.name}</Link>
          </span>
        )}
        {d.dealId && (
          <Link className="focus-ring rounded-sm text-fg hover:underline" href={`/app/deals/${d.dealId}`}>
            Open the deal
          </Link>
        )}
        {d.owner && <span>Owner {d.owner.name}</span>}
        {d.sentAt && <span>Sent {formatDateTimeIn(d.sentAt, tz)}</span>}
        {d.share.active && d.share.expiresAt && <span>Share link active until {formatDateTimeIn(d.share.expiresAt, tz)}</span>}
        {d.statusReason && <span>Reason: {d.statusReason}</span>}
      </div>
      <DocumentPreview doc={toPreview(d, me?.workspace.branding?.logoLight?.url ?? null)} />
      {share && <ShareDialog share={share} onClose={() => setShare(null)} buyerPhone={d.buyer.phone} buyerEmail={d.buyer.email} timeZone={tz} title={`Quotation ${d.number}`} />}
      {reasonFor && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setReasonFor(null)}
          title={reasonFor === 'rejected' ? `Mark ${d.number} as rejected?` : `Reopen ${d.number} as a draft?`}
          description={reasonFor === 'rejected' ? 'The reason is kept on the quotation and in reports.' : 'You can edit the lines again and send a new version.'}
          confirmLabel={reasonFor === 'rejected' ? 'Mark as rejected' : 'Reopen'}
          tone="primary"
          loading={m.setStatus.isPending}
          onConfirm={() => {
            setStatus(reasonFor, reason.trim() || null);
            setReasonFor(null);
            setReason('');
          }}
        >
          <FormField label="Reason" hint="Optional">
            <Input autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </ConfirmDialog>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete draft ${d.number}?`}
        description="The number is not reused. This cannot be undone."
        confirmLabel="Delete draft"
        loading={m.remove.isPending}
        onConfirm={() =>
          m.remove.mutate(d.id, {
            onSuccess: () => {
              toast.success(`Draft ${d.number} deleted`);
              router.push('/app/quotations');
            },
            onError: fail,
          })
        }
      />
    </div>
  );
}

export function toPreview(d: Quotation, logoUrl: string | null) {
  return {
    kind: 'quotation' as const,
    number: d.number,
    issueDate: d.issueDate,
    validUntil: d.validUntil,
    seller: d.seller,
    buyer: d.buyer,
    placeOfSupplyStateCode: d.placeOfSupplyStateCode,
    lines: d.lines.map((l) => ({ ...l, key: l.id })),
    totals: d.totals,
    notes: d.notes,
    terms: d.terms,
    logoUrl,
    statusLabel: QUOTATION_STATUS[d.status].label,
  };
}
