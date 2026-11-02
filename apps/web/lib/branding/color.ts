/**
 * Colour math for branding (SPEC 29.4, D-060). Pure and dependency-free.
 * sRGB <-> OKLab/OKLCH (Björn Ottosson), WCAG 2 relative luminance and contrast, gamut mapping by
 * chroma reduction. Lightness changes happen in OKLCH so the hue of the brand colour is kept.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v.trim());
}

/** Normalised `#RRGGBB` (upper case) or null. Accepts `#abc`, `abc`, `#aabbcc`. */
export function normalizeHex(v: string): string | null {
  const m = HEX_RE.exec(v.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return `#${h.toUpperCase()}`;
}

export function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex) ?? '#000000';
  return { r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (x: number) =>
    Math.round(clamp01(x) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: c < 1e-4 ? 0 : h };
}

/** OKLCH to sRGB without clamping (components may fall outside 0..1 when out of gamut). */
function oklchToRgbRaw({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = l - 0.0894841775 * A - 1.291485548 * B;
  const L3 = l_ ** 3;
  const M3 = m_ ** 3;
  const S3 = s_ ** 3;
  return {
    r: fromLinear(4.0767416621 * L3 - 3.3077115913 * M3 + 0.2309699292 * S3),
    g: fromLinear(-1.2684380046 * L3 + 2.6097574011 * M3 - 0.3413193965 * S3),
    b: fromLinear(-0.0041960863 * L3 - 0.7034186147 * M3 + 1.707614701 * S3),
  };
}

const inGamut = (c: Rgb) => [c.r, c.g, c.b].every((x) => Number.isFinite(x) && x >= -1e-4 && x <= 1 + 1e-4);

/** OKLCH to sRGB hex; out-of-gamut colours keep L and H and lose chroma until they fit. */
export function oklchToHex(color: Oklch): string {
  const l = clamp01(color.l);
  let rgb = oklchToRgbRaw({ ...color, l });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = color.c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRgbRaw({ l, c: mid, h: color.h }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToRgbRaw({ l, c: lo, h: color.h });
  }
  return rgbToHex(rgb);
}

export const hexToOklch = (hex: string) => rgbToOklch(hexToRgb(hex));

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2 contrast ratio (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Lowest contrast of `fg` against every background. */
export function minContrast(fg: string, backgrounds: readonly string[]): number {
  return Math.min(...backgrounds.map((bg) => contrast(fg, bg)));
}

/**
 * Move the OKLCH lightness of `hex` (darker or lighter) in small steps until it reaches `ratio`
 * against every background. Returns the first passing colour, or the extreme if none passes.
 */
export function adjustLightness(hex: string, backgrounds: readonly string[], ratio: number, direction: 'darker' | 'lighter'): string {
  const base = hexToOklch(hex);
  if (minContrast(normalizeHex(hex)!, backgrounds) >= ratio) return normalizeHex(hex)!;
  const step = direction === 'darker' ? -0.005 : 0.005;
  for (let l = base.l + step; l >= 0 && l <= 1; l += step) {
    const candidate = oklchToHex({ ...base, l });
    if (minContrast(candidate, backgrounds) >= ratio) return candidate;
  }
  return direction === 'darker' ? '#000000' : '#FFFFFF';
}

/** Same hue, new lightness and chroma (chroma capped by `maxChroma`). */
export function tone(hex: string, l: number, chromaFactor = 1, maxChroma = 0.4): string {
  const base = hexToOklch(hex);
  return oklchToHex({ l, c: Math.min(base.c * chromaFactor, maxChroma), h: base.h });
}

export function shiftLightness(hex: string, delta: number): string {
  const base = hexToOklch(hex);
  return oklchToHex({ ...base, l: clamp01(base.l + delta) });
}

/** `oklch(62.4% 0.21 277)` for display. */
export function formatOklch(hex: string): string {
  const { l, c, h } = hexToOklch(hex);
  return `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${Math.round(h)})`;
}
