import { deflateSync, inflateSync } from 'node:zlib';

/**
 * Minimal PDF 1.4 writer (D-068: no new dependency, no headless browser). Enough for A4 business
 * documents: the two standard fonts Helvetica and Helvetica-Bold (WinAnsiEncoding, no embedding),
 * text with measured widths, lines, rectangles, and JPEG or PNG images (8-bit, non-interlaced; PNG
 * alpha becomes a soft mask). Coordinates are in points with the origin at the TOP-left of the page.
 */

export const A4 = { width: 595.28, height: 841.89 } as const;
export type Rgb = readonly [number, number, number];
export type FontName = 'regular' | 'bold';

// Helvetica and Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126 (Adobe AFM).
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778,
  722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778,
  722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

const REPLACE: Record<string, string> = { '₹': 'Rs.', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '•': '-', '×': 'x', '\u00a0': ' ' };

/** Text the standard fonts can show: common punctuation mapped, other non-Latin-1 characters become "?". */
export function pdfSafe(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const r = REPLACE[ch];
    if (r !== undefined) out += r;
    else {
      const c = ch.codePointAt(0)!;
      out += c === 9 ? ' ' : c >= 32 && c <= 126 ? ch : c >= 160 && c <= 255 ? ch : '?';
    }
  }
  return out;
}

export function textWidth(s: string, size: number, font: FontName = 'regular'): number {
  const table = font === 'bold' ? HELVETICA_BOLD : HELVETICA;
  let w = 0;
  for (const ch of pdfSafe(s)) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? table[c - 32]! : 556;
  }
  return (w * size) / 1000;
}

