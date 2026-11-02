'use client';

import { palettes, type ThemePalette } from '@vistar/shared';
import { useMemo } from 'react';
import { useDocumentTheme } from '@/lib/use-document-theme';
import { resolveBrandTokens } from './brand-css';
import { useBranding } from './workspace-branding';

/**
 * Theme colours for JS consumers (Recharts props, canvas) with the company's brand colour and chart
 * palette applied, matching the CSS variables (D-060).
 */
export function useBrandPalette(): ThemePalette {
  const theme = useDocumentTheme();
  const branding = useBranding();
  return useMemo(() => {
    const colors = resolveBrandTokens(branding);
    return colors ? ({ ...palettes[theme], ...colors[theme] } as ThemePalette) : palettes[theme];
  }, [theme, branding]);
}
