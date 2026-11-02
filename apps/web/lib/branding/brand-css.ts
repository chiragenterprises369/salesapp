import { BRAND_TOKEN_KEYS, CHART_SLOTS, deriveBrandTokens, deriveChartPalette, type BrandTokens, type ChartPaletteTokens } from './brand-tokens';
import type { BrandingDraft } from './types';

export interface ResolvedBrandTokens {
  light: Partial<BrandTokens & ChartPaletteTokens>;
  dark: Partial<BrandTokens & ChartPaletteTokens>;
}

/**
 * Accent and chart token overrides for a branding, or null when nothing differs from the Vistar
 * defaults. The web derives the whole accent family in OKLCH with AA checks (brand-tokens.ts); this is
 * stricter than the shared 3:1 guard (`branding.colors`), which the Android app uses.
 */
export function resolveBrandTokens(b: Pick<BrandingDraft, 'brandColor' | 'chartPalette'>): ResolvedBrandTokens | null {
  if (!b.brandColor && !b.chartPalette) return null;
  const out: ResolvedBrandTokens = { light: {}, dark: {} };
  if (b.brandColor) {
    const d = deriveBrandTokens(b.brandColor);
    Object.assign(out.light, d.light);
    Object.assign(out.dark, d.dark);
  }
  if (b.chartPalette?.length) {
    const p = deriveChartPalette(b.chartPalette);
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
export function brandCss(colors: ResolvedBrandTokens | null): string {
  if (!colors) return '';
  const keys = [...BRAND_TOKEN_KEYS, ...CHART_SLOTS] as const;
  const pick = (t: Partial<Record<string, string>>) => Object.fromEntries(keys.map((k) => [k, t[k]]));
  return [
    block("html[data-brand][data-theme='light'],html[data-brand] [data-theme='light']", pick(colors.light)),
    block("html[data-brand][data-theme='dark'],html[data-brand] [data-theme='dark']", pick(colors.dark)),
  ].join('');
}
