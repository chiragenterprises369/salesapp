'use client';

import { formatPaise, type DocumentShare, type Invoice } from '@vistar/shared';
import { Ban, FileDown, IndianRupee, Link2, MoreHorizontal, Pencil, Send, Stamp, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/leads/primitives/menu';
import { DocumentEditor } from '@/components/quotations/document-editor';
import { DocumentPreview } from '@/components/quotations/document-preview';
import { ShareDialog } from '@/components/quotations/share-dialog';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { downloadInvoicePdf, saveFile, useInvoice, useInvoiceMutations } from '@/lib/crm/documents';
import { formatDateTimeIn, formatDay, INVOICE_STATUS, PAYMENT_MODE } from '@/lib/crm/format';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { DetailError, DetailHeader, DetailSection, DetailSkeleton } from '@/lib/crm/ui/detail-layout';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { useCan, useMe } from '@/lib/session/session';
import { invoiceChip } from './invoices-page';
import { PaymentDialog } from './payment-dialog';

export function InvoiceDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={['invoices.read']}>
      <InvoiceDetail id={id} />
    </RequirePermission>
  );
}

function InvoiceDetail({ id }: { id: string }) {
  useCrmRealtime();
  const router = useRouter();
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const q = useInvoice(id);
  const m = useInvoiceMutations();
  const canUpdate = useCan('invoices.update');
  const canIssue = useCan('invoices.issue');
  const canCancel = useCan('invoices.cancel');
  const canPay = useCan('invoices.payments');
  const canDelete = useCan('invoices.delete');
  const [editing, setEditing] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueDate, setIssueDate] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [share, setShare] = useState<DocumentShare | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (q.isPending) return <DetailSkeleton />;
  if (q.isError) return <DetailError error={q.error} onRetry={() => void q.refetch()} backHref="/app/invoices" backLabel="Back to invoices" noun="invoice" />;
  const d = q.data;
  const label = d.number ? `Invoice ${d.number}` : 'Draft invoice';
  const fail = (e: unknown) => toast.error(formErrorMessage(e, 'That did not work. Try again.'));
  const open = d.status === 'issued' || d.status === 'partially_paid';

  if (editing && d.status === 'draft') {
    return (
      <div className="flex w-full min-w-0 flex-col pb-6">
        <DetailHeader backHref={`/app/invoices/${d.id}`} backLabel={label} title="Edit draft invoice" subtitle="Issuing gives the invoice its number and freezes the seller and buyer details." />
        <DocumentEditor kind="invoice" existing={d} onDone={() => setEditing(false)} />
      </div>
    );
  }

  const pdf = async () => {
    setDownloading(true);
    try {
      saveFile(await downloadInvoicePdf(d.id), `${(d.number ?? 'draft-invoice').replace(/\//g, '-')}.pdf`);
    } catch (e) {
      fail(e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <DetailHeader
        backHref="/app/invoices"
        backLabel="Invoices"
        title={label}
        subtitle={[d.buyerName, `dated ${formatDay(d.issueDate)}`, d.dueDate ? `due ${formatDay(d.dueDate)}` : null].filter(Boolean).join(' · ')}
        meta={
          <>
            {invoiceChip(d)}
            <Chip>{d.taxMode === 'inter' ? 'IGST' : 'CGST + SGST'}</Chip>
            {open && <Chip tone="amber">{formatPaise(d.balancePaise)} due</Chip>}
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
            {d.status === 'draft' && canIssue && (
              <Button variant="primary" onClick={() => setIssuing(true)}>
                <Stamp aria-hidden />
                Issue invoice
              </Button>
            )}
            {open && canPay && (
              <Button variant="primary" onClick={() => setPaying(true)}>
                <IndianRupee aria-hidden />
                Record payment
              </Button>
            )}
            {d.status !== 'draft' && d.status !== 'cancelled' && canIssue && (
              <Button
                loading={m.send.isPending}
                onClick={() =>
                  m.send.mutate(
                    { id: d.id },
                    {
                      onSuccess: (r) => {
                        setShare(r.share);
                        toast.success(`${label} shared`);
                      },
                      onError: fail,
                    },
                  )
                }
              >
                <Send aria-hidden />
                Send
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" aria-label="More actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {d.status !== 'draft' && canIssue && (
                  <DropdownMenuItem onSelect={() => m.share.mutate({ id: d.id }, { onSuccess: setShare, onError: fail })}>
                    <Link2 aria-hidden />
                    {d.share.active ? 'New share link' : 'Create share link'}
                  </DropdownMenuItem>
                )}
                {d.share.active && canIssue && (
                  <DropdownMenuItem onSelect={() => m.revokeShare.mutate(d.id, { onSuccess: () => toast.success('Share link turned off'), onError: fail })}>
                    <Link2 aria-hidden />
                    Turn off the share link
                  </DropdownMenuItem>
                )}
                {open && canCancel && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setCancelling(true)}>
                      <Ban aria-hidden />
                      Cancel invoice
                    </DropdownMenuItem>
                  </>
                )}
                {d.status === 'draft' && canDelete && (
                  <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
                    <Trash2 aria-hidden />
                    Delete draft
                  </DropdownMenuItem>
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
        {d.quotationId && (
          <Link className="focus-ring rounded-sm text-fg hover:underline" href={`/app/quotations/${d.quotationId}`}>
            From a quotation
          </Link>
        )}
        {d.issuedAt && <span>Issued {formatDateTimeIn(d.issuedAt, tz)}</span>}
        {d.share.active && d.share.expiresAt && <span>Share link active until {formatDateTimeIn(d.share.expiresAt, tz)}</span>}
        {d.cancelReason && <span>Cancelled: {d.cancelReason}</span>}
      </div>
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <DocumentPreview doc={toInvoicePreview(d, me?.workspace.branding?.logoLight?.url ?? null)} />
        <DetailSection title={`Payments (${d.payments.length})`} className="2xl:self-start">
          {d.payments.length === 0 ? (
            <p className="text-sm text-muted-strong">{d.status === 'draft' ? 'Issue the invoice to record payments.' : 'No payments recorded yet.'}</p>
          ) : (
            <Table aria-label="Payments">
              <TableHeader sticky={false}>
                <TableRow className="hover:bg-surface">
                  <TableHead>Date</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {canPay && (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {formatDay(p.paidOn)}
                      {p.reference && <span className="block text-xs text-muted-strong">{p.reference}</span>}
                    </TableCell>
                    <TableCell>{PAYMENT_MODE[p.mode]}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaise(p.amountPaise)}</TableCell>
                    {canPay && (
                      <TableCell className="text-right">
                        {d.status !== 'cancelled' && (
                          <Button size="icon-sm" variant="ghost" aria-label={`Void the payment of ${formatPaise(p.amountPaise)} on ${formatDay(p.paidOn)}`} onClick={() => setVoiding(p.id)}>
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-strong">Total</dt>
              <dd className="tabular-nums">{formatPaise(d.totalPaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-strong">Paid</dt>
              <dd className="tabular-nums">{formatPaise(d.paidPaise)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Balance</dt>
              <dd className="tabular-nums">{formatPaise(d.balancePaise)}</dd>
            </div>
          </dl>
        </DetailSection>
      </div>
      {paying && <PaymentDialog invoice={d} onClose={() => setPaying(false)} />}
      {share && <ShareDialog share={share} onClose={() => setShare(null)} buyerPhone={d.buyer.phone} buyerEmail={d.buyer.email} timeZone={tz} title={label} />}
      <ConfirmDialog
        open={issuing}
        onOpenChange={setIssuing}
        title="Issue this invoice?"
        description="It gets the next invoice number of the financial year. After issuing, lines cannot change; cancel and re-issue instead."
        confirmLabel="Issue invoice"
        tone="primary"
        loading={m.issue.isPending}
        onConfirm={() =>
          m.issue.mutate(
            { id: d.id, body: { ...(issueDate ? { issueDate } : {}), expectedVersion: d.version } },
            {
              onSuccess: (r) => {
                toast.success(`Invoice ${r.number} issued`);
                setIssuing(false);
              },
              onError: fail,
            },
          )
        }
      >
        <FormField label="Invoice date" hint="Empty = the draft date (today if it is earlier)">
          <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </FormField>
      </ConfirmDialog>
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${label}?`}
        description="The number stays used (GST needs gap-free numbers). Payments stay recorded. This cannot be undone."
        confirmLabel="Cancel invoice"
        loading={m.cancel.isPending}
        onConfirm={() => {
          if (cancelReason.trim().length < 3) return setCancelError('Give a reason of at least 3 characters.');
          m.cancel.mutate(
            { id: d.id, reason: cancelReason.trim() },
            {
              onSuccess: () => {
                toast.success(`${label} cancelled`);
                setCancelling(false);
              },
              onError: fail,
            },
          );
        }}
      >
        <FormField label="Reason" required error={cancelError}>
          <Input
            autoFocus
            value={cancelReason}
            maxLength={500}
            onChange={(e) => {
              setCancelReason(e.target.value);
              setCancelError(null);
            }}
          />
        </FormField>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!voiding}
        onOpenChange={(o) => !o && setVoiding(null)}
        title="Void this payment?"
        description="The balance goes up by the payment amount. Use this when a payment was recorded by mistake."
        confirmLabel="Void payment"
        loading={m.deletePayment.isPending}
        onConfirm={() =>
          voiding &&
          m.deletePayment.mutate(
            { id: d.id, paymentId: voiding },
            {
              onSuccess: () => {
                toast.success('Payment voided');
                setVoiding(null);
              },
              onError: fail,
            },
          )
        }
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this draft invoice?"
        description="Drafts have no number, so nothing is skipped. This cannot be undone."
        confirmLabel="Delete draft"
        loading={m.remove.isPending}
        onConfirm={() =>
          m.remove.mutate(d.id, {
            onSuccess: () => {
              toast.success('Draft invoice deleted');
              router.push('/app/invoices');
            },
            onError: fail,
          })
        }
      />
    </div>
  );
}

export function toInvoicePreview(d: Invoice, logoUrl: string | null) {
  return {
    kind: 'invoice' as const,
    number: d.number,
    issueDate: d.issueDate,
    dueDate: d.dueDate,
    seller: d.seller,
    buyer: d.buyer,
    placeOfSupplyStateCode: d.placeOfSupplyStateCode,
    lines: d.lines.map((l) => ({ ...l, key: l.id })),
    totals: d.totals,
    notes: d.notes,
    terms: d.terms,
    paidPaise: d.paidPaise,
    balancePaise: d.balancePaise,
    logoUrl,
    statusLabel: d.overdue ? 'Overdue' : INVOICE_STATUS[d.status].label,
  };
}
