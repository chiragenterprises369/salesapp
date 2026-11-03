import { computeDocument, PartySchema } from '@vistar/shared';
import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderDocumentPdf } from './document-pdf.js';
import { clusters, shapeText, splitRuns } from './fonts.js';
import { loadImage, pdfSafe, PdfDocument, pdfTextString, textWidth, visualText, wrapText } from './pdf-writer.js';

/** Pure checks of the PDF writer, the embedded fonts and the A4 template (no database). */

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

/** Every stream of the PDF, inflated when it is Flate encoded. */
function pdfStreams(buf: Buffer): Array<{ dict: string; data: Buffer }> {
  const text = buf.toString('latin1');
  const out: Array<{ dict: string; data: Buffer }> = [];
  const re = /<<([^]*?)\/Length (\d+) >>\nstream\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const raw = buf.subarray(start, start + Number(m[2]));
    const dict = m[1]!;
    out.push({ dict, data: dict.includes('/FlateDecode') ? inflateSync(raw) : raw });
  }
  return out;
}

const fromUtf16Hex = (hex: string) => {
  let s = '';
  for (let i = 0; i < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return s;
};

/** cid -> text from a ToUnicode CMap. */
function parseCMap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const m of cmap.matchAll(/<([0-9A-F]{4})> <([0-9A-F]+)>/g)) map.set(parseInt(m[1]!, 16), fromUtf16Hex(m[2]!));
  return map;
}

/**
 * Text of a content stream decoded through the fonts' ToUnicode maps (per BT block, in drawing order), and the
 * ActualText of every marked span.
 */
function extractText(pdf: PdfDocument, buf: Buffer): { glyphText: string[]; actualText: string[] } {
  const byResource = new Map<string, Map<number, string>>();
  const cmaps = pdfStreams(buf).filter((s) => s.data.toString('latin1').includes('beginbfchar'));
  const fonts = [...pdf.embeddedFonts.values()];
  // the CMaps are written in the order of the fonts
  fonts.forEach((font, i) => byResource.set(font.resourceName, parseCMap(cmaps[i]!.data.toString('latin1'))));
  const content = pdfStreams(buf)
    .map((s) => s.data.toString('latin1'))
    .filter((s) => s.includes(' Tf '))
    .join('\n');
  const glyphText: string[] = [];
  for (const m of content.matchAll(/BT \/(F\d+) [^]*? ET/g)) {
    const map = byResource.get(m[1]!)!;
    let s = '';
    for (const h of m[0].matchAll(/<([0-9A-F]+)>/g)) for (let i = 0; i < h[1]!.length; i += 4) s += map.get(parseInt(h[1]!.slice(i, i + 4), 16)) ?? '\uFFFD';
    glyphText.push(s);
  }
  const actualText = [...content.matchAll(/\/ActualText <FEFF([0-9A-F]*)>/g)].map((m) => fromUtf16Hex(m[1]!));
  return { glyphText, actualText };
}

describe('pdf fonts', () => {
  it('keeps the rupee sign and Devanagari, drops control characters, replaces what no font has', () => {
    expect(pdfSafe('₹ 1,000 – नमस्ते')).toBe('₹ 1,000 – नमस्ते');
    expect(pdfSafe('a\tb\u0001c')).toBe('a bc');
    expect(pdfSafe('中')).toBe('?');
  });

  it('splits text into runs by script and keeps neutral characters in the surrounding run', () => {
    const runs = splitRuns('Invoice for श्री राम (प्रा.) लि. ₹500');
    expect(runs.map((r) => [r.face.key, r.text])).toEqual([
      ['latin-regular', 'Invoice for '],
      ['devanagari-regular', 'श्री राम (प्रा.) लि. '],
      ['latin-regular', '₹500'],
    ]);
    expect(splitRuns('प्रिया', 'bold')[0]!.face.key).toBe('devanagari-bold');
  });

  it('shapes the rupee sign and Devanagari conjuncts, matras and reph to the expected glyph ids', () => {
    // Noto Sans 2.x / Noto Sans Devanagari 2.x as committed in apps/api/assets/fonts (fontkit 2.0.4)
    expect(shapeText('₹')[0]!.glyphs.map((g) => g.id)).toEqual([1577]);
    // i-matra (U+093F) is drawn before its consonant
    expect(shapeText('कि')[0]!.glyphs.map((g) => g.id)).toEqual([542, 56]);
    // pra conjunct as one glyph, the i-matra variant picked for its width
    expect(shapeText('प्रिया')[0]!.glyphs.map((g) => g.id)).toEqual([543, 309, 81, 31]);
    // sha + virama + ra ligature, then the long ii-matra
    expect(shapeText('श्री')[0]!.glyphs.map((g) => g.id)).toEqual([317, 33]);
    // reph (ra + virama) moves after the cluster it sits on
    const arjun = shapeText('अर्जुन')[0]!;
    expect(arjun.glyphs.map((g) => g.id)).toEqual([5, 63, 34, 503, 75]);
    expect(arjun.glyphs[3]!.codePoints).toEqual([0x930, 0x94d]);
    expect(shapeText('क्ष')[0]!.glyphs.map((g) => g.id)).toEqual([90]);
    expect(shapeText('नमस्ते')[0]!.glyphs.map((g) => g.id)).toEqual([75, 80, 256, 71, 40]);
  });

  it('measures shaped widths with kerning', () => {
    expect(textWidth('AV', 10)).toBeLessThan(textWidth('A', 10) + textWidth('V', 10));
    expect(textWidth('W', 10, 'bold')).toBeGreaterThan(textWidth('W', 10));
    // a reph and below-base matra add no advance
    expect(textWidth('अर्जुन', 10)).toBeCloseTo(textWidth('अजन', 10), 5);
  });

  it('splits long words between grapheme clusters, never inside a conjunct', () => {
    expect(clusters('क्षत्रिय')).toEqual(['क्ष', 'त्रि', 'य']);
  });
});

