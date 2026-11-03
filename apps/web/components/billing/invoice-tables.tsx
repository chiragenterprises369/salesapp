'use client';

import { formatPaise, type PlatformInvoiceListItem, type PlatformPayment } from '@vistar/shared';
import { Download, ReceiptIndianRupee, Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { TableCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { invoiceChip, PAYMENT_PROVIDER_LABEL, PLATFORM_INVOICE_KIND, PLATFORM_PAYMENT_STATUS } from '@/lib/billing/logic';
import type { BillingFile } from '@/lib/billing/source';
import { cn } from '@/lib/cn';
import { saveFile } from '@/lib/crm/documents';
import { formatDay, PAYMENT_MODE } from '@/lib/crm/format';

type Status = 'loading' | 'error' | 'empty' | 'ready';

const INVOICE_COLUMNS: DataColumn[] = [
  { key: 'number', label: 'Invoice' },
  { key: 'period', label: 'For', hideBelow: 'md' },
  { key: 'issued', label: 'Date', hideBelow: 'sm' },
  { key: 'due', label: 'Due', hideBelow: 'lg' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'balance', label: 'Balance', align: 'right', hideBelow: 'md' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions', align: 'right' },
];

function periodText(i: PlatformInvoiceListItem): string {
  if (i.periodStart && i.periodEnd) return `${formatDay(i.periodStart)} – ${formatDay(i.periodEnd)}`;
  return PLATFORM_INVOICE_KIND[i.kind];
}

/** Download button with its own busy state (the PDF is fetched with the session token). */
export function PdfButton({ label, fetchPdf, fallbackName }: { label: string; fetchPdf: () => Promise<BillingFile>; fallbackName: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={busy}
      aria-label={label}
      onClick={async () => {
        setBusy(true);
        try {
          saveFile(await fetchPdf(), fallbackName);
        } catch {
          toast.error('The PDF did not download. Try again.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download aria-hidden />
      PDF
    </Button>
  );
}

/**
 * Vistar invoices (company page and the Super Admin company billing). `actions` renders extra buttons
 * per row (Pay, Mark paid, Issue, Cancel); `showCompany` adds the company column (Super Admin lists).
 */
export function PlatformInvoicesTable({
  rows,
  status,
  onRetry,
  pdf,
  actions,
  showCompany = false,
  footer,
  highlightId,
  emptyDescription = 'Invoices from Vistar appear here when a paid period starts.',
}: {
  rows: readonly PlatformInvoiceListItem[];
  status: Status;
  onRetry?: () => void;
  pdf: (id: string) => Promise<BillingFile>;
  actions?: (i: PlatformInvoiceListItem) => ReactNode;
  showCompany?: boolean;
  footer?: ReactNode;
  /** Row to mark (notification link /app/billing?invoice=<id>). */
  highlightId?: string | null;
  emptyDescription?: string;
}) {
  const columns = showCompany ? [INVOICE_COLUMNS[0]!, { key: 'company', label: 'Company', hideBelow: 'sm' as const }, ...INVOICE_COLUMNS.slice(1)] : INVOICE_COLUMNS;
  return (
    <div className="flex flex-col gap-2">
      <DataTable label="Invoices from Vistar" columns={columns} status={status} onRetry={onRetry} skeletonRows={3} empty={{ icon: <ReceiptIndianRupee />, title: 'No invoices yet', description: emptyDescription }}>
        {rows.map((i) => {
          const chip = invoiceChip(i);
          return (
            <TableRow key={i.id} data-invoice-id={i.id} aria-current={highlightId === i.id ? 'true' : undefined} className={cn(highlightId === i.id && 'bg-accent-soft')}>
              <TableCell className="py-2">
                <span className="flex min-w-0 flex-col">
                  <span className={cn('font-mono text-xs', i.number ? 'text-fg' : 'text-muted-strong')}>{i.number ?? 'Draft'}</span>
                  <span className="text-xs text-muted-strong md:hidden">{periodText(i)}</span>
                </span>
              </TableCell>
              {showCompany && <TableCell className={cn(columnClass({ key: 'company', label: '', hideBelow: 'sm' }), 'py-2')}>{i.companyName}</TableCell>}
              <TableCell className={cn(columnClass(INVOICE_COLUMNS[1]!), 'py-2')}>{periodText(i)}</TableCell>
              <TableCell className={cn(columnClass(INVOICE_COLUMNS[2]!), 'py-2')}>{formatDay(i.issueDate)}</TableCell>
              <TableCell className={cn(columnClass(INVOICE_COLUMNS[3]!), 'py-2')}>{formatDay(i.dueDate)}</TableCell>
              <TableCell className="py-2 text-right tabular-nums">{formatPaise(i.totalPaise)}</TableCell>
              <TableCell className={cn(columnClass(INVOICE_COLUMNS[5]!), 'py-2 tabular-nums')}>{i.status === 'issued' ? formatPaise(i.balancePaise) : ''}</TableCell>
              <TableCell className="py-2">
                <Chip tone={chip.tone}>{chip.label}</Chip>
              </TableCell>
              <TableCell className="py-1.5 text-right">
                <span className="inline-flex flex-wrap items-center justify-end gap-1">
                  {actions?.(i)}
                  <PdfButton label={`Download ${i.number ?? 'draft invoice'} as PDF`} fetchPdf={() => pdf(i.id)} fallbackName={`${(i.number ?? 'vistar-invoice').replace(/\//g, '-')}.pdf`} />
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
      {footer}
    </div>
  );
}

const PAYMENT_COLUMNS: DataColumn[] = [
  { key: 'date', label: 'Date' },
  { key: 'invoice', label: 'Invoice', hideBelow: 'sm' },
  { key: 'method', label: 'Method', hideBelow: 'md' },
  { key: 'reference', label: 'Reference', hideBelow: 'lg' },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'status', label: 'Status' },
];

export function PlatformPaymentsTable({ rows, status, onRetry, footer }: { rows: readonly PlatformPayment[]; status: Status; onRetry?: () => void; footer?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <DataTable label="Payments" columns={PAYMENT_COLUMNS} status={status} onRetry={onRetry} skeletonRows={3} empty={{ icon: <Wallet />, title: 'No payments yet', description: 'Payments by card, UPI, net banking or bank transfer show here.' }}>
        {rows.map((p) => {
          const st = PLATFORM_PAYMENT_STATUS[p.status];
          return (
            <TableRow key={p.id}>
              <TableCell className="py-2">{formatDay(p.paidOn ?? p.createdAt.slice(0, 10))}</TableCell>
              <TableCell className={cn(columnClass(PAYMENT_COLUMNS[1]!), 'py-2 font-mono text-xs')}>{p.invoiceNumber ?? ''}</TableCell>
              <TableCell className={cn(columnClass(PAYMENT_COLUMNS[2]!), 'py-2')}>{p.mode ? `${PAYMENT_MODE[p.mode]} (${PAYMENT_PROVIDER_LABEL[p.provider]})` : PAYMENT_PROVIDER_LABEL[p.provider]}</TableCell>
              <TableCell className={cn(columnClass(PAYMENT_COLUMNS[3]!), 'max-w-48 truncate py-2 text-xs text-muted-strong')}>{p.reference ?? p.providerPaymentId ?? p.failureReason ?? ''}</TableCell>
              <TableCell className="py-2 text-right tabular-nums">{formatPaise(p.amountPaise)}</TableCell>
              <TableCell className="py-2">
                <Chip tone={st.tone}>{st.label}</Chip>
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
      {footer}
    </div>
  );
}

/** "Load more" under a paged table. */
export function LoadMore({ hasMore, loading, onMore }: { hasMore: boolean | undefined; loading: boolean; onMore: () => void }) {
  if (!hasMore) return null;
  return (
    <Button className="self-center" loading={loading} onClick={onMore}>
      Load more
    </Button>
  );
}
