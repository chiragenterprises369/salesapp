import type { LeadSource } from '@vistar/shared';

/**
 * Colours for the celebrations canvas. Everything comes from CSS tokens on the page (the stage
 * colour `--vb-stage` on each column, status and accent tokens), converted to RGB once and cached,
 * so the layer follows the theme and the board skin without its own colour values.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type BoardSkinName = 'flat' | 'depth' | 'neon';

/** How the canvas paints on the current theme and skin. */
export interface PaintStyle {
  dark: boolean;
  skin: BoardSkinName;
  /** Additive light ("lighter") on dark backgrounds; normal paint on light ones. */
  additive: boolean;
  /** Soft halos around light (dropped first by the quality budget; never on light themes). */
  glow: boolean;
  /** Glow alpha cap (token --glow-alpha-max). */
  glowAlpha: number;
}

const cache = new Map<string, RGB>();
let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour (hex, rgb, oklch, color-mix) to sRGB bytes, via a 1x1 canvas. */
export function toRgb(css: string, fallback: RGB = { r: 99, g: 102, b: 241 }): RGB {
  const key = css.trim();
  if (!key) return fallback;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!probe) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    probe = c.getContext('2d', { willReadFrequently: true });
  }
  if (!probe) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = key;
  probe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = probe.getImageData(0, 0, 1, 1).data;
  const out = a === 0 ? fallback : { r, g, b };
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

export function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export const rgba = (c: RGB, a: number) => `rgba(${c.r},${c.g},${c.b},${Math.max(0, Math.min(1, a))})`;

/** Mix toward white (0..1). */
export function lighten(c: RGB, t: number): RGB {
  return { r: Math.round(c.r + (255 - c.r) * t), g: Math.round(c.g + (255 - c.g) * t), b: Math.round(c.b + (255 - c.b) * t) };
}

/** Push a colour toward full saturation at the same hue (neon edges). */
export function saturate(c: RGB, t: number): RGB {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  if (max === min) return c;
  const f = (v: number) => Math.round(v + (((v - min) / (max - min)) * max - v) * t);
  return { r: f(c.r), g: f(c.g), b: f(c.b) };
}

/** Lead source -> status tone token (ribbon colour of a new lead). */
const SOURCE_TOKEN: Record<LeadSource, string> = {
  indiamart: '--status-amber-fg',
  whatsapp: '--status-green-fg',
  website: '--status-blue-fg',
  manual: '--status-indigo-fg',
  webhook: '--status-indigo-fg',
  api: '--status-indigo-fg',
  import: '--status-grey-fg',
};

/** Stage colour of a column (its own colour or the soft tone), tuned for the paint style. */
export function stageColor(column: Element | null, style: PaintStyle): RGB {
  const raw = column ? cssVar(column, '--vb-stage') : '';
  return tune(toRgb(raw || cssVar(document.documentElement, '--accent')), style);
}

export function sourceColor(source: LeadSource, style: PaintStyle): RGB {
  const root = document.documentElement;
  return tune(toRgb(cssVar(root, SOURCE_TOKEN[source] ?? '--accent') || cssVar(root, '--accent')), style);
}

export function tokenColor(name: string, style: PaintStyle): RGB {
  return tune(toRgb(cssVar(document.documentElement, name)), style);
}

/** Neon on dark: saturated light. Depth on dark: the token as is. Light themes: the token as is (already dark enough). */
function tune(c: RGB, style: PaintStyle): RGB {
  if (!style.dark) return c;
  return style.skin === 'neon' ? lighten(saturate(c, 0.55), 0.08) : c;
}

/** Background colour of an element (card face), for shards. */
export function surfaceColor(el: Element | null, style: PaintStyle): RGB {
  const fallback = toRgb(cssVar(document.documentElement, '--surface'), style.dark ? { r: 23, g: 26, b: 33 } : { r: 255, g: 255, b: 255 });
  if (!el) return fallback;
  const bg = getComputedStyle(el).backgroundColor;
  if (!bg || bg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(bg)) return fallback;
  return toRgb(bg, fallback);
}
