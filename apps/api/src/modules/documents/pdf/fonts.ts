import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create, type Font } from 'fontkit';

/**
 * Embedded PDF fonts (D-071, change #20): Noto Sans for Latin text and the rupee sign, and one Noto Sans face per
 * Indian script for names and addresses in that script: Devanagari (Hindi, Marathi), Bengali, Gurmukhi (Punjabi),
 * Gujarati, Tamil, Telugu, Kannada and Malayalam, each in regular and bold (SIL OFL, `apps/api/assets/fonts`).
 * Text is split into runs by script, each run is shaped with fontkit (OpenType GSUB/GPOS, Indic reordering,
 * conjuncts, matras, reph) and the PDF writer embeds the shaped glyph ids. Script faces load on first use, so a
 * Latin-only invoice never reads the Indic font files.
 */

export type FontName = 'regular' | 'bold';
export const INDIC_SCRIPTS = ['devanagari', 'bengali', 'gurmukhi', 'gujarati', 'tamil', 'telugu', 'kannada', 'malayalam'] as const;
export type IndicScript = (typeof INDIC_SCRIPTS)[number];
export type FontScript = 'latin' | IndicScript;

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

const FILE_STEM: Record<FontScript, string> = {
  latin: 'NotoSans',
  devanagari: 'NotoSansDevanagari',
  bengali: 'NotoSansBengali',
  gurmukhi: 'NotoSansGurmukhi',
  gujarati: 'NotoSansGujarati',
  tamil: 'NotoSansTamil',
  telugu: 'NotoSansTelugu',
  kannada: 'NotoSansKannada',
  malayalam: 'NotoSansMalayalam',
};
const fileOf = (script: FontScript, style: FontName) => `${FILE_STEM[script]}-${style === 'bold' ? 'Bold' : 'Regular'}.ttf`;

/** Unicode blocks per script (main block plus the extensions the Noto faces cover). */
const SCRIPT_RANGES: Record<IndicScript, ReadonlyArray<readonly [number, number]>> = {
  devanagari: [
    [0x0900, 0x097f],
    [0xa8e0, 0xa8ff],
    [0x1cd0, 0x1cff],
  ],
  bengali: [[0x0980, 0x09ff]],
  gurmukhi: [[0x0a00, 0x0a7f]],
  gujarati: [[0x0a80, 0x0aff]],
  tamil: [
    [0x0b80, 0x0bff],
    [0x11fc0, 0x11fff],
  ],
  telugu: [[0x0c00, 0x0c7f]],
  kannada: [[0x0c80, 0x0cff]],
  malayalam: [[0x0d00, 0x0d7f]],
};

/** Danda and double danda (U+0964, U+0965) live in the Devanagari block but end sentences in most Indic scripts. */
const DANDA = new Set([0x0964, 0x0965]);

/** The Indic script of a code point, or null (Latin, digits, punctuation, other scripts). */
export function scriptOf(cp: number): IndicScript | null {
  if (DANDA.has(cp)) return null;
  for (const script of INDIC_SCRIPTS) for (const [lo, hi] of SCRIPT_RANGES[script]) if (cp >= lo && cp <= hi) return script;
  return null;
}

/**
 * Directory with the font files: env PDF_FONT_DIR, else `apps/api/assets/fonts`, found by walking up from this
 * file (works from `src` via tsx or vitest and from `dist`), else relative to the working directory.
 */
