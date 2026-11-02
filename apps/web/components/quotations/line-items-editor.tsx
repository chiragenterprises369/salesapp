'use client';

import { formatPaise, GST_RATES, PRODUCT_UNIT_LABELS, PRODUCT_UNITS, resolveUnitPrice, stateName, type GstRate, type GstTotals, type PriceList, type ProductUnit } from '@vistar/shared';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProducts } from '@/lib/crm/catalog';
import { emptyLine, type LineDraft } from '@/lib/crm/lines';
import { RecordPicker } from '@/lib/crm/ui/record-picker';
import { cn } from '@/lib/cn';
import { useCan } from '@/lib/session/session';

type LineAmounts = { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number };

function ProductCell({ line, priceList, onPick, invalid, rowLabel }: { line: LineDraft; priceList: PriceList | null; onPick: (patch: Partial<LineDraft>) => void; invalid?: boolean; rowLabel: string }) {
  const [q, setQ] = useState('');
  const canRead = useCan('products.read');
  const list = useProducts({ q: q || undefined, active: true }, { enabled: canRead, limit: 20 });
  const products = list.data?.pages[0]?.items ?? [];
  return (
    <RecordPicker
      value={line.productId ? { id: line.productId, label: line.name } : null}
      onChange={(o) => {
        if (!o) return onPick({ productId: null });
        const p = products.find((x) => x.id === o.id);
        if (!p) return;
        const price = resolveUnitPrice(p, priceList);
        onPick({ productId: p.id, name: p.name, description: p.description ?? '', hsnSac: p.hsnSac, unit: p.unit, gstRate: p.gstRate, unitPrice: String(price / 100) });
      }}
      options={products.map((p) => ({ id: p.id, label: p.name, meta: `${p.sku} · HSN ${p.hsnSac} · ${formatPaise(resolveUnitPrice(p, priceList))} · GST ${p.gstRate}%` }))}
      loading={list.isFetching}
      onQueryChange={setQ}
      placeholder={`Pick a product for ${rowLabel}`}
      emptyText={canRead ? 'No product matches. Type the item name instead.' : 'You cannot read the product list. Type the item name instead.'}
      invalid={invalid}
    />
  );
}

/**
 * Line items with live GST: pick a product (fills HSN/SAC, unit, GST rate and the price-list price)
 * or type a free item; quantity, rate, discount (percent or rupees) and GST rate per line. Amounts
 * per line come from the shared GST math (the same numbers the API stores).
 */
