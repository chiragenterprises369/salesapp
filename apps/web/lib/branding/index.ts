/** Branding, component design and custom domains (SPEC 29.3, 29.4, D-059, D-060). OWNER: frontend-app (web-premium). */
export { BRAND_ATTRIBUTE, COMPONENT_STYLE_ATTRIBUTE, getBrandingBootScript, isCustomHost } from './boot';
export { BrandingProvider } from './branding-provider';
export { brandCss, resolveBrandTokens } from './brand-css';
export {
  CHART_PALETTE_PRESETS,
  CHART_SLOTS,
  chartContrast,
  chartPresetOf,
  DEFAULT_BRAND_COLOR,
  deriveBrandTokens,
  deriveChartPalette,
  type BrandDerivation,
  type ContrastCheck,
} from './brand-tokens';
export { useBrandPalette } from './use-brand-palette';
export { usePlatformComponentStyle, useSetPlatformComponentStyle } from './platform-style';
export { usePublicBranding, type PublicBranding } from './public-branding';
export * from './types';
export {
  ASSET_RULES,
  brandName,
  readBranding,
  readComponentStyle,
  uploadBrandAsset,
  UploadError,
  useBranding,
  useComponentStyleSetting,
  useSaveBranding,
} from './workspace-branding';
