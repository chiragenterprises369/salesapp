'use client';

import { formatPaise, stateName, type Address, type DocumentTotals, type LineItem, type Party, type SellerSnapshot } from '@vistar/shared';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/crm/format';

export interface PreviewDocument {
  kind: 'quotation' | 'invoice';
  number: string | null;
  issueDate: string;
  validUntil?: string | null;
  dueDate?: string | null;
  seller: SellerSnapshot | null;
  buyer: Party;
  placeOfSupplyStateCode: string | null;
  lines: ReadonlyArray<Pick<LineItem, 'name' | 'description' | 'hsnSac' | 'quantity' | 'unit' | 'unitPricePaise' | 'discountPaise' | 'taxablePaise' | 'gstRate' | 'cgstPaise' | 'sgstPaise' | 'igstPaise' | 'totalPaise'> & { key: string }>;
  totals: DocumentTotals;
  notes: string | null;
  terms: string | null;
  paidPaise?: number | null;
  balancePaise?: number | null;
  /** Logo URL from the workspace branding. */
  logoUrl?: string | null;
  statusLabel?: string;
}

function AddressLines({ a }: { a: Address | null | undefined }) {
  if (!a) return null;
  return (
    <>
      <span className="block">{a.line1}</span>
      {a.line2 && <span className="block">{a.line2}</span>}
      <span className="block">
        {a.city}
        {a.pincode ? ` ${a.pincode}` : ''}
      </span>
      <span className="block">
        {a.state ?? stateName(a.stateCode)}
        {a.stateCode ? ` (state code ${a.stateCode})` : ''}
      </span>
    </>
  );
}

/**
 * The document as the customer sees it (same content as the server PDF): seller and buyer blocks,
 * lines with HSN/SAC and tax, totals with CGST + SGST or IGST, round-off, amount in words, bank
 * details and terms. Uses the workspace brand tokens, never fixed colours.
 */
