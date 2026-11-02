'use client';

import { RequirePermission } from '@/components/auth/require-permission';
import { DetailHeader } from '@/lib/crm/ui/detail-layout';
import { DocumentEditor, type DocKind, type EditorSeed } from './document-editor';

/** /app/quotations/new and /app/invoices/new (optionally from an account, contact, deal or lead). */
export function NewDocumentPage({ kind, seed }: { kind: DocKind; seed: EditorSeed }) {
  const quotation = kind === 'quotation';
  return (
    <RequirePermission anyOf={[quotation ? 'quotations.create' : 'invoices.create']}>
      <div className="flex w-full min-w-0 flex-col pb-6">
        <DetailHeader
          backHref={quotation ? '/app/quotations' : '/app/invoices'}
          backLabel={quotation ? 'Quotations' : 'Invoices'}
          title={quotation ? 'New quotation' : 'New invoice'}
          subtitle={quotation ? 'Saved as a draft with the next number of this financial year.' : 'Saved as a draft; the invoice number is given when you issue it.'}
        />
        <DocumentEditor kind={kind} seed={seed} />
      </div>
    </RequirePermission>
  );
}