export function LineItemsEditor({
  lines,
  onChange,
  amounts,
  errors,
  priceList,
  disabled,
  taxMode,
}: {
  lines: LineDraft[];
  onChange: (next: LineDraft[]) => void;
  amounts: ReadonlyArray<LineAmounts | undefined>;
  errors: Record<string, string>;
  priceList: PriceList | null;
  disabled?: boolean;
  taxMode: 'intra' | 'inter';
}) {
  const [details, setDetails] = useState<ReadonlySet<string>>(() => new Set());
  const set = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const err = (i: number, f: string) => errors[`lines.${i}.${f}`];
  const describe = (i: number, f: string) => (err(i, f) ? `line-${i}-${f}-err` : undefined);

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3" aria-label="Line items">
        {lines.map((l, i) => {
          const a = amounts[i];
          const rowLabel = `line ${i + 1}`;
          const fieldErrors = ['name', 'quantity', 'unitPricePaise', 'discountValue', 'hsnSac', 'gstRate'].map((f) => [f, err(i, f)] as const).filter(([, m]) => m);
          return (
            <li key={l.key} className="rounded-md border border-border bg-surface p-3">
              <div className="grid gap-2 md:grid-cols-12">
                <div className="flex flex-col gap-1 md:col-span-4">
                  <span className="text-xs font-medium text-fg-secondary" id={`line-${i}-item`}>
                    Item {i + 1}
                  </span>
                  <ProductCell line={l} priceList={priceList} rowLabel={rowLabel} invalid={!!err(i, 'name')} onPick={(patch) => set(i, patch)} />
                  {!l.productId && (
                    <Input aria-label={`Item name, ${rowLabel}`} placeholder="Or type the item name" value={l.name} disabled={disabled} aria-invalid={err(i, 'name') ? true : undefined} aria-describedby={describe(i, 'name')} onChange={(e) => set(i, { name: e.target.value })} />
                  )}
                </div>
                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className="text-xs font-medium text-fg-secondary">HSN/SAC</span>
                  <Input inputMode="numeric" maxLength={8} value={l.hsnSac} disabled={disabled} aria-invalid={err(i, 'hsnSac') ? true : undefined} aria-describedby={describe(i, 'hsnSac')} onChange={(e) => set(i, { hsnSac: e.target.value.replace(/\D/g, '') })} />
                </label>
                <label className="flex flex-col gap-1 md:col-span-1">
                  <span className="text-xs font-medium text-fg-secondary">Qty</span>
                  <Input inputMode="decimal" value={l.quantity} disabled={disabled} aria-invalid={err(i, 'quantity') ? true : undefined} aria-describedby={describe(i, 'quantity')} onChange={(e) => set(i, { quantity: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className="text-xs font-medium text-fg-secondary">Unit</span>
                  <NativeSelect value={l.unit} disabled={disabled} onChange={(e) => set(i, { unit: e.target.value as ProductUnit })}>
                    {PRODUCT_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u} · {PRODUCT_UNIT_LABELS[u]}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className="text-xs font-medium text-fg-secondary">Rate (₹, before GST)</span>
                  <Input inputMode="decimal" value={l.unitPrice} disabled={disabled} aria-invalid={err(i, 'unitPricePaise') ? true : undefined} aria-describedby={describe(i, 'unitPricePaise')} onChange={(e) => set(i, { unitPrice: e.target.value })} />
                </label>
                <div className="flex items-end justify-end md:col-span-1">
                  <Button size="icon" variant="ghost" aria-label={`Remove ${rowLabel}`} disabled={disabled || lines.length === 1} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <div className="flex flex-col gap-1 md:col-span-3">
                  <span className="text-xs font-medium text-fg-secondary" id={`line-${i}-disc`}>
                    Discount
                  </span>
                  <div className="flex gap-1" role="group" aria-labelledby={`line-${i}-disc`}>
                    <Input inputMode="decimal" aria-label={`Discount, ${rowLabel}`} value={l.discount} disabled={disabled} aria-invalid={err(i, 'discountValue') ? true : undefined} aria-describedby={describe(i, 'discountValue')} onChange={(e) => set(i, { discount: e.target.value })} />
                    <NativeSelect aria-label={`Discount type, ${rowLabel}`} wrapperClassName="w-24 shrink-0" value={l.discountKind} disabled={disabled} onChange={(e) => set(i, { discountKind: e.target.value as LineDraft['discountKind'] })}>
                      <option value="percent">%</option>
                      <option value="amount">₹</option>
                    </NativeSelect>
                  </div>
                </div>
                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className="text-xs font-medium text-fg-secondary">GST rate</span>
                  <NativeSelect value={String(l.gstRate)} disabled={disabled} aria-invalid={err(i, 'gstRate') ? true : undefined} onChange={(e) => set(i, { gstRate: Number(e.target.value) as GstRate })}>
                    {GST_RATES.map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <dl className="grid grid-cols-3 gap-2 text-right md:col-span-7 md:self-end">
                  <div>
                    <dt className="text-2xs text-muted-strong">Taxable</dt>
                    <dd className="text-sm tabular-nums">{formatPaise(a?.taxablePaise ?? 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs text-muted-strong">{taxMode === 'intra' ? `CGST + SGST ${l.gstRate / 2}% each` : `IGST ${l.gstRate}%`}</dt>
                    <dd className="text-sm tabular-nums">{formatPaise((a?.cgstPaise ?? 0) + (a?.sgstPaise ?? 0) + (a?.igstPaise ?? 0))}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs text-muted-strong">Amount</dt>
                    <dd className="text-sm font-semibold tabular-nums">{formatPaise(a?.totalPaise ?? 0)}</dd>
                  </div>
                </dl>
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-strong hover:text-fg"
                  aria-expanded={details.has(l.key)}
                  onClick={() => {
                    const next = new Set(details);
                    if (next.has(l.key)) next.delete(l.key);
                    else next.add(l.key);
                    setDetails(next);
                  }}
                >
                  <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', details.has(l.key) && 'rotate-180')} />
                  Description
                </button>
                {details.has(l.key) && (
                  <Input className="mt-1" aria-label={`Description, ${rowLabel}`} value={l.description} disabled={disabled} maxLength={1000} onChange={(e) => set(i, { description: e.target.value })} />
                )}
              </div>
              {fieldErrors.length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5" role="alert">
                  {fieldErrors.map(([f, m]) => (
                    <li key={f} id={`line-${i}-${f}-err`} className="text-xs text-danger-text">
                      {m}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {!disabled && lines.length < 200 && (
        <Button className="w-max" onClick={() => onChange([...lines, emptyLine()])}>
          <Plus aria-hidden />
          Add line
        </Button>
      )}
    </div>
  );
}

/** Totals block: taxable, CGST/SGST or IGST, round-off, total in figures and words, HSN summary. */
export function TotalsPanel({ totals, placeOfSupply, sellerState }: { totals: GstTotals; placeOfSupply: string | null; sellerState: string | null }) {
  const [summary, setSummary] = useState(false);
  const rows: Array<[string, number, boolean?]> = [
    ['Subtotal', totals.subtotalPaise],
    ...(totals.discountPaise ? ([['Discount', -totals.discountPaise]] as Array<[string, number]>) : []),
    ['Taxable value', totals.taxablePaise],
    ...(totals.taxMode === 'intra'
      ? ([
          ['CGST', totals.cgstPaise],
          ['SGST', totals.sgstPaise],
        ] as Array<[string, number]>)
      : ([['IGST', totals.igstPaise]] as Array<[string, number]>)),
    ...(totals.roundOffPaise ? ([['Round off', totals.roundOffPaise]] as Array<[string, number]>) : []),
  ];
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <p className="text-xs text-muted-strong">
        {totals.taxMode === 'intra'
          ? `Intra-state supply${sellerState ? ` within ${stateName(sellerState)}` : ''}: CGST + SGST.`
          : `Inter-state supply${sellerState && placeOfSupply ? ` from ${stateName(sellerState)} to ${stateName(placeOfSupply)}` : ''}: IGST.`}
      </p>
      <dl className="flex flex-col gap-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-muted-strong">{label}</dt>
            <dd className="tabular-nums">{formatPaise(value)}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums" data-testid="document-total">
            {formatPaise(totals.totalPaise)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-fg-secondary">{totals.amountInWords}</p>
      {totals.taxSummary.length > 0 && (
        <div>
          <button type="button" className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-strong hover:text-fg" aria-expanded={summary} onClick={() => setSummary((s) => !s)}>
            <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', summary && 'rotate-180')} />
            HSN/SAC summary
          </button>
          {summary && (
            <table className="mt-2 w-full text-xs">
              <caption className="sr-only">Tax by HSN/SAC and rate</caption>
              <thead>
                <tr className="text-muted-strong">
                  <th scope="col" className="py-1 text-left font-medium">HSN/SAC</th>
                  <th scope="col" className="py-1 text-right font-medium">Rate</th>
                  <th scope="col" className="py-1 text-right font-medium">Taxable</th>
                  <th scope="col" className="py-1 text-right font-medium">Tax</th>
                </tr>
              </thead>
              <tbody>
                {totals.taxSummary.map((r) => (
                  <tr key={`${r.hsnSac}-${r.gstRate}`} className="border-t border-border">
                    <td className="py-1">{r.hsnSac ?? '-'}</td>
                    <td className="py-1 text-right tabular-nums">{r.gstRate}%</td>
                    <td className="py-1 text-right tabular-nums">{formatPaise(r.taxablePaise)}</td>
                    <td className="py-1 text-right tabular-nums">{formatPaise(r.cgstPaise + r.sgstPaise + r.igstPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