export function DocumentPreview({ doc, className }: { doc: PreviewDocument; className?: string }) {
  const intra = doc.totals.taxMode === 'intra';
  const title = doc.kind === 'quotation' ? 'Quotation' : doc.seller?.gstin ? 'Tax invoice' : 'Invoice';
  return (
    <article aria-label={`${title} preview`} className={cn('mx-auto w-full max-w-[56rem] rounded-lg border border-border bg-surface p-6 text-sm text-fg shadow-card sm:p-8', className)}>
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {doc.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- branding logo from storage (any size)
            <img src={doc.logoUrl} alt="" className="mb-3 h-10 w-auto max-w-48 object-contain" />
          )}
          <p className="text-base font-semibold">{doc.seller?.tradeName || doc.seller?.legalName || 'Your company'}</p>
          {doc.seller?.tradeName && doc.seller.legalName !== doc.seller.tradeName && <p className="text-xs text-muted-strong">{doc.seller.legalName}</p>}
          <p className="mt-1 text-xs text-fg-secondary">
            <AddressLines a={doc.seller?.address} />
          </p>
          {doc.seller?.gstin && <p className="mt-1 text-xs">GSTIN {doc.seller.gstin}</p>}
          {doc.seller?.pan && <p className="text-xs">PAN {doc.seller.pan}</p>}
          {(doc.seller?.phone || doc.seller?.email) && <p className="text-xs text-fg-secondary">{[doc.seller.phone, doc.seller.email].filter(Boolean).join(' · ')}</p>}
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="text-lg font-semibold tracking-tight text-accent-text">{title}</p>
          {doc.statusLabel && <p className="text-xs text-muted-strong">{doc.statusLabel}</p>}
          <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs sm:justify-end">
            <dt className="text-muted-strong">Number</dt>
            <dd className="font-medium">{doc.number ?? 'Given on issue'}</dd>
            <dt className="text-muted-strong">Date</dt>
            <dd>{formatDay(doc.issueDate)}</dd>
            {doc.validUntil && (
              <>
                <dt className="text-muted-strong">Valid until</dt>
                <dd>{formatDay(doc.validUntil)}</dd>
              </>
            )}
            {doc.dueDate && (
              <>
                <dt className="text-muted-strong">Due date</dt>
                <dd>{formatDay(doc.dueDate)}</dd>
              </>
            )}
            <dt className="text-muted-strong">Place of supply</dt>
            <dd>{doc.placeOfSupplyStateCode ? `${stateName(doc.placeOfSupplyStateCode)} (${doc.placeOfSupplyStateCode})` : '-'}</dd>
          </dl>
        </div>
      </header>

      <section className="grid gap-4 border-b border-border py-5 sm:grid-cols-2">
        <div>
          <h3 className="text-2xs font-semibold tracking-wide text-muted-strong uppercase">Bill to</h3>
          <p className="mt-1 font-medium">{doc.buyer.name || '-'}</p>
          {doc.buyer.contactName && <p className="text-xs">Attn: {doc.buyer.contactName}</p>}
          <p className="text-xs text-fg-secondary">
            <AddressLines a={doc.buyer.billingAddress} />
          </p>
          {doc.buyer.gstin && <p className="mt-1 text-xs">GSTIN {doc.buyer.gstin}</p>}
          {(doc.buyer.phone || doc.buyer.email) && <p className="text-xs text-fg-secondary">{[doc.buyer.phone, doc.buyer.email].filter(Boolean).join(' · ')}</p>}
        </div>
        {doc.buyer.shippingAddress && (
          <div>
            <h3 className="text-2xs font-semibold tracking-wide text-muted-strong uppercase">Ship to</h3>
            <p className="mt-1 text-xs text-fg-secondary">
              <AddressLines a={doc.buyer.shippingAddress} />
            </p>
          </div>
        )}
      </section>

      <div className="overflow-x-auto py-5">
        <table className="w-full min-w-[40rem] text-xs">
          <caption className="sr-only">Line items</caption>
          <thead>
            <tr className="border-b border-border text-muted-strong">
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">#</th>
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">Item</th>
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">HSN/SAC</th>
              <th scope="col" className="py-1.5 pr-2 text-right font-medium">Qty</th>
              <th scope="col" className="py-1.5 pr-2 text-right font-medium">Rate</th>
              <th scope="col" className="py-1.5 pr-2 text-right font-medium">Discount</th>
              <th scope="col" className="py-1.5 pr-2 text-right font-medium">Taxable</th>
              {intra ? (
                <>
                  <th scope="col" className="py-1.5 pr-2 text-right font-medium">CGST</th>
                  <th scope="col" className="py-1.5 pr-2 text-right font-medium">SGST</th>
                </>
              ) : (
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">IGST</th>
              )}
              <th scope="col" className="py-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={l.key} className="border-b border-border align-top">
                <td className="py-1.5 pr-2 tabular-nums">{i + 1}</td>
                <td className="py-1.5 pr-2">
                  <span className="font-medium">{l.name}</span>
                  {l.description && <span className="block text-muted-strong">{l.description}</span>}
                </td>
                <td className="py-1.5 pr-2">{l.hsnSac ?? ''}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {l.quantity} {l.unit}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatPaise(l.unitPricePaise, { symbol: false })}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{l.discountPaise ? formatPaise(l.discountPaise, { symbol: false }) : ''}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatPaise(l.taxablePaise, { symbol: false })}</td>
                {intra ? (
                  <>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {formatPaise(l.cgstPaise, { symbol: false })}
                      <span className="block text-2xs text-muted-strong">{l.gstRate / 2}%</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {formatPaise(l.sgstPaise, { symbol: false })}
                      <span className="block text-2xs text-muted-strong">{l.gstRate / 2}%</span>
                    </td>
                  </>
                ) : (
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatPaise(l.igstPaise, { symbol: false })}
                    <span className="block text-2xs text-muted-strong">{l.gstRate}%</span>
                  </td>
                )}
                <td className="py-1.5 text-right font-medium tabular-nums">{formatPaise(l.totalPaise, { symbol: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-3 text-xs">
          <p>
            <span className="text-muted-strong">Amount in words: </span>
            <span className="font-medium">{doc.totals.amountInWords}</span>
          </p>
          {doc.seller?.bank && (doc.seller.bank.accountNumber || doc.seller.bank.upiId) && (
            <div>
              <h3 className="text-2xs font-semibold tracking-wide text-muted-strong uppercase">Payment details</h3>
              <p className="mt-0.5 text-fg-secondary">
                {[doc.seller.bank.accountName, doc.seller.bank.bankName, doc.seller.bank.accountNumber && `A/c ${doc.seller.bank.accountNumber}`, doc.seller.bank.ifsc && `IFSC ${doc.seller.bank.ifsc}`, doc.seller.bank.upiId && `UPI ${doc.seller.bank.upiId}`].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}
          {doc.notes && (
            <div>
              <h3 className="text-2xs font-semibold tracking-wide text-muted-strong uppercase">Notes</h3>
              <p className="mt-0.5 whitespace-pre-wrap text-fg-secondary">{doc.notes}</p>
            </div>
          )}
          {doc.terms && (
            <div>
              <h3 className="text-2xs font-semibold tracking-wide text-muted-strong uppercase">Terms</h3>
              <p className="mt-0.5 whitespace-pre-wrap text-fg-secondary">{doc.terms}</p>
            </div>
          )}
        </div>
        <dl className="flex flex-col gap-1 text-xs">
          <Row label="Taxable value" value={doc.totals.taxablePaise} />
          {intra ? (
            <>
              <Row label="CGST" value={doc.totals.cgstPaise} />
              <Row label="SGST" value={doc.totals.sgstPaise} />
            </>
          ) : (
            <Row label="IGST" value={doc.totals.igstPaise} />
          )}
          {doc.totals.roundOffPaise !== 0 && <Row label="Round off" value={doc.totals.roundOffPaise} />}
          <div className="mt-1 flex justify-between border-t border-border pt-2 text-sm font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatPaise(doc.totals.totalPaise)}</dd>
          </div>
          {doc.paidPaise ? <Row label="Paid" value={doc.paidPaise} /> : null}
          {doc.balancePaise !== undefined && doc.balancePaise !== null && doc.paidPaise ? <Row label="Balance due" value={doc.balancePaise} strong /> : null}
        </dl>
      </section>

      <footer className="mt-8 flex justify-end text-xs">
        <div className="text-right">
          <p>For {doc.seller?.legalName ?? 'your company'}</p>
          <p className="mt-8 text-muted-strong">{doc.seller?.signatureLabel ?? 'Authorised signatory'}</p>
        </div>
      </footer>
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-4', strong && 'font-semibold')}>
      <dt className="text-muted-strong">{label}</dt>
      <dd className="tabular-nums">{formatPaise(value)}</dd>
    </div>
  );
}
