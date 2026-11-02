import { palettes } from '@vistar/shared';
import { adjustLightness, contrast, hexToOklch, minContrast, normalizeHex, oklchToHex, shiftLightness, tone } from './color';

/**
 * Brand colour -> accent tokens for both themes (D-060). Every derived colour is checked against the
 * surfaces it is used on and moved in OKLCH lightness until it passes WCAG AA:
 *   accent        button fill under white text            >= 4.5:1 with accent-fg
 *   accent-text   links and active labels on bg/surfaces  >= 4.5:1
 *   accent-soft-fg selected rows and chips on accent-soft >= 4.5:1
 *   ring          focus outline on bg/surfaces            >= 3:1
 */

export const BRAND_TOKEN_KEYS = ['accent', 'accent-hover', 'accent-active', 'accent-fg', 'accent-soft', 'accent-soft-fg', 'accent-text', 'ring'] as const;
export type BrandTokenKey = (typeof BRAND_TOKEN_KEYS)[number];
export type BrandTokens = Record<BrandTokenKey, string>;

export interface ContrastCheck {
  theme: 'light' | 'dark';
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  required: number;
  pass: boolean;
}

export interface BrandDerivation {
  input: string;
  light: BrandTokens;
  dark: BrandTokens;
  checks: ContrastCheck[];
  /** True when the accent had to change lightness so white button text passes AA. */
  adjusted: boolean;
  /** OKLCH lightness of the input and of the button colour, 0..100. */
  inputLightness: number;
  accentLightness: number;
}

const L = palettes.light;
const D = palettes.dark;
const WHITE = '#FFFFFF';
const LIGHT_BACKGROUNDS = [L.bg, L.surface, L['surface-2']];
const DARK_BACKGROUNDS = [D.bg, D.surface, D['surface-2'], D['surface-3']];

/** Default Vistar accent (indigo), used when no brand colour is set. */
export const DEFAULT_BRAND_COLOR = '#4F46E5';

function check(theme: 'light' | 'dark', label: string, fg: string, bg: string, required: number): ContrastCheck {
  const ratio = contrast(fg, bg);
  return { theme, label, fg, bg, ratio, required, pass: ratio >= required - 1e-9 };
}

export function deriveBrandTokens(input: string): BrandDerivation {
  const brand = normalizeHex(input) ?? DEFAULT_BRAND_COLOR;
  const base = hexToOklch(brand);

  // Button fill: white text needs 4.5:1. Same fill in both themes (as the shipped indigo).
  const accent = adjustLightness(brand, [WHITE], 4.5, 'darker');
  const accentL = hexToOklch(accent).l;
  const hoverLight = adjustLightness(shiftLightness(accent, -0.05), [WHITE], 4.5, 'darker');
  const activeLight = adjustLightness(shiftLightness(accent, -0.1), [WHITE], 4.5, 'darker');
  // Dark hover lightens a little (as #5850EC) but keeps white text readable.
  const hoverDark = adjustLightness(shiftLightness(accent, 0.03), [WHITE], 4.5, 'darker');

  // Light theme.
  const textLight = adjustLightness(accent, LIGHT_BACKGROUNDS, 4.5, 'darker');
  const softLight = oklchToHex({ l: 0.962, c: Math.min(base.c * 0.25, 0.035), h: base.h });
  const softFgLight = adjustLightness(tone(brand, Math.min(accentL, 0.5), 1, 0.2), [softLight, L.surface], 4.5, 'darker');
  const ringLight = adjustLightness(accent, LIGHT_BACKGROUNDS, 3, 'darker');

  // Dark theme: text and ring lighten until they read on the dark surfaces.
  const textDark = adjustLightness(tone(brand, Math.max(base.l, 0.7), 0.85, 0.2), DARK_BACKGROUNDS, 4.5, 'lighter');
  const softDark = oklchToHex({ l: 0.29, c: Math.min(base.c * 0.45, 0.085), h: base.h });
  const softFgDark = adjustLightness(tone(brand, 0.88, 0.45, 0.09), [softDark, D.surface], 4.5, 'lighter');
  const ringDark = adjustLightness(textDark, DARK_BACKGROUNDS, 3, 'lighter');

  const light: BrandTokens = {
    accent,
    'accent-hover': hoverLight,
    'accent-active': activeLight,
    'accent-fg': WHITE,
    'accent-soft': softLight,
    'accent-soft-fg': softFgLight,
    'accent-text': textLight,
    ring: ringLight,
  };
  const dark: BrandTokens = {
    accent,
    'accent-hover': hoverDark,
    'accent-active': activeLight,
    'accent-fg': WHITE,
    'accent-soft': softDark,
    'accent-soft-fg': softFgDark,
    'accent-text': textDark,
    ring: ringDark,
  };

  const checks: ContrastCheck[] = [
    check('light', 'Button text', WHITE, accent, 4.5),
    check('light', 'Button text on hover', WHITE, hoverLight, 4.5),
    check('light', 'Links on the page background', textLight, L.bg, 4.5),
    check('light', 'Selected item text', softFgLight, softLight, 4.5),
    check('light', 'Focus ring', ringLight, L.bg, 3),
    check('dark', 'Button text', WHITE, accent, 4.5),
    check('dark', 'Button text on hover', WHITE, hoverDark, 4.5),
    check('dark', 'Links on cards', textDark, D['surface-2'], 4.5),
    check('dark', 'Selected item text', softFgDark, softDark, 4.5),
    check('dark', 'Focus ring', ringDark, D.surface, 3),
  ];

  return {
    input: brand,
    light,
    dark,
    checks,
    adjusted: accent !== brand,
    inputLightness: base.l * 100,
    accentLightness: accentL * 100,
  };
}

