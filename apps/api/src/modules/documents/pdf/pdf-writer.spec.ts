import { computeDocument, PartySchema } from '@vistar/shared';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderDocumentPdf } from './document-pdf.js';
import { loadImage, pdfSafe, PdfDocument, textWidth, wrapText } from './pdf-writer.js';

/** Pure checks of the built-in PDF writer and the A4 template (no database). */

function png(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) Buffer.from(rgba).copy(raw, y * (width * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('pdf writer', () => {
  it('maps the rupee sign and drops characters the standard fonts cannot show', () => {
    expect(pdfSafe('₹ 1,000 – नमस्ते')).toBe('Rs. 1,000 - ??????');
  });

  it('measures Helvetica widths and wraps long text', () => {
    expect(textWidth('W', 10)).toBeCloseTo(9.44, 2);
    expect(textWidth('W', 10, 'bold')).toBeCloseTo(9.44, 2);
    const lines = wrapText('alpha beta gamma delta epsilon zeta eta theta', 60, 9);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 9)).toBeLessThanOrEqual(60);
  });

  it('writes a valid PDF skeleton with an xref table', () => {
    const pdf = new PdfDocument();
    pdf.text(40, 40, 'Hello (world) \\ test');
    pdf.addPage();
    pdf.rect(40, 40, 100, 20, { fill: [79, 70, 229] });
    const buf = pdf.toBuffer({ title: 'Test' });
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
  });

  it('loads PNG logos with alpha as an image plus soft mask', () => {
    const img = loadImage(png(4, 3, [255, 0, 0, 128]));
    expect(img).not.toBeNull();
    expect(img!.width).toBe(4);
    expect(img!.smask).toBeDefined();
    expect(loadImage(Buffer.from('<svg/>'))).toBeNull();
  });

  it('renders a multi-page tax invoice with the logo', () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ productId: null, name: `Item ${i + 1} with a fairly long description`, description: null, hsnSac: '8471', unit: 'NOS' as const, quantity: 2, unitPricePaise: 125_050, discountKind: 'percent' as const, discountValue: i % 3 ? 0 : 5, gstRate: 18 as const }));
    const { lines: computed, totals } = computeDocument(lines, { sellerStateCode: '27', placeOfSupplyStateCode: '29' });
    const buf = renderDocumentPdf({
      kind: 'invoice',
      number: 'INV/2026-27/0001',
      status: 'partially_paid',
      issueDate: '2026-11-03',
      validUntil: null,
      dueDate: '2026-11-18',
      seller: { legalName: 'Test Sales Pvt Ltd', tradeName: null, gstin: '27AABCV1234F1Z5', pan: 'AABCV1234F', address: { line1: 'Plot 1', line2: null, city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411001', country: 'IN' }, phone: null, email: null, website: null, bank: { accountName: 'Test', accountNumber: '1234567890', ifsc: 'HDFC0001234', bankName: 'HDFC', branch: null, upiId: null }, signatureLabel: 'Authorised signatory' },
      workspaceName: 'Test',
      buyer: PartySchema.parse({ name: 'Buyer', billingAddress: { line1: 'Road 1', city: 'Bengaluru', stateCode: '29' } }),
      placeOfSupplyStateCode: '29',
      lines: computed.map((l, i) => ({ id: `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`, position: i, ...l, productId: null })),
      totals,
      notes: 'Thank you for your business.',
      terms: 'Payment within 15 days.',
      payments: [],
      paidPaise: 100_000,
      balancePaise: totals.totalPaise - 100_000,
      brandColor: '#0F766E',
      logo: loadImage(png(20, 10, [15, 118, 110, 255])),
    });
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(Number(/\/Count (\d+)/.exec(text)![1])).toBeGreaterThan(1);
    expect(text).toContain('/Subtype /Image');
  });
});
