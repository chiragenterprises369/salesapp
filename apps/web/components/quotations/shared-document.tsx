'use client';

import type { PublicDocument } from '@vistar/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Clock, FileDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiRequestError } from '@/lib/api-error';
import { saveFile } from '@/lib/crm/documents';
import { formatDateTimeIn, INVOICE_STATUS, QUOTATION_STATUS } from '@/lib/crm/format';
import { hostedBrandCss } from '@/lib/crm/public-brand';
import { getCrmSource } from '@/lib/crm/source';
import { DocumentPreview } from './document-preview';

function statusLabel(d: PublicDocument): string {
  if (d.kind === 'quotation') return QUOTATION_STATUS[d.status as keyof typeof QUOTATION_STATUS]?.label ?? '';
  return INVOICE_STATUS[d.status as keyof typeof INVOICE_STATUS]?.label ?? '';
}

/** Public page of a shared quotation or invoice (/d/<token>): the document and a PDF download. No sign-in. */
export function SharedDocumentPage({ token }: { token: string }) {
  const q = useQuery({ queryKey: ['public', 'document', token], queryFn: () => getCrmSource().public.document(token), retry: false });
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (q.isPending) {
    return (
      <div role="status" aria-label="Loading the document" className="flex flex-col gap-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[32rem] w-full rounded-lg" />
      </div>
    );
  }
  if (q.isError) {
    const expired = isApiRequestError(q.error) && (q.error.status === 410 || q.error.code === 'SHARE_LINK_EXPIRED');
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-8 text-center shadow-card">
        <span aria-hidden className="text-muted-strong [&_svg]:size-8">{expired ? <Clock /> : <AlertCircle />}</span>
        <h1 className="text-base font-semibold text-fg">{expired ? 'This link has expired' : 'Document not found'}</h1>
        <p className="max-w-sm text-sm text-muted-strong">{expired ? 'Ask the sender for a new link.' : 'Check the link you were given, or ask the sender for a new one.'}</p>
      </div>
    );
  }
  const d = q.data;
  const title = `${d.kind === 'quotation' ? 'Quotation' : 'Invoice'} ${d.number ?? ''}`.trim();
  const css = hostedBrandCss(d.branding);
  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      saveFile(await getCrmSource().public.documentPdf(token), `${(d.number ?? d.kind).replace(/\//g, '-')}.pdf`);
    } catch {
      setError('The PDF did not download. Try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div data-hosted className="flex flex-col gap-4">
      {css && <style>{css}</style>}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-fg">{title}</h1>
          <p className="text-xs text-muted-strong">
            From {d.seller?.tradeName || d.seller?.legalName || d.workspaceName} · link valid until {formatDateTimeIn(d.expiresAt, 'Asia/Kolkata')}
          </p>
        </div>
        <Button variant="primary" loading={downloading} onClick={() => void download()}>
          <FileDown aria-hidden />
          Download PDF
        </Button>
      </header>
      {error && (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}
      <DocumentPreview
        doc={{
          kind: d.kind,
          number: d.number,
          issueDate: d.issueDate,
          validUntil: d.validUntil,
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
          logoUrl: d.branding.logoLight?.url ?? null,
          statusLabel: statusLabel(d),
        }}
      />
    </div>
  );
}