/** Greedy word wrap; words longer than the width are split. */
export function wrapText(s: string, maxWidth: number, size: number, font: FontName = 'regular'): string[] {
  const lines: string[] = [];
  for (const para of pdfSafe(s).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, font) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (textWidth(rest, size, font) > maxWidth && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && textWidth(rest.slice(0, n), size, font) > maxWidth) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

const escapePdf = (s: string) => pdfSafe(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const f = (n: number) => (Math.round(n * 100) / 100).toString();
const rgb = (c: Rgb) => c.map((v) => f(v / 255)).join(' ');

export function hexToRgb(hex: string | null | undefined, fallback: Rgb = [79, 70, 229]): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------- images

export interface PdfImage {
  width: number;
  height: number;
  /** XObject dictionary entries + stream data; smask is a second XObject (PNG alpha). */
  dict: string;
  data: Buffer;
  smask?: { dict: string; data: Buffer };
}

function jpegImage(buf: Buffer): PdfImage | null {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      const comps = buf[i + 9]!;
      const cs = comps === 1 ? '/DeviceGray' : comps === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
      return { width, height, dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode`, data: buf };
    }
    i += 2 + len;
  }
  return null;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function pngImage(buf: Buffer): PdfImage | null {
  if (buf.length < 33 || buf.readUInt32BE(12) !== 0x49484452) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24]!;
  const colorType = buf[25]!;
  const interlace = buf[28]!;
  if (depth !== 8 || interlace !== 0 || width > 4000 || height > 4000) return null;
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels) return null;
  const idat: Buffer[] = [];
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  for (let p = 8; p < buf.length - 8; ) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IDAT') idat.push(body);
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const left = x >= channels ? px[dst + x - channels]! : 0;
      const up = y > 0 ? px[dst - stride + x]! : 0;
      const ul = y > 0 && x >= channels ? px[dst - stride + x - channels]! : 0;
      px[dst + x] = (filter === 1 ? v + left : filter === 2 ? v + up : filter === 3 ? v + ((left + up) >> 1) : filter === 4 ? v + paeth(left, up, ul) : v) & 255;
    }
  }
  const n = width * height;
  let color: Buffer;
  let alpha: Buffer | null = null;
  let cs = '/DeviceRGB';
  if (colorType === 3) {
    if (!palette) return null;
    color = Buffer.alloc(n * 3);
    alpha = trns ? Buffer.alloc(n) : null;
    for (let i = 0; i < n; i++) {
      const idx = px[i]!;
      palette.copy(color, i * 3, idx * 3, idx * 3 + 3);
      if (alpha && trns) alpha[i] = idx < trns.length ? trns[idx]! : 255;
    }
  } else if (colorType === 6 || colorType === 4) {
    const c = colorType === 6 ? 3 : 1;
    cs = c === 3 ? '/DeviceRGB' : '/DeviceGray';
    color = Buffer.alloc(n * c);
    alpha = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      px.copy(color, i * c, i * (c + 1), i * (c + 1) + c);
      alpha[i] = px[i * (c + 1) + c]!;
    }
  } else {
    color = px;
    cs = colorType === 0 ? '/DeviceGray' : '/DeviceRGB';
  }
  const img: PdfImage = { width, height, dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /FlateDecode`, data: deflateSync(color) };
  if (alpha && alpha.some((a) => a !== 255)) {
    img.smask = { dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, data: deflateSync(alpha) };
  }
  return img;
}

/** JPEG or PNG bytes -> image, or null when the format is not supported (SVG, 16-bit PNG, ...). */
export function loadImage(buf: Buffer): PdfImage | null {
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) return jpegImage(buf);
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return pngImage(buf);
  return null;
}

// ---------------------------------------------------------------- document

export class PdfDocument {
  private readonly pages: string[][] = [];
  private readonly images: PdfImage[] = [];
  readonly width = A4.width;
  readonly height = A4.height;

  constructor() {
    this.addPage();
  }

  get pageCount(): number {
    return this.pages.length;
  }

  addPage(): void {
    this.pages.push([]);
  }

  private get ops(): string[] {
    return this.pages[this.pages.length - 1]!;
  }

  /** Draw on a given page (0-based), e.g. page numbers at the end. */
  onPage(index: number, draw: () => void): void {
    const keep = this.pages.splice(index + 1);
    draw();
    this.pages.push(...keep);
  }

  text(x: number, y: number, s: string, o: { size?: number; font?: FontName; color?: Rgb; align?: 'left' | 'right' | 'center' } = {}): void {
    const size = o.size ?? 9;
    const font = o.font ?? 'regular';
    const w = textWidth(s, size, font);
    const dx = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT /${font === 'bold' ? 'F2' : 'F1'} ${f(size)} Tf ${rgb(o.color ?? [17, 24, 39])} rg ${f(dx)} ${f(this.height - y)} Td (${escapePdf(s)}) Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, o: { width?: number; color?: Rgb } = {}): void {
    this.ops.push(`${f(o.width ?? 0.5)} w ${rgb(o.color ?? [209, 213, 219])} RG ${f(x1)} ${f(this.height - y1)} m ${f(x2)} ${f(this.height - y2)} l S`);
  }

  rect(x: number, y: number, w: number, h: number, o: { fill?: Rgb; stroke?: Rgb; width?: number }): void {
    const parts = [`${f(x)} ${f(this.height - y - h)} ${f(w)} ${f(h)} re`];
    if (o.fill) parts.unshift(`${rgb(o.fill)} rg`);
    if (o.stroke) parts.unshift(`${f(o.width ?? 0.5)} w ${rgb(o.stroke)} RG`);
    parts.push(o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S');
    this.ops.push(parts.join(' '));
  }

  /** Draw an image fitted into the box (keeps the aspect ratio, left-aligned). Returns the drawn size. */
  image(img: PdfImage, x: number, y: number, maxW: number, maxH: number): { width: number; height: number } {
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    let index = this.images.indexOf(img);
    if (index < 0) index = this.images.push(img) - 1;
    this.ops.push(`q ${f(w)} 0 0 ${f(h)} ${f(x)} ${f(this.height - y - h)} cm /Im${index} Do Q`);
    return { width: w, height: h };
  }

  toBuffer(meta: { title?: string; author?: string } = {}): Buffer {
    const objects: Array<string | Buffer> = [];
    const add = (body: string | Buffer): number => objects.push(body);
    const catalog = add('');
    const pagesObj = add('');
    const font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imageRefs = this.images.map((img) => {
      let smaskRef = '';
      if (img.smask) {
        const s = add(stream(img.smask.dict, img.smask.data));
        smaskRef = ` /SMask ${s} 0 R`;
      }
      return add(stream(img.dict + smaskRef, img.data));
    });
    const xobjects = imageRefs.length ? `/XObject << ${imageRefs.map((r, i) => `/Im${i} ${r} 0 R`).join(' ')} >>` : '';
    const resources = `<< /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> ${xobjects} >>`;
    const pageRefs = this.pages.map((ops) => {
      const content = add(stream('', deflateSync(Buffer.from(ops.join('\n'), 'latin1')), true));
      return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${f(this.width)} ${f(this.height)}] /Resources ${resources} /Contents ${content} 0 R >>`);
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;
    const info = add(`<< /Producer (Vistar) /Title (${escapePdf(meta.title ?? '')}) /Author (${escapePdf(meta.author ?? '')}) >>`);

    const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    let offset = chunks[0]!.length;
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(offset);
      const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
      const content = typeof body === 'string' ? Buffer.from(body, 'latin1') : body;
      const tail = Buffer.from('\nendobj\n', 'latin1');
      chunks.push(head, content, tail);
      offset += head.length + content.length + tail.length;
    });
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

function stream(dict: string, data: Buffer, flate = false): Buffer {
  const head = Buffer.from(`<< ${dict}${flate ? ' /Filter /FlateDecode' : ''} /Length ${data.length} >>\nstream\n`, 'latin1');
  return Buffer.concat([head, data, Buffer.from('\nendstream', 'latin1')]);
}
