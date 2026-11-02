import { computeDocument, GST_RATES, type DiscountKind, type GstRate, type LineItem, type LineItemInput, type ProductUnit } from '@vistar/shared';

/**
 * Line-item drafts of the quotation, invoice and deal editors (text inputs as typed) and their
 * conversion to the API input and to the shared GST math (computeDocument), so the live preview uses
 * exactly the numbers the API stores.
 */
export interface LineDraft {
  key: string;
  productId: string | null;
  name: string;
  description: string;
  hsnSac: string;
  unit: ProductUnit;
  /** As typed ("2", "1.5") */
  quantity: string;
  /** Rupees as typed ("1250", "1,250.50") */
  unitPrice: string;
  discountKind: DiscountKind;
  /** percent: "10"; amount: rupees "500" */
  discount: string;
  gstRate: GstRate;
}

let seq = 0;
export const newLineKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyLine(): LineDraft {
  return { key: newLineKey(), productId: null, name: '', description: '', hsnSac: '', unit: 'NOS', quantity: '1', unitPrice: '', discountKind: 'percent', discount: '', gstRate: 18 };
}

const num = (s: string) => Number(s.replace(/[,₹\s]/g, ''));
const isNum = (s: string) => /^\d+(\.\d+)?$/.test(s.replace(/[,₹\s]/g, ''));

export const rupeesText = (paise: number) => {
  const r = paise / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
};

export function lineFromItem(l: LineItem): LineDraft {
  return {
    key: l.id,
    productId: l.productId,
    name: l.name,
    description: l.description ?? '',
    hsnSac: l.hsnSac ?? '',
    unit: l.unit,
    quantity: String(l.quantity),
    unitPrice: rupeesText(l.unitPricePaise),
    discountKind: l.discountKind,
    discount: l.discountValue ? (l.discountKind === 'amount' ? rupeesText(l.discountValue) : String(l.discountValue)) : '',
    gstRate: l.gstRate,
  };
}

export const isBlankLine = (l: LineDraft) => !l.productId && !l.name.trim() && !l.unitPrice.trim() && !l.hsnSac.trim();

/** Numbers for the GST math (invalid text counts as 0 so the preview never breaks). */
export function toGstInput(l: LineDraft) {
  const quantity = isNum(l.quantity) ? num(l.quantity) : 0;
  const unitPricePaise = isNum(l.unitPrice) ? Math.round(num(l.unitPrice) * 100) : 0;
  const d = isNum(l.discount) ? num(l.discount) : 0;
  return {
    quantity,
    unitPricePaise,
    discountKind: l.discountKind,
    discountValue: l.discountKind === 'amount' ? Math.round(d * 100) : Math.min(100, d),
    gstRate: l.gstRate,
    hsnSac: l.hsnSac.trim() || null,
  };
}

/**
 * Live totals for the drafts (blank rows ignored). A seller without a GSTIN is not GST registered: like
 * the API, every line is computed at 0% then.
 */
export function previewTotals(lines: readonly LineDraft[], sellerStateCode: string | null | undefined, placeOfSupplyStateCode: string | null | undefined, opts: { gstRegistered?: boolean } = {}) {
  const used = lines.filter((l) => !isBlankLine(l));
  const registered = opts.gstRegistered ?? true;
  return computeDocument(used.map((l) => ({ ...toGstInput(l), ...(registered ? {} : { gstRate: 0 }) })), { sellerStateCode, placeOfSupplyStateCode });
}

/** Validate drafts; errors keyed `lines.<index>.<field>` like the API. */
export function linesProblems(lines: readonly LineDraft[]): Record<string, string> {
  const e: Record<string, string> = {};
  lines.forEach((l, i) => {
    if (isBlankLine(l)) return;
    if (!l.name.trim()) e[`lines.${i}.name`] = 'Enter an item name or pick a product.';
    if (!isNum(l.quantity) || num(l.quantity) <= 0) e[`lines.${i}.quantity`] = 'Enter a quantity above 0.';
    else if (!/^\d+(\.\d{1,3})?$/.test(l.quantity.trim())) e[`lines.${i}.quantity`] = 'Use at most 3 decimals.';
    if (!isNum(l.unitPrice)) e[`lines.${i}.unitPricePaise`] = 'Enter the rate in rupees.';
    else if (!/^\d+(\.\d{1,2})?$/.test(l.unitPrice.replace(/[,₹\s]/g, ''))) e[`lines.${i}.unitPricePaise`] = 'Use at most 2 decimals (paise).';
    if (l.discount.trim()) {
      if (!isNum(l.discount)) e[`lines.${i}.discountValue`] = 'Enter a number.';
      else if (l.discountKind === 'percent' && num(l.discount) > 100) e[`lines.${i}.discountValue`] = 'A discount is at most 100%.';
    }
    if (l.hsnSac.trim() && !/^\d{4,8}$/.test(l.hsnSac.trim())) e[`lines.${i}.hsnSac`] = 'HSN has 4, 6 or 8 digits; SAC has 6.';
    if (!(GST_RATES as readonly number[]).includes(l.gstRate)) e[`lines.${i}.gstRate`] = 'Pick a GST rate.';
  });
  return e;
}

/** Drafts -> API line inputs (blank rows dropped). */
export function toLineInputs(lines: readonly LineDraft[]): LineItemInput[] {
  return lines
    .filter((l) => !isBlankLine(l))
    .map((l) => {
      const g = toGstInput(l);
      return {
        productId: l.productId,
        name: l.name.trim(),
        description: l.description.trim() || null,
        hsnSac: l.hsnSac.trim() || null,
        unit: l.unit,
        quantity: Math.round(g.quantity * 1000) / 1000,
        unitPricePaise: g.unitPricePaise,
        discountKind: l.discountKind,
        discountValue: l.discountKind === 'amount' ? g.discountValue : Math.round(g.discountValue * 100) / 100,
        gstRate: l.gstRate,
      };
    });
}

/** Re-key server line errors ("lines.1.gstRate") to the draft index, skipping blank rows. */
export function mapLineErrors(errors: Record<string, string>, lines: readonly LineDraft[]): Record<string, string> {
  const used = lines.map((l, i) => ({ l, i })).filter(({ l }) => !isBlankLine(l));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) {
    const m = /^lines\.(\d+)\.(.+)$/.exec(k);
    if (!m) {
      out[k] = v;
      continue;
    }
    const target = used[Number(m[1])];
    if (target) out[`lines.${target.i}.${m[2]}`] = v;
  }
  return out;
}