describe('pdf writer', () => {
  it('wraps mixed Latin and Devanagari text inside the width', () => {
    const input = 'श्री प्रिया शर्मा Trading Pvt Ltd ₹ 1,00,000 पुणे महाराष्ट्र 411001';
    const lines = wrapText(input, 70, 9);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(textWidth(l, 9)).toBeLessThanOrEqual(70);
    expect(lines.join(' ')).toBe(input);
    const long = wrapText('क्षत्रियक्षत्रियक्षत्रियक्षत्रियक्षत्रिय', 30, 9);
    expect(long.length).toBeGreaterThan(1);
    for (const l of long) {
      expect(l).not.toMatch(/^\p{M}/u);
      expect(textWidth(l, 9)).toBeLessThanOrEqual(30);
    }
    expect(long.join('')).toBe('क्षत्रियक्षत्रियक्षत्रियक्षत्रियक्षत्रिय');
  });

  it('writes a valid PDF skeleton with an xref table and embedded Type0 fonts', () => {
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
    expect(text).toContain('/Subtype /Type0');
    expect(text).toContain('/Encoding /Identity-H');
    expect(text).toContain('/Subtype /CIDFontType2');
    expect(text).toContain('/CIDToGIDMap /Identity');
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Regular/);
    expect(text).not.toContain('/Helvetica');
    // the subset font program is a TrueType file
    const fontFile = pdfStreams(buf).find((s) => s.dict.includes('/Length1'))!;
    expect(fontFile.data.readUInt32BE(0)).toBe(0x00010000);
  });

  it('round-trips text through the ToUnicode map and ActualText', () => {
    const pdf = new PdfDocument();
    pdf.text(40, 40, 'Total ₹1,00,000.50');
    pdf.text(40, 60, 'श्री प्रिया शर्मा', { font: 'bold' });
    const buf = pdf.toBuffer();
    const { glyphText, actualText } = extractText(pdf, buf);
    expect(glyphText[0]).toBe('Total ₹1,00,000.50');
    // Devanagari: glyph order is visual, the ActualText span carries the logical text
    expect(actualText).toContain('श्री प्रिया शर्मा');
    const sorted = (s: string) => Array.from(s).sort().join('');
    expect(sorted(glyphText[1]!)).toBe(sorted('श्री प्रिया शर्मा'));
    const run = shapeText('प्रिया', 'bold')[0]!;
    expect(visualText(run)).not.toBe('प्रिया');
    expect(pdf.embeddedFonts.get('devanagari-bold')).toBeDefined();
  });

  it('writes the document info as UTF-16 when it is not plain ASCII', () => {
    expect(pdfTextString('Invoice (1)')).toBe('(Invoice \\(1\\))');
    expect(pdfTextString('₹')).toBe('<FEFF20B9>');
  });

  it('loads PNG logos with alpha as an image plus soft mask', () => {
    const img = loadImage(png(4, 3, [255, 0, 0, 128]));
    expect(img).not.toBeNull();
    expect(img!.width).toBe(4);
    expect(img!.smask).toBeDefined();
    expect(loadImage(Buffer.from('<svg/>'))).toBeNull();
  });

  it('renders a multi-page tax invoice with the logo, the rupee sign and a Devanagari buyer', () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ productId: null, name: i === 0 ? 'सूती कपड़ा (Cotton fabric)' : `Item ${i + 1} with a fairly long description`, description: null, hsnSac: '8471', unit: 'NOS' as const, quantity: 2, unitPricePaise: 125_050, discountKind: 'percent' as const, discountValue: i % 3 ? 0 : 5, gstRate: 18 as const }));
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
      buyer: PartySchema.parse({ name: 'श्री गणेश ट्रेडर्स', contactName: 'प्रिया शर्मा', billingAddress: { line1: 'Road 1', city: 'Bengaluru', stateCode: '29' } }),
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
    expect(text).toMatch(/\+NotoSansDevanagari-Bold/);
    expect(text).toMatch(/\+NotoSans-Bold/);
    const content = pdfStreams(buf)
      .map((s) => s.data.toString('latin1'))
      .join('\n');
    expect(content).toContain(`/ActualText <FEFF${Array.from('श्री गणेश ट्रेडर्स', (c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('')}>`);
  });
});
