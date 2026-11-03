import { formatPaise, stateName, type Address, type DocumentTotals, type LineItem, type Party, type Payment, type SellerSnapshot } from '@vistar/shared';
import { hexToRgb, PdfDocument, wrapText, type PdfImage, type Rgb } from './pdf-writer.js';

/**
 * A4 quotation / tax invoice template (SPEC 29.9): brand colour band and logo, seller and buyer blocks
 * with GSTIN and place of supply, line table with HSN/SAC, totals with CGST + SGST or IGST and round-off,
 * amount in words, HSN summary, payments (invoices), bank details, terms, signature, page numbers. Text uses the
 * embedded Noto fonts (D-071), so amounts carry the rupee sign and Devanagari names print shaped.
 */
export interface DocumentPdfInput {
  kind: 'quotation' | 'invoice';
  number: string | null;
  status: string;
  issueDate: string;
  validUntil: string | null;
  dueDate: string | null;
  seller: SellerSnapshot | null;
  workspaceName: string;
  buyer: Party;
  placeOfSupplyStateCode: string | null;
  lines: LineItem[];
  totals: DocumentTotals;
  notes: string | null;
  terms: string | null;
  payments: Payment[];
  paidPaise: number | null;
  balancePaise: number | null;
  brandColor: string | null;
  logo: PdfImage | null;
}

