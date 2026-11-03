import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create, type Font } from 'fontkit';

/**
 * Embedded PDF fonts (D-071): Noto Sans for Latin text and the rupee sign, Noto Sans Devanagari for Hindi,
 * Marathi and other Devanagari names, both in regular and bold (SIL OFL, `apps/api/assets/fonts`).
 * Text is split into runs by script, each run is shaped with fontkit (OpenType GSUB/GPOS, Indic reordering,
 * conjuncts, matras, reph) and the PDF writer embeds the shaped glyph ids.
 */

export type FontName = 'regular' | 'bold';
export type FontScript = 'latin' | 'devanagari';

export interface FontFace {
  /** Stable key, e.g. `devanagari-bold`. */
  key: string;
  script: FontScript;
  style: FontName;
  font: Font;
  unitsPerEm: number;
}

/** One glyph after shaping, in font units. `id` is the glyph id in the full (not subset) font. */
export interface ShapedGlyph {
  id: number;
  codePoints: number[];
  xAdvance: number;
  xOffset: number;
  yOffset: number;
}

export interface ShapedRun {
  face: FontFace;
  /** The text of the run (after normalisation), used for ActualText. */
  text: string;
  glyphs: ShapedGlyph[];
  /** Sum of the advances in font units. */
  advance: number;
}

const FILES: Record<FontScript, Record<FontName, string>> = {
  latin: { regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf' },
  devanagari: { regular: 'NotoSansDevanagari-Regular.ttf', bold: 'NotoSansDevanagari-Bold.ttf' },
};

/** Fallback order per style: the Latin face first, then the script faces. */
const CHAIN: FontScript[] = ['latin', 'devanagari'];

/**
 * Directory with the font files: env PDF_FONT_DIR, else `apps/api/assets/fonts`, found by walking up from this
 * file (works from `src` via tsx or vitest and from `dist`), else relative to the working directory.
 */
export function resolveFontDir(): string {
  const probe = FILES.latin.regular;
  if (process.env.PDF_FONT_DIR) return path.resolve(process.env.PDF_FONT_DIR);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'assets', 'fonts');
    if (existsSync(path.join(candidate, probe))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const candidate of [path.resolve('assets/fonts'), path.resolve('apps/api/assets/fonts')]) {
    if (existsSync(path.join(candidate, probe))) return candidate;
  }
  throw new Error(`PDF fonts not found: expected ${probe} in apps/api/assets/fonts or PDF_FONT_DIR`);
}

let faces: Record<FontScript, Record<FontName, FontFace>> | null = null;

function loadFace(dir: string, script: FontScript, style: FontName): FontFace {
  const file = path.join(dir, FILES[script][style]);
  const font = create(readFileSync(file));
  if (!('layout' in font)) throw new Error(`PDF font ${file} is a font collection`);
  return { key: `${script}-${style}`, script, style, font, unitsPerEm: font.unitsPerEm };
}

/** All faces, loaded once per process (about 1.7 MB of font data). */
export function fontFaces(): Record<FontScript, Record<FontName, FontFace>> {
  if (!faces) {
    const dir = resolveFontDir();
    faces = {
      latin: { regular: loadFace(dir, 'latin', 'regular'), bold: loadFace(dir, 'latin', 'bold') },
      devanagari: { regular: loadFace(dir, 'devanagari', 'regular'), bold: loadFace(dir, 'devanagari', 'bold') },
    };
  }
  return faces;
}

// ---------------------------------------------------------------- script segmentation

/** Devanagari, Devanagari Extended, Vedic Extensions. */
const isDevanagari = (cp: number) => (cp >= 0x0900 && cp <= 0x097f) || (cp >= 0xa8e0 && cp <= 0xa8ff) || (cp >= 0x1cd0 && cp <= 0x1cff);

const MARK = /^\p{M}$/u;

/**
 * Characters that belong to no script of their own and stay in the surrounding run: white space, ASCII digits and
 * punctuation, ZWJ / ZWNJ, the dotted circle and combining marks. Keeping them in the run avoids switching fonts
 * in the middle of "श्री राम (प्रा.) लि." and keeps shaping context.
 */
function isNeutral(cp: number, ch: string): boolean {
  if (cp === 0x20 || cp === 0xa0 || (cp >= 0x2000 && cp <= 0x200d) || cp === 0x202f || cp === 0x25cc) return true;
  if (cp < 0x80 && !/[A-Za-z]/.test(ch)) return true;
  return MARK.test(ch);
}

