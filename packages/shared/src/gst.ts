/**
 * GST MATH (change #19 wave B, SPEC 29.9; D-067). Pure functions shared by the API (stored totals, PDFs)
 * and the web editor (live preview), so both always show the same numbers.
 *
 * Money is integer paise. Per line:
 *   gross    = round(quantity x unitPrice)
 *   discount = percent: round(gross x pct / 100) | amount: min(value, gross)
 *   taxable  = gross - discount
 *   intra-state (seller state code = place of supply): CGST = SGST = round(taxable x rate / 200)
 *   inter-state: IGST = round(taxable x rate / 100)
 * Document: sums of the lines; total = taxable + taxes, rounded to the nearest rupee (half up) with a
 * round-off line (-50..+50 paise). Rounding is half up on non-negative amounts (Math.round).
 * Unknown place of supply (no buyer state code) = the seller's state (intra-state).
 * Financial year: 1 April to 31 March ("2026-27"). Numbers: `<prefix>/<FY>/<seq 4 digits>`, e.g. QT/2026-27/0001.
 */
import type { DiscountKind, GstRate, TaxMode } from './enums.js';

export interface GstLineInput {
  quantity: number;
  unitPricePaise: number;
  discountKind: DiscountKind;
  /** percent: 0..100 (2 decimals); amount: paise */
  discountValue: number;
  gstRate: GstRate | number;
  hsnSac?: string | null;
}

export interface GstLineAmounts {
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** taxable + taxes of the line */
  totalPaise: number;
}

export interface GstTaxSummaryRow {
  hsnSac: string | null;
  gstRate: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface GstTotals {
  taxMode: TaxMode;
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  amountInWords: string;
  /** Grouped by HSN/SAC and rate (the HSN summary of a tax invoice). */
  taxSummary: GstTaxSummaryRow[];
}

/** Quantities keep at most 3 decimals (stored as Decimal(14,3)). */
export const roundQuantity = (q: number): number => Math.round(q * 1000) / 1000;

/** intra when both state codes are known and equal, or the place of supply is unknown. */
export function taxModeFor(sellerStateCode: string | null | undefined, placeOfSupplyStateCode: string | null | undefined): TaxMode {
  if (!placeOfSupplyStateCode || !sellerStateCode) return 'intra';
  return sellerStateCode === placeOfSupplyStateCode ? 'intra' : 'inter';
}

export function computeLine(line: GstLineInput, mode: TaxMode): GstLineAmounts {
  const qty = roundQuantity(Math.max(0, line.quantity));
  const unit = Math.max(0, Math.round(line.unitPricePaise));
  const grossPaise = Math.round(qty * unit);
  const discountPaise =
    line.discountKind === 'percent'
      ? Math.min(grossPaise, Math.round((grossPaise * Math.min(100, Math.max(0, line.discountValue))) / 100))
      : Math.min(grossPaise, Math.max(0, Math.round(line.discountValue)));
  const taxablePaise = grossPaise - discountPaise;
  const rate = Math.max(0, line.gstRate);
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  if (mode === 'intra') {
    cgstPaise = Math.round((taxablePaise * rate) / 200);
    sgstPaise = cgstPaise;
  } else {
    igstPaise = Math.round((taxablePaise * rate) / 100);
  }
  return { grossPaise, discountPaise, taxablePaise, cgstPaise, sgstPaise, igstPaise, totalPaise: taxablePaise + cgstPaise + sgstPaise + igstPaise };
}

/** Round a paise amount to the nearest rupee (half up). */
export const roundToRupee = (paise: number): number => Math.round(paise / 100) * 100;

export function computeDocument<L extends GstLineInput>(
  lines: readonly L[],
  ctx: { sellerStateCode: string | null | undefined; placeOfSupplyStateCode: string | null | undefined },
): { lines: Array<L & GstLineAmounts>; totals: GstTotals } {
  const taxMode = taxModeFor(ctx.sellerStateCode, ctx.placeOfSupplyStateCode);
  const computed = lines.map((l) => ({ ...l, ...computeLine(l, taxMode) }));
  const sum = (k: keyof GstLineAmounts) => computed.reduce((acc, l) => acc + l[k], 0);
  const taxablePaise = sum('taxablePaise');
  const cgstPaise = sum('cgstPaise');
  const sgstPaise = sum('sgstPaise');
  const igstPaise = sum('igstPaise');
  const taxPaise = cgstPaise + sgstPaise + igstPaise;
  const exact = taxablePaise + taxPaise;
  const totalPaise = roundToRupee(exact);

  const groups = new Map<string, GstTaxSummaryRow>();
  for (const l of computed) {
    const hsn = l.hsnSac?.trim() || null;
    const key = `${hsn ?? ''}|${l.gstRate}`;
    const row = groups.get(key) ?? { hsnSac: hsn, gstRate: Number(l.gstRate), taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    row.taxablePaise += l.taxablePaise;
    row.cgstPaise += l.cgstPaise;
    row.sgstPaise += l.sgstPaise;
    row.igstPaise += l.igstPaise;
    groups.set(key, row);
  }

  return {
    lines: computed,
    totals: {
      taxMode,
      subtotalPaise: sum('grossPaise'),
      discountPaise: sum('discountPaise'),
      taxablePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      taxPaise,
      roundOffPaise: totalPaise - exact,
      totalPaise,
      amountInWords: amountInWordsInr(totalPaise),
      taxSummary: [...groups.values()].sort((a, b) => (a.hsnSac ?? '').localeCompare(b.hsnSac ?? '') || a.gstRate - b.gstRate),
    },
  };
}

// ---------------------------------------------------------------- amount in words (Indian numbering)

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  const o = n % 10;
  return o ? `${t}-${ONES[o]!}` : t;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]!} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/** 123456789 -> "Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine" (whole numbers). */
export function numberToIndianWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(' ');
}

/** 12345650 paise -> "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only". */
export function amountInWordsInr(paise: number): string {
  const p = Math.round(Math.abs(paise));
  const rupees = Math.floor(p / 100);
  const rest = p % 100;
  const words = `Rupees ${numberToIndianWords(rupees)}`;
  return rest ? `${words} and ${twoDigits(rest)} Paise Only` : `${words} Only`;
}

// ---------------------------------------------------------------- formatting, financial year, numbering

/** 12345650 -> "₹1,23,456.50" (en-IN grouping, always 2 decimals). */
export function formatPaise(paise: number, opts: { symbol?: boolean } = {}): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const s = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs / 100);
  return `${sign}${opts.symbol === false ? '' : '₹'}${s}`;
}

export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);
export const paiseToRupees = (paise: number): number => Math.round(paise) / 100;

/** "2026-11-03" (or a Date, read in UTC) -> "2026-27". */
export function financialYearOf(date: string | Date): string {
  const iso = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const DOCUMENT_NUMBER_PAD = 4;

/** formatDocumentNumber('QT', '2026-27', 1) -> "QT/2026-27/0001" (GST: at most 16 characters, letters, digits, / and -). */
export function formatDocumentNumber(prefix: string, financialYear: string, sequence: number, pad = DOCUMENT_NUMBER_PAD): string {
  return `${prefix}/${financialYear}/${String(sequence).padStart(pad, '0')}`;
}

/** Document number prefixes: 1-6 letters, digits or "-". */
export const DOCUMENT_PREFIX_RE = /^[A-Z0-9-]{1,6}$/;
