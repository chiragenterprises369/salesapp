import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { type Subset } from 'fontkit';
import { clusters, measure, shapeText, type FontFace, type FontName, type ShapedRun } from './fonts.js';

/**
 * Minimal PDF 1.4 writer (D-068: no headless browser). Enough for A4 business documents: embedded, subset TrueType
 * fonts (D-071: Noto Sans and Noto Sans Devanagari as Type0 / CIDFontType2 with Identity-H, glyph ids from fontkit
 * shaping, a ToUnicode CMap and ActualText spans so text copies out correctly), text with measured widths, lines,
 * rectangles, and JPEG or PNG images (8-bit, non-interlaced; PNG alpha becomes a soft mask). Coordinates are in
 * points with the origin at the TOP-left of the page.
 */

export const A4 = { width: 595.28, height: 841.89 } as const;
export type Rgb = readonly [number, number, number];
export type { FontName } from './fonts.js';
export { pdfSafe } from './fonts.js';

/** Width in points of the text at the given size (shaped, with kerning). */
export function textWidth(s: string, size: number, font: FontName = 'regular'): number {
  return measure(s, size, font);
}

/** Greedy word wrap; words longer than the width are split between grapheme clusters (never inside a conjunct). */
export function wrapText(s: string, maxWidth: number, size: number, font: FontName = 'regular'): string[] {
  const lines: string[] = [];
  for (const para of s.normalize('NFC').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, font) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = clusters(word);
      while (rest.length > 1 && textWidth(rest.join(''), size, font) > maxWidth) {
        let n = rest.length - 1;
        while (n > 1 && textWidth(rest.slice(0, n).join(''), size, font) > maxWidth) n--;
        lines.push(rest.slice(0, n).join(''));
        rest = rest.slice(n);
      }
      line = rest.join('');
    }
    lines.push(line);
  }
  return lines;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();
const rgb = (c: Rgb) => c.map((v) => f(v / 255)).join(' ');
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

/** UTF-16BE hex of a string (surrogate pairs for code points above U+FFFF). */
const utf16Hex = (s: string) => {
  let out = '';
  for (let i = 0; i < s.length; i++) out += hex4(s.charCodeAt(i));
  return out;
};

/** A PDF text string: a literal for printable ASCII, else UTF-16BE with a byte order mark. */
export function pdfTextString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
  return `<FEFF${utf16Hex(s)}>`;
}

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

// ---------------------------------------------------------------- embedded fonts

/**
 * One face used in one document: the fontkit subset (glyph ids are renumbered densely from 0 = .notdef), the
 * widths in 1/1000 em per subset id and the text each subset glyph stands for (ToUnicode).
 */
export class EmbeddedFont {
  readonly subset: Subset;
  /** subset glyph id -> original glyph id */
  readonly glyphIds: number[] = [];
  readonly toUnicode = new Map<number, string>();

  constructor(
    readonly face: FontFace,
    readonly resourceName: string,
  ) {
    this.subset = face.font.createSubset();
    this.glyphIds.push(0);
  }

  /** Subset id of an original glyph id (added on first use; the mapping text is kept from the first use). */
  cid(glyphId: number, codePoints: number[]): number {
    // fontkit's TTFSubset.includeGlyph returns the new id (the typings say boolean)
    const id = this.subset.includeGlyph(glyphId as never) as unknown as number;
    this.glyphIds[id] = glyphId;
    if (codePoints.length && !this.toUnicode.has(id)) this.toUnicode.set(id, String.fromCodePoint(...codePoints));
    return id;
  }

  /** Advance width in 1/1000 em, rounded like the /W array. */
  width(glyphId: number): number {
    return Math.round((this.face.font.getGlyph(glyphId).advanceWidth * 1000) / this.face.unitsPerEm);
  }
}

