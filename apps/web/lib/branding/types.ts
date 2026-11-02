import { COMPONENT_STYLES, type ComponentStyle } from '@vistar/shared';

/**
 * Web view models for branding and component design (SPEC 29.3, 29.4, D-059, D-060).
 * Source of truth: shared `Workspace.componentStyle` and `Workspace.branding` (contracts(19)). The
 * settings page edits a `BrandingDraft` (file refs with their URL) and saves it with
 * PATCH /workspace/branding (file ids from POST /files).
 */
export { COMPONENT_STYLES, type ComponentStyle };
export const DEFAULT_COMPONENT_STYLE: ComponentStyle = 'standard';
export const COMPONENT_STYLE_LABEL: Record<ComponentStyle, string> = { standard: 'Standard', premium: 'Premium' };

export function isComponentStyle(v: unknown): v is ComponentStyle {
  return v === 'standard' || v === 'premium';
}

/** An uploaded brand image: stored file id plus a URL to show it. */
export interface BrandAssetValue {
  fileId: string;
  url: string | null;
  name: string;
  mime: string;
  size: number;
}

export interface BrandingDraft {
  /** Shown in the sidebar, the browser tab and the sign-in page instead of the workspace name. */
  displayName: string | null;
  logoLight: BrandAssetValue | null;
  logoDark: BrandAssetValue | null;
  favicon: BrandAssetValue | null;
  loginImage: BrandAssetValue | null;
  /** #RRGGBB; null = Vistar indigo. */
  brandColor: string | null;
  /** Six light-theme series colours (#RRGGBB); null = token chart-1..6. Dark colours are derived. */
  chartPalette: string[] | null;
}

export const EMPTY_DRAFT: BrandingDraft = {
  displayName: null,
  logoLight: null,
  logoDark: null,
  favicon: null,
  loginImage: null,
  brandColor: null,
  chartPalette: null,
};

export type BrandAsset = 'logoLight' | 'logoDark' | 'favicon' | 'loginImage';