// ---------------------------------------------------------------- chart palettes

export const CHART_SLOTS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'] as const;
export type ChartSlot = (typeof CHART_SLOTS)[number];

export interface ChartPalettePreset {
  id: string;
  label: string;
  hint: string;
  colors: readonly [string, string, string, string, string, string];
}

/** Six-colour series palettes. Colours are the light-theme intent; both themes are derived. */
export const CHART_PALETTE_PRESETS: readonly ChartPalettePreset[] = [
  { id: 'vistar', label: 'Vistar', hint: 'The default series colours', colors: [L['chart-1'], L['chart-2'], L['chart-3'], L['chart-4'], L['chart-5'], L['chart-6']] },
  { id: 'brand', label: 'Brand first', hint: 'Your brand colour leads the series', colors: [DEFAULT_BRAND_COLOR, '#0284C7', '#059669', '#D97706', '#E11D48', '#64748B'] },
  { id: 'ocean', label: 'Ocean', hint: 'Blues and teals', colors: ['#0369A1', '#0891B2', '#0D9488', '#2563EB', '#7C3AED', '#475569'] },
  { id: 'sunset', label: 'Sunset', hint: 'Warm oranges and reds', colors: ['#C2410C', '#D97706', '#BE123C', '#9333EA', '#0F766E', '#57534E'] },
  { id: 'forest', label: 'Forest', hint: 'Greens and earth tones', colors: ['#15803D', '#4D7C0F', '#0F766E', '#A16207', '#9A3412', '#52525B'] },
  // Okabe-Ito: distinguishable with protanopia, deuteranopia and tritanopia.
  { id: 'colorblind', label: 'Colour-blind safe', hint: 'Okabe-Ito colours, readable for every type of colour blindness', colors: ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9'] },
];

export type ChartPaletteTokens = Record<ChartSlot, string>;

/** Graphical objects need 3:1 against the card surface (WCAG 1.4.11); move lightness until they pass. */
export function deriveChartPalette(colors: readonly string[]): { light: ChartPaletteTokens; dark: ChartPaletteTokens } {
  const light = {} as ChartPaletteTokens;
  const dark = {} as ChartPaletteTokens;
  CHART_SLOTS.forEach((slot, i) => {
    const c = normalizeHex(colors[i] ?? '') ?? L[slot];
    light[slot] = adjustLightness(c, [L.surface], 3, 'darker');
    const o = hexToOklch(c);
    // Dark: start from a lighter tone of the same hue (as the shipped dark chart colours).
    const darkStart = oklchToHex({ l: Math.max(o.l, 0.72), c: Math.min(o.c, 0.17), h: o.h });
    dark[slot] = adjustLightness(darkStart, [D.surface], 3, 'lighter');
  });
  return { light, dark };
}

/** Lowest series-to-surface contrast in each theme, for the live check. */
export function chartContrast(p: { light: ChartPaletteTokens; dark: ChartPaletteTokens }) {
  return {
    light: Math.min(...CHART_SLOTS.map((s) => minContrast(p.light[s], [L.surface]))),
    dark: Math.min(...CHART_SLOTS.map((s) => minContrast(p.dark[s], [D.surface]))),
  };
}