function toUnicodeCMap(map: Map<number, string>): string {
  const entries = [...map.entries()].sort((a, b) => a[0] - b[0]);
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfchar\n${chunk.map(([cid, text]) => `<${hex4(cid)}> <${utf16Hex(text)}>`).join('\n')}\nendbfchar`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

/** The text the glyphs stand for, in drawing order (what a reader gets from the ToUnicode map alone). */
export const visualText = (run: ShapedRun): string => run.glyphs.map((g) => String.fromCodePoint(...g.codePoints)).join('');

/** Six capital letters from the face and its glyph set (deterministic output for the same document). */
function subsetTag(name: string, glyphIds: number[]): string {
  const digest = createHash('sha1').update(`${name}:${glyphIds.join(',')}`).digest();
  return Array.from(digest.subarray(0, 6), (b) => String.fromCharCode(65 + (b % 26))).join('');
}

// ---------------------------------------------------------------- document

export class PdfDocument {
  private readonly pages: string[][] = [];
  private readonly images: PdfImage[] = [];
  private readonly fonts = new Map<string, EmbeddedFont>();
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

  private embedded(face: FontFace): EmbeddedFont {
    let font = this.fonts.get(face.key);
    if (!font) {
      font = new EmbeddedFont(face, `F${this.fonts.size + 1}`);
      this.fonts.set(face.key, font);
    }
    return font;
  }

  /**
   * Content stream operators for one shaped run starting at (x, baseline) in PDF coordinates. Glyphs are written
   * as 2-byte subset ids in TJ arrays; a kerning or shaping advance that differs from the glyph width becomes a TJ
   * adjustment, and a glyph with a GPOS offset (marks) gets its own text matrix.
   */
  private runOps(run: ShapedRun, x: number, baseline: number, size: number, color: Rgb): string {
    const font = this.embedded(run.face);
    const scale = size / run.face.unitsPerEm;
    const per1000 = 1000 / run.face.unitsPerEm;
    const out: string[] = [];
    let pen = x;
    let items: string[] = [];
    let hexRun = '';
    const flushHex = () => {
      if (hexRun) items.push(`<${hexRun}>`);
      hexRun = '';
    };
    const flush = () => {
      flushHex();
      if (items.length) out.push(`[${items.join(' ')}] TJ`);
      items = [];
    };
    let open = false;
    for (const g of run.glyphs) {
      const cid = font.cid(g.id, g.codePoints);
      if (g.xOffset || g.yOffset) {
        flush();
        out.push(`1 0 0 1 ${f(pen + g.xOffset * scale)} ${f(baseline + g.yOffset * scale)} Tm <${hex4(cid)}> Tj`);
        pen += g.xAdvance * scale;
        open = false;
        continue;
      }
      if (!open) {
        flush();
        out.push(`1 0 0 1 ${f(pen)} ${f(baseline)} Tm`);
        open = true;
      }
      hexRun += hex4(cid);
      const adjust = font.width(g.id) - g.xAdvance * per1000;
      if (Math.abs(adjust) >= 0.01) {
        flushHex();
        items.push(f(adjust));
      }
      pen += g.xAdvance * scale;
    }
    flush();
    const body = `BT /${font.resourceName} ${f(size)} Tf ${rgb(color)} rg ${out.join(' ')} ET`;
    // ActualText gives the logical text back when shaping reordered glyphs (the Devanagari i-matra is drawn before
    // its consonant, the reph after the cluster) or inserted one (dotted circle); ligatures alone need no span
    return visualText(run) === run.text ? body : `/Span << /ActualText <FEFF${utf16Hex(run.text)}> >> BDC ${body} EMC`;
  }

  text(x: number, y: number, s: string, o: { size?: number; font?: FontName; color?: Rgb; align?: 'left' | 'right' | 'center' } = {}): void {
    const size = o.size ?? 9;
    const style = o.font ?? 'regular';
    const runs = shapeText(s, style);
    if (!runs.length) return;
    const w = runs.reduce((sum, r) => sum + (r.advance * size) / r.face.unitsPerEm, 0);
    let pen = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    const baseline = this.height - y;
    for (const run of runs) {
      this.ops.push(this.runOps(run, pen, baseline, size, o.color ?? [17, 24, 39]));
      pen += (run.advance * size) / run.face.unitsPerEm;
    }
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

  /** Fonts used so far (face key -> embedded font), for tests. */
  get embeddedFonts(): ReadonlyMap<string, EmbeddedFont> {
    return this.fonts;
  }

  toBuffer(meta: { title?: string; author?: string } = {}): Buffer {
    const objects: Array<string | Buffer> = [];
    const add = (body: string | Buffer): number => objects.push(body);
    const catalog = add('');
    const pagesObj = add('');
    const fontRefs = [...this.fonts.values()].map((font) => {
      const raw = Buffer.from(font.subset.encode());
      // encode() may append glyphs (components of composite glyphs); widths cover every subset id
      const ids = (font.subset as unknown as { glyphs: number[] }).glyphs ?? font.glyphIds;
      const name = `${subsetTag(font.face.font.postscriptName, ids)}+${font.face.font.postscriptName}`;
      const k = 1000 / font.face.unitsPerEm;
      const { bbox, ascent, descent, capHeight, italicAngle } = font.face.font;
      const file = add(stream(`/Length1 ${raw.length}`, deflateSync(raw), true));
      const descriptor = add(
        `<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${[bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].map((v) => Math.round(v * k)).join(' ')}] /ItalicAngle ${f(italicAngle)} /Ascent ${Math.round(ascent * k)} /Descent ${Math.round(descent * k)} /CapHeight ${Math.round((capHeight || ascent) * k)} /StemV 80 /FontFile2 ${file} 0 R >>`,
      );
      const widths = ids.map((gid) => font.width(gid)).join(' ');
      const cidFont = add(
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /W [0 [${widths}]] /CIDToGIDMap /Identity >>`,
      );
      const cmap = add(stream('', deflateSync(Buffer.from(toUnicodeCMap(font.toUnicode), 'latin1')), true));
      return { resourceName: font.resourceName, ref: add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${cmap} 0 R >>`) };
    });
    const imageRefs = this.images.map((img) => {
      let smaskRef = '';
      if (img.smask) {
        const s = add(stream(img.smask.dict, img.smask.data));
        smaskRef = ` /SMask ${s} 0 R`;
      }
      return add(stream(img.dict + smaskRef, img.data));
    });
    const xobjects = imageRefs.length ? `/XObject << ${imageRefs.map((r, i) => `/Im${i} ${r} 0 R`).join(' ')} >>` : '';
    const resources = `<< /Font << ${fontRefs.map((r) => `/${r.resourceName} ${r.ref} 0 R`).join(' ')} >> ${xobjects} >>`;
    const pageRefs = this.pages.map((ops) => {
      const content = add(stream('', deflateSync(Buffer.from(ops.join('\n'), 'latin1')), true));
      return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${f(this.width)} ${f(this.height)}] /Resources ${resources} /Contents ${content} 0 R >>`);
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;
    const info = add(`<< /Producer (Vistar) /Title ${pdfTextString(meta.title ?? '')} /Author ${pdfTextString(meta.author ?? '')} >>`);

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
