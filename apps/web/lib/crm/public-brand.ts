import type { WorkspaceBranding } from '@vistar/shared';
import { resolveBrandTokens } from '../branding/brand-css';

/**
 * Brand accent for the public pages (hosted form, shared document), scoped to `[data-hosted]` so the
 * signed-in shell branding is not touched. Same derivation (AA-checked accent family) as the app.
 */
export function hostedBrandCss(branding: Pick<WorkspaceBranding, 'brandColor'> | null | undefined): string {
  if (!branding?.brandColor) return '';
  const t = resolveBrandTokens({ brandColor: branding.brandColor, chartPalette: null });
  if (!t) return '';
  const vars = (o: Record<string, string | undefined>) =>
    Object.entries(o)
      .filter(([, v]) => !!v)
      .map(([k, v]) => `--${k}:${v};`)
      .join('');
  return `html[data-theme='light'] [data-hosted]{${vars(t.light)}}html[data-theme='dark'] [data-hosted]{${vars(t.dark)}}`;
}