const M = 40; // page margin
const INK: Rgb = [17, 24, 39];
const MUTED: Rgb = [75, 85, 99];
const RULE: Rgb = [209, 213, 219];
const ZEBRA: Rgb = [246, 247, 249];
const money = (p: number) => formatPaise(p, { symbol: false });
const fmtDate = (d: string | null) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}-${m}-${y}`;
};
const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));

function addressLines(a: Address | null): string[] {
  if (!a) return [];
  const state = a.state ?? stateName(a.stateCode);
  return [a.line1, a.line2, [a.city, state, a.pincode].filter(Boolean).join(', ')].filter((l): l is string => !!l && l.trim() !== '');
}

/** Light tint of the brand colour for table headers (mix with white). */
const tint = (c: Rgb, t = 0.88): Rgb => [Math.round(c[0] + (255 - c[0]) * t), Math.round(c[1] + (255 - c[1]) * t), Math.round(c[2] + (255 - c[2]) * t)];

export function renderDocumentPdf(d: DocumentPdfInput): Buffer {
  const pdf = new PdfDocument();
  const brand = hexToRgb(d.brandColor);
  const headTint = tint(brand);
  const W = pdf.width - 2 * M;
  const bottom = pdf.height - 60;
  const intra = d.totals.taxMode === 'intra';
  const gstRegistered = !!d.seller?.gstin;
  const title = d.kind === 'quotation' ? 'QUOTATION' : gstRegistered ? 'TAX INVOICE' : 'INVOICE';
  let y = 0;

  // ---------------------------------------------------------------- header
  pdf.rect(0, 0, pdf.width, 6, { fill: brand });
  y = 26;
  let logoH = 0;
  if (d.logo) logoH = pdf.image(d.logo, M, y, 150, 50).height;
  else pdf.text(M, y + 16, d.seller?.tradeName ?? d.seller?.legalName ?? d.workspaceName, { size: 16, font: 'bold', color: brand });
  pdf.text(pdf.width - M, y + 14, title, { size: 16, font: 'bold', color: brand, align: 'right' });
  const meta: Array<[string, string]> = [
    [d.kind === 'quotation' ? 'Quotation no.' : 'Invoice no.', d.number ?? 'Draft'],
    ['Date', fmtDate(d.issueDate)],
    ...(d.kind === 'quotation' && d.validUntil ? [['Valid until', fmtDate(d.validUntil)] as [string, string]] : []),
    ...(d.kind === 'invoice' && d.dueDate ? [['Due date', fmtDate(d.dueDate)] as [string, string]] : []),
    ...(d.placeOfSupplyStateCode ? [['Place of supply', `${stateName(d.placeOfSupplyStateCode) ?? ''} (${d.placeOfSupplyStateCode})`] as [string, string]] : []),
  ];
  let my = y + 30;
  for (const [k, v] of meta) {
    pdf.text(pdf.width - M - 110, my, k, { size: 8, color: MUTED, align: 'right' });
    pdf.text(pdf.width - M, my, v, { size: 8.5, font: 'bold', align: 'right' });
    my += 12;
  }
  if (d.status === 'cancelled') pdf.text(pdf.width - M, my + 4, 'CANCELLED', { size: 10, font: 'bold', color: [185, 28, 28], align: 'right' });
  y = Math.max(y + Math.max(logoH, 24) + 10, my + 4);

  // ---------------------------------------------------------------- parties
  const colW = (W - 20) / 2;
  const block = (x: number, label: string, rows: Array<{ text: string; bold?: boolean }>): number => {
    let by = y;
    pdf.text(x, by, label, { size: 7.5, font: 'bold', color: brand });
    by += 12;
    for (const r of rows) {
      for (const line of wrapText(r.text, colW, 8.5, r.bold ? 'bold' : 'regular')) {
        pdf.text(x, by, line, { size: 8.5, font: r.bold ? 'bold' : 'regular', color: r.bold ? INK : MUTED });
        by += 11;
      }
    }
    return by;
  };
  const s = d.seller;
  const sellerRows = s
    ? [
        { text: s.legalName, bold: true },
        ...(s.tradeName && s.tradeName !== s.legalName ? [{ text: s.tradeName }] : []),
        ...addressLines(s.address).map((text) => ({ text })),
        ...(s.gstin ? [{ text: `GSTIN: ${s.gstin}` }] : []),
        ...(s.pan ? [{ text: `PAN: ${s.pan}` }] : []),
        ...([s.phone, s.email].filter(Boolean).length ? [{ text: [s.phone, s.email].filter(Boolean).join('  |  ') }] : []),
      ]
    : [{ text: d.workspaceName, bold: true }];
  const b = d.buyer;
  const buyerRows = [
    { text: b.name, bold: true },
    ...(b.contactName ? [{ text: `Attn: ${b.contactName}` }] : []),
    ...addressLines(b.billingAddress).map((text) => ({ text })),
    ...(b.gstin ? [{ text: `GSTIN: ${b.gstin}` }] : []),
    ...(b.billingAddress?.stateCode ? [{ text: `State code: ${b.billingAddress.stateCode}` }] : []),
    ...([b.phone, b.email].filter(Boolean).length ? [{ text: [b.phone, b.email].filter(Boolean).join('  |  ') }] : []),
  ];
  const left = block(M, 'FROM', sellerRows);
  const right = block(M + colW + 20, 'BILL TO', buyerRows);
  y = Math.max(left, right);
  const ship = b.shippingAddress;
  if (ship && JSON.stringify(ship) !== JSON.stringify(b.billingAddress)) {
    y += 4;
    y = block(M + colW + 20, 'SHIP TO', addressLines(ship).map((text) => ({ text })));
  }
  y += 10;

  // ---------------------------------------------------------------- lines table
  const cols = [
    { key: '#', w: 18, align: 'left' as const },
    { key: 'Item', w: 160, align: 'left' as const },
    { key: 'HSN/SAC', w: 46, align: 'left' as const },
    { key: 'Qty', w: 46, align: 'right' as const },
    { key: 'Rate', w: 58, align: 'right' as const },
    { key: 'Disc.', w: 42, align: 'right' as const },
    { key: 'Taxable', w: 62, align: 'right' as const },
    { key: 'GST', w: 26, align: 'right' as const },
    { key: 'Amount', w: W - 458, align: 'right' as const },
  ];
  const xs: number[] = [];
  cols.reduce((x, c) => (xs.push(x), x + c.w), M);
  const header = () => {
    pdf.rect(M, y, W, 18, { fill: headTint });
    cols.forEach((c, i) => pdf.text(c.align === 'right' ? xs[i]! + c.w - 4 : xs[i]! + 4, y + 12, c.key, { size: 7.5, font: 'bold', color: INK, align: c.align }));
    y += 18;
  };
  const newPage = () => {
    pdf.addPage();
    pdf.rect(0, 0, pdf.width, 6, { fill: brand });
    y = 30;
  };
  header();
  d.lines.forEach((l, i) => {
    const nameLines = wrapText(l.name, cols[1]!.w - 8, 8.5, 'bold');
    const descLines = l.description ? wrapText(l.description, cols[1]!.w - 8, 7.5) : [];
    const h = Math.max(16, 6 + nameLines.length * 10 + descLines.length * 9 + 4);
    if (y + h > bottom) {
      newPage();
      header();
    }
    if (i % 2 === 1) pdf.rect(M, y, W, h, { fill: ZEBRA });
    const ty = y + 11;
    const disc = l.discountPaise ? (l.discountKind === 'percent' ? `${l.discountValue}%` : money(l.discountPaise)) : '-';
    const cells = [String(i + 1), '', l.hsnSac ?? '', `${qty(l.quantity)} ${l.unit}`, money(l.unitPricePaise), disc, money(l.taxablePaise), `${l.gstRate}%`, money(l.totalPaise)];
    cells.forEach((v, ci) => {
      if (ci === 1) return;
      const c = cols[ci]!;
      pdf.text(c.align === 'right' ? xs[ci]! + c.w - 4 : xs[ci]! + 4, ty, v, { size: 8, align: c.align });
    });
    let ny = ty;
    for (const nl of nameLines) {
      pdf.text(xs[1]! + 4, ny, nl, { size: 8.5, font: 'bold' });
      ny += 10;
    }
    for (const dl of descLines) {
      pdf.text(xs[1]! + 4, ny, dl, { size: 7.5, color: MUTED });
      ny += 9;
    }
    y += h;
    pdf.line(M, y, M + W, y, { color: RULE });
  });
  y += 10;

  // ---------------------------------------------------------------- totals
  const t = d.totals;
  const totalRows: Array<[string, string, boolean?]> = [
    ['Subtotal', money(t.subtotalPaise)],
    ...(t.discountPaise ? [['Discount', `-${money(t.discountPaise)}`] as [string, string]] : []),
    ['Taxable value', money(t.taxablePaise)],
    ...(intra
      ? ([
          ['CGST', money(t.cgstPaise)],
          ['SGST', money(t.sgstPaise)],
        ] as Array<[string, string]>)
      : ([['IGST', money(t.igstPaise)]] as Array<[string, string]>)),
    ...(t.roundOffPaise ? [['Round off', `${t.roundOffPaise > 0 ? '+' : '-'}${money(Math.abs(t.roundOffPaise))}`] as [string, string]] : []),
  ];
  const need = totalRows.length * 14 + 60;
  if (y + need > bottom) newPage();
  const tx = M + W - 220;
  for (const [k, v] of totalRows) {
    pdf.text(tx, y + 10, k, { size: 8.5, color: MUTED });
    pdf.text(M + W - 4, y + 10, v, { size: 8.5, align: 'right' });
    y += 14;
  }
  pdf.rect(tx - 6, y + 2, 226, 22, { fill: brand });
  pdf.text(tx, y + 17, 'Total (INR)', { size: 10, font: 'bold', color: [255, 255, 255] });
  pdf.text(M + W - 4, y + 17, formatPaise(t.totalPaise), { size: 10.5, font: 'bold', color: [255, 255, 255], align: 'right' });
  y += 30;
  if (d.kind === 'invoice' && d.paidPaise !== null && d.balancePaise !== null && d.paidPaise > 0) {
    pdf.text(tx, y + 10, 'Paid', { size: 8.5, color: MUTED });
    pdf.text(M + W - 4, y + 10, money(d.paidPaise), { size: 8.5, align: 'right' });
    y += 14;
    pdf.text(tx, y + 10, 'Balance due', { size: 8.5, font: 'bold' });
    pdf.text(M + W - 4, y + 10, money(d.balancePaise), { size: 8.5, font: 'bold', align: 'right' });
    y += 16;
  }
  const words = wrapText(`Amount in words: ${t.amountInWords}`, W, 8.5, 'bold');
  for (const wl of words) {
    pdf.text(M, y + 10, wl, { size: 8.5, font: 'bold' });
    y += 12;
  }
  y += 8;

  // ---------------------------------------------------------------- HSN summary
  if (gstRegistered && t.taxSummary.length) {
    const rows = t.taxSummary.length;
    if (y + 34 + rows * 14 > bottom) newPage();
    const hc = intra ? ['HSN/SAC', 'Taxable', 'Rate', 'CGST', 'SGST', 'Total tax'] : ['HSN/SAC', 'Taxable', 'Rate', 'IGST', 'Total tax'];
    const hw = W / hc.length;
    pdf.rect(M, y, W, 16, { fill: headTint });
    hc.forEach((h, i) => pdf.text(i === 0 ? M + 4 : M + hw * (i + 1) - 4, y + 11, h, { size: 7.5, font: 'bold', align: i === 0 ? 'left' : 'right' }));
    y += 16;
    for (const r of t.taxSummary) {
      const tax = r.cgstPaise + r.sgstPaise + r.igstPaise;
      const vals = intra ? [r.hsnSac ?? '-', money(r.taxablePaise), `${r.gstRate}%`, money(r.cgstPaise), money(r.sgstPaise), money(tax)] : [r.hsnSac ?? '-', money(r.taxablePaise), `${r.gstRate}%`, money(r.igstPaise), money(tax)];
      vals.forEach((v, i) => pdf.text(i === 0 ? M + 4 : M + hw * (i + 1) - 4, y + 10, v, { size: 8, align: i === 0 ? 'left' : 'right' }));
      y += 14;
      pdf.line(M, y, M + W, y, { color: RULE });
    }
    y += 10;
  }

  // ---------------------------------------------------------------- payments, bank, terms, notes
  const section = (label: string, text: string | null | undefined) => {
    if (!text?.trim()) return;
    const lines = wrapText(text, W, 8);
    if (y + 16 + lines.length * 10 > bottom) newPage();
    pdf.text(M, y + 10, label, { size: 8, font: 'bold', color: brand });
    y += 14;
    for (const l of lines) {
      pdf.text(M, y + 8, l, { size: 8, color: MUTED });
      y += 10;
    }
    y += 6;
  };
  if (d.kind === 'invoice' && d.payments.length) {
    section('PAYMENTS RECEIVED', d.payments.map((p) => `${fmtDate(p.paidOn)}  ${p.mode.replace('_', ' ')}  ${formatPaise(p.amountPaise)}${p.reference ? `  (${p.reference})` : ''}`).join('\n'));
  }
  const bank = s?.bank;
  if (bank && (bank.accountNumber || bank.upiId)) {
    section(
      'BANK DETAILS',
      [bank.accountName && `Account name: ${bank.accountName}`, bank.accountNumber && `Account no.: ${bank.accountNumber}`, bank.ifsc && `IFSC: ${bank.ifsc}`, bank.bankName && `Bank: ${bank.bankName}${bank.branch ? `, ${bank.branch}` : ''}`, bank.upiId && `UPI: ${bank.upiId}`]
        .filter(Boolean)
        .join('\n'),
    );
  }
  section('TERMS AND CONDITIONS', d.terms);
  section('NOTES', d.notes);

  // ---------------------------------------------------------------- signature
  if (y + 60 > bottom) newPage();
  y += 10;
  pdf.text(M + W, y + 10, `For ${s?.legalName ?? d.workspaceName}`, { size: 8.5, font: 'bold', align: 'right' });
  pdf.line(M + W - 160, y + 44, M + W, y + 44, { color: RULE });
  pdf.text(M + W, y + 56, s?.signatureLabel ?? 'Authorised signatory', { size: 8, color: MUTED, align: 'right' });
  if (d.kind === 'invoice' && !gstRegistered) pdf.text(M, y + 56, 'The supplier is not registered under GST.', { size: 7.5, color: MUTED });

  // ---------------------------------------------------------------- footer
  const pages = pdf.pageCount;
  for (let i = 0; i < pages; i++) {
    pdf.onPage(i, () => {
      pdf.line(M, pdf.height - 40, pdf.width - M, pdf.height - 40, { color: RULE });
      pdf.text(M, pdf.height - 28, `${title} ${d.number ?? 'Draft'}`, { size: 7.5, color: MUTED });
      pdf.text(pdf.width - M, pdf.height - 28, `Page ${i + 1} of ${pages}`, { size: 7.5, color: MUTED, align: 'right' });
    });
  }
  return pdf.toBuffer({ title: `${title} ${d.number ?? 'Draft'}`, author: s?.legalName ?? d.workspaceName });
}
