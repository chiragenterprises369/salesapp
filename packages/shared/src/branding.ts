/**
 * Brand colour contrast guard (D-060, SPEC 29.4). Pure functions shared by the API (stored values are
 * resolved on read) and the web (live preview in Settings).
 *
 * Rule: a brand or chart colour must reach 3:1 against the surface it is drawn on (WCAG 2.2 1.4.11 non-text
 * contrast: buttons, focus rings, chart marks, and 1.4.3 large text). Surfaces are the design-token
 * surfaces: light `#FFFFFF`, dark `#171A21`. Colours below 3:1 are ADJUSTED, never rejected: mixed towards
 * black (light surface) or white (dark surface) with the smallest step that reaches the target, so the hue
 * stays recognisable. The admin's chosen value is kept as `base`; UIs use `light` / `dark`.
 * Text on a brand-coloured fill uses `lightForeground` / `darkForeground` (#FFFFFF or #0F172A, whichever
 * contrasts more). Body text never uses brand colours.
 */

export const BRAND_CONTRAST_MIN = 3;
export const BRAND_SURFACES = { light: '#FFFFFF', dark: '#171A21' } as const;
const TEXT_ON_FILL = { white: '#FFFFFF', ink: '#0F172A' } as const;

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export interface ContrastResult {
  color: string;
  ratio: number;
  adjusted: boolean;
}

/**
 * Return `hex` if it reaches `min` against `background`, otherwise the closest mix towards black (light
 * backgrounds) or white (dark backgrounds) that does. Always reachable for min <= 15 on the token surfaces.
 */
export function ensureContrast(hex: string, background: string, min = BRAND_CONTRAST_MIN): ContrastResult {
  const color = toHex(parseHex(hex));
  const ratio = contrastRatio(color, background);
  if (ratio >= min) return { color, ratio, adjusted: false };
  const towards: Rgb = relativeLuminance(background) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  const base = parseHex(color);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(toHex(mix(base, towards, mid)), background) >= min) hi = mid;
    else lo = mid;
  }
  // Rounding to 8-bit channels can land just under the target: step until it passes.
  let t = hi;
  let out = toHex(mix(base, towards, t));
  while (contrastRatio(out, background) < min && t < 1) {
    t = Math.min(1, t + 0.01);
    out = toHex(mix(base, towards, t));
  }
  return { color: out, ratio: contrastRatio(out, background), adjusted: true };
}

/** Text colour for a fill: white or ink, whichever contrasts more. */
export function readableOn(fill: string): string {
  return contrastRatio(TEXT_ON_FILL.white, fill) >= contrastRatio(TEXT_ON_FILL.ink, fill) ? TEXT_ON_FILL.white : TEXT_ON_FILL.ink;
}

export interface ResolvedBrandColors {
  base: string;
  light: string;
  dark: string;
  lightForeground: string;
  darkForeground: string;
  adjusted: boolean;
}

/** Brand colour for both themes (see the rule at the top of this file). */
export function resolveBrandColors(base: string): ResolvedBrandColors {
  const light = ensureContrast(base, BRAND_SURFACES.light);
  const dark = ensureContrast(base, BRAND_SURFACES.dark);
  return {
    base: toHex(parseHex(base)),
    light: light.color,
    dark: dark.color,
    lightForeground: readableOn(light.color),
    darkForeground: readableOn(dark.color),
    adjusted: light.adjusted || dark.adjusted,
  };
}

export interface ResolvedChartPalette {
  base: string[];
  light: string[];
  dark: string[];
  /** Indexes (0-5) that were adjusted for at least one theme. */
  adjusted: number[];
}

export function resolveChartPalette(base: readonly string[]): ResolvedChartPalette {
  const light = base.map((c) => ensureContrast(c, BRAND_SURFACES.light));
  const dark = base.map((c) => ensureContrast(c, BRAND_SURFACES.dark));
  return {
    base: base.map((c) => toHex(parseHex(c))),
    light: light.map((r) => r.color),
    dark: dark.map((r) => r.color),
    adjusted: base.flatMap((_, i) => (light[i]!.adjusted || dark[i]!.adjusted ? [i] : [])),
  };
}