const REPLACEMENT = '?';

/**
 * Normalise text for the PDF: NFC, tabs to spaces, other control characters removed, characters that no embedded
 * font can show become "?".
 */
export function pdfSafe(s: string, style: FontName = 'regular'): string {
  const all = fontFaces();
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    if (cp === 9) out += ' ';
    else if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) continue;
    else if (cp === 0x200c || cp === 0x200d) out += ch;
    else out += CHAIN.some((script) => all[script][style].font.hasGlyphForCodePoint(cp)) ? ch : REPLACEMENT;
  }
  return out;
}

/** Split normalised text into runs that use one face each. */
export function splitRuns(text: string, style: FontName = 'regular'): Array<{ face: FontFace; text: string }> {
  const all = fontFaces();
  const chars = Array.from(pdfSafe(text, style));
  const has = (face: FontFace, cp: number) => face.font.hasGlyphForCodePoint(cp) || cp === 0x200c || cp === 0x200d;
  const assigned: Array<FontFace | null> = chars.map((ch) => {
    const cp = ch.codePointAt(0)!;
    if (isDevanagari(cp)) return all.devanagari[style];
    if (isNeutral(cp, ch)) return null;
    for (const script of CHAIN) if (has(all[script][style], cp)) return all[script][style];
    return all.latin[style];
  });
  // neutral characters take the face before them, at the start the face after them, else Latin
  let prev: FontFace | null = null;
  for (let i = 0; i < assigned.length; i++) {
    if (assigned[i]) {
      prev = assigned[i]!;
      continue;
    }
    let face = prev;
    if (!face) for (let j = i + 1; j < assigned.length && !face; j++) face = assigned[j] ?? null;
    face ??= all.latin[style];
    const cp = chars[i]!.codePointAt(0)!;
    if (!has(face, cp)) face = CHAIN.map((script) => all[script][style]).find((f) => has(f, cp)) ?? all.latin[style];
    assigned[i] = face;
  }
  const runs: Array<{ face: FontFace; text: string }> = [];
  chars.forEach((ch, i) => {
    const face = assigned[i]!;
    const last = runs[runs.length - 1];
    if (last && last.face === face) last.text += ch;
    else runs.push({ face, text: ch });
  });
  return runs;
}

// ---------------------------------------------------------------- shaping

const cache = new Map<string, ShapedRun>();
const CACHE_LIMIT = 5000;

/** Shape one run with its face (cached: wrapping measures the same strings many times). */
export function shapeRun(face: FontFace, text: string): ShapedRun {
  const key = `${face.key}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const layout = face.font.layout(text);
  const glyphs = layout.glyphs.map((g, i) => {
    const p = layout.positions[i]!;
    return { id: g.id, codePoints: [...g.codePoints], xAdvance: p.xAdvance, xOffset: p.xOffset, yOffset: p.yOffset };
  });
  const run: ShapedRun = { face, text, glyphs, advance: glyphs.reduce((sum, g) => sum + g.xAdvance, 0) };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, run);
  return run;
}

/** Split by script and shape each run. */
export function shapeText(text: string, style: FontName = 'regular'): ShapedRun[] {
  return splitRuns(text, style).map((r) => shapeRun(r.face, r.text));
}

/** Width in points of the shaped text at the given size. */
export function measure(text: string, size: number, style: FontName = 'regular'): number {
  let w = 0;
  for (const run of shapeText(text, style)) w += (run.advance * size) / run.face.unitsPerEm;
  return w;
}

// ---------------------------------------------------------------- clusters

let segmenter: Intl.Segmenter | null | undefined;

/**
 * Grapheme clusters (with the Unicode 15.1 Indic conjunct rule where the ICU data has it), so a long word is never
 * split inside a conjunct or between a consonant and its matra. Falls back to code points.
 */
export function clusters(s: string): string[] {
  if (segmenter === undefined) {
    try {
      segmenter = new Intl.Segmenter('hi', { granularity: 'grapheme' });
    } catch {
      segmenter = null;
    }
  }
  if (!segmenter) return Array.from(s);
  const out: string[] = [];
  for (const { segment } of segmenter.segment(s)) {
    // older ICU splits after a virama: keep "consonant + virama" with the next cluster
    const last = out[out.length - 1];
    if (last && /\u094d$/.test(last)) out[out.length - 1] = last + segment;
    else out.push(segment);
  }
  return out;
}
