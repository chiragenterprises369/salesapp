import { BRAND_TOKEN_KEYS, CHART_SLOTS, deriveBrandTokens, deriveChartPalette, type BrandTokens, type ChartPaletteTokens } from './brand-tokens';
import type { WorkspaceBranding } from './types';

export interface ResolvedBrandColors {
  light: Partial<BrandTokens & ChartPaletteTokens>;
  dark: Partial<BrandTokens & ChartPaletteTokens>;
}

/** Token overrides for a branding, or null when nothing differs from the Vistar defaults. */
export function resolveBrandColors(b: Pick<WorkspaceBranding, 'brandColor' | 'chartPalette'>): ResolvedBrandColors | null {
  if (!b.brandColor && !b.chartPalette) return null;
  const out: ResolvedBrandColors = { light: {}, dark: {} };
  if (b.brandColor) {
    const d = deriveBrandTokens(b.brandColor);
    Object.assign(out.light, d.light);
    Object.assign(out.dark, d.dark);
  }
  if (b.chartPalette?.colors?.length) {
    // "Brand first" follows the brand colour in slot 1.
    const colors = [...b.chartPalette.colors];
    if (b.chartPalette.preset === 'brand' && b.brandColor) colors[0] = b.brandColor;
    const p = deriveChartPalette(colors);
    Object.assign(out.light, p.light);
    Object.assign(out.dark, p.dark);
  }
  return out;
}

function block(selector: string, vars: Record<string, string | undefined>): string {
  const body = Object.entries(vars)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `--${k}:${v};`)
    .join('');
  return body ? `${selector}{${body}}` : '';
}

/**
 * CSS applied on <html data-brand>. Nested `[data-theme]` previews (style thumbnails) get the brand too.
 * Higher specificity than tokens.css, so it wins regardless of order.
 */
export function brandCss(colors: ResolvedBrandColors | null): string {
  if (!colors) return '';
  const keys = [...BRAND_TOKEN_KEYS, ...CHART_SLOTS] as const;
  const pick = (t: Partial<Record<string, string>>) => Object.fromEntries(keys.map((k) => [k, t[k]]));
  return [
    block("html[data-brand][data-theme='light'],html[data-brand] [data-theme='light']", pick(colors.light)),
    block("html[data-brand][data-theme='dark'],html[data-brand] [data-theme='dark']", pick(colors.dark)),
  ].join('');
}