export function resolveFontDir(): string {
  const probe = fileOf('latin', 'regular');
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

let fontDir: string | null = null;
const loaded = new Map<string, FontFace>();

function loadFace(script: FontScript, style: FontName): FontFace {
  fontDir ??= resolveFontDir();
  const file = path.join(fontDir, fileOf(script, style));
  const font = create(readFileSync(file));
  if (!('layout' in font)) throw new Error(`PDF font ${file} is a font collection`);
  return { key: `${script}-${style}`, script, style, font, unitsPerEm: font.unitsPerEm };
}

/** One face, loaded once per process on first use (Latin about 0.6 MB, each Indic face 60 to 220 KB). */
export function faceFor(script: FontScript, style: FontName): FontFace {
  const key = `${script}-${style}`;
  let face = loaded.get(key);
  if (!face) {
    face = loadFace(script, style);
    loaded.set(key, face);
  }
  return face;
}

/** Every face (loads all of them). Tests and diagnostics. */
export function fontFaces(): Record<FontScript, Record<FontName, FontFace>> {
  const out = {} as Record<FontScript, Record<FontName, FontFace>>;
  for (const script of ['latin', ...INDIC_SCRIPTS] as FontScript[]) out[script] = { regular: faceFor(script, 'regular'), bold: faceFor(script, 'bold') };
  return out;
}

/** Faces to try for a character outside the Indic blocks: Latin first, then the Indic faces already loaded. */
function fallbackFaces(style: FontName): FontFace[] {
  const latin = faceFor('latin', style);
  const others = [...loaded.values()].filter((f) => f.style === style && f.script !== 'latin');
  // Devanagari stays the first Indic fallback (it was the only one before change #20)
  others.sort((a, b) => (a.script === 'devanagari' ? -1 : b.script === 'devanagari' ? 1 : 0));
  return [latin, ...others];
}

// ---------------------------------------------------------------- script segmentation

const MARK = /^\p{M}$/u;

/**
 * Characters that belong to no script of their own and stay in the surrounding run: white space, ASCII digits and
 * punctuation, ZWJ / ZWNJ, the dotted circle, the dandas and combining marks. Keeping them in the run avoids
 * switching fonts in the middle of "श्री राम (प्रा.) लि." and keeps shaping context.
 */
function isNeutral(cp: number, ch: string): boolean {
  if (cp === 0x20 || cp === 0xa0 || (cp >= 0x2000 && cp <= 0x200d) || cp === 0x202f || cp === 0x25cc || DANDA.has(cp)) return true;
  if (cp < 0x80 && !/[A-Za-z]/.test(ch)) return true;
  return MARK.test(ch);
}

const REPLACEMENT = '?';

/**
 * Normalise text for the PDF: NFC, tabs to spaces, other control characters removed, characters that no embedded
 * font can show become "?".
 */
export function pdfSafe(s: string, style: FontName = 'regular'): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    if (cp === 9) out += ' ';
    else if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) continue;
    else if (cp === 0x200c || cp === 0x200d) out += ch;
    else {
      const script = scriptOf(cp);
      const faces = script ? [faceFor(script, style)] : DANDA.has(cp) ? [faceFor('devanagari', style), ...fallbackFaces(style)] : fallbackFaces(style);
      out += faces.some((f) => f.font.hasGlyphForCodePoint(cp)) ? ch : REPLACEMENT;
    }
  }
  return out;
}

/** Split normalised text into runs that use one face each. */
export function splitRuns(text: string, style: FontName = 'regular'): Array<{ face: FontFace; text: string }> {
  const chars = Array.from(pdfSafe(text, style));
  const latin = faceFor('latin', style);
  const has = (face: FontFace, cp: number) => face.font.hasGlyphForCodePoint(cp) || cp === 0x200c || cp === 0x200d;
  const assigned: Array<FontFace | null> = chars.map((ch) => {
    const cp = ch.codePointAt(0)!;
    const script = scriptOf(cp);
    if (script) return faceFor(script, style);
    if (isNeutral(cp, ch)) return null;
    return fallbackFaces(style).find((f) => has(f, cp)) ?? latin;
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
    face ??= latin;
    const cp = chars[i]!.codePointAt(0)!;
    if (!has(face, cp)) face = [...(DANDA.has(cp) ? [faceFor('devanagari', style)] : []), ...fallbackFaces(style)].find((f) => has(f, cp)) ?? latin;
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

/** Virama (halant) of every supported Indic script: Devanagari, Bengali, Gurmukhi, Gujarati, Tamil pulli, Telugu, Kannada, Malayalam. */
const ENDS_WITH_VIRAMA = /[\u094d\u09cd\u0a4d\u0acd\u0bcd\u0c4d\u0ccd\u0d4d]$/;

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
    if (last && ENDS_WITH_VIRAMA.test(last)) out[out.length - 1] = last + segment;
    else out.push(segment);
  }
  return out;
}
