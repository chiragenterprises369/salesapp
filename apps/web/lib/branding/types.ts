/**
 * Branding, component design and custom domain shapes used by the web (SPEC 29.3, 29.4, D-059, D-060).
 *
 * TEMPORARY ADAPTER until the change #19 contracts land (contracts-19.md): the values live on the
 * workspace object the session already carries (me.workspace.<field>), written with
 * useSessionActions().updateWorkspace(). The mock session merges and persists any patch, so the
 * adapter works end to end in the browser; after the rebase the fields come from the shared
 * WorkspaceSchema and the uploads go through the platform upload routes.
 */

export const COMPONENT_STYLES = ['standard', 'premium'] as const;
export type ComponentStyle = (typeof COMPONENT_STYLES)[number];
export const DEFAULT_COMPONENT_STYLE: ComponentStyle = 'standard';
export const COMPONENT_STYLE_LABEL: Record<ComponentStyle, string> = { standard: 'Standard', premium: 'Premium' };

export function isComponentStyle(v: unknown): v is ComponentStyle {
  return v === 'standard' || v === 'premium';
}

export interface ChartPaletteChoice {
  /** Preset id from CHART_PALETTE_PRESETS, or 'custom'. */
  preset: string;
  /** Six light-theme colours (#RRGGBB). Dark-theme colours are derived. */
  colors: string[];
}

export interface WorkspaceBranding {
  /** Shown in the sidebar, the browser tab and the sign-in page instead of the workspace name. */
  displayName: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  loginImageUrl: string | null;
  /** #RRGGBB; null = Vistar indigo. */
  brandColor: string | null;
  chartPalette: ChartPaletteChoice | null;
}

export const EMPTY_BRANDING: WorkspaceBranding = {
  displayName: null,
  logoLightUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  loginImageUrl: null,
  brandColor: null,
  chartPalette: null,
};

export type BrandAsset = 'logoLight' | 'logoDark' | 'favicon' | 'loginImage';

export const BRAND_ASSET_FIELD: Record<BrandAsset, keyof WorkspaceBranding> = {
  logoLight: 'logoLightUrl',
  logoDark: 'logoDarkUrl',
  favicon: 'faviconUrl',
  loginImage: 'loginImageUrl',
};

export type DomainStatus = 'pending' | 'verified' | 'failed';

export interface CustomDomain {
  hostname: string;
  status: DomainStatus;
  /** CNAME target the company points its hostname at. */
  cnameTarget: string;
  /** TXT record that proves ownership. */
  txtName: string;
  txtValue: string;
  lastCheckedAt: string | null;
  /** Why the last check failed (user-safe). */
  error: string | null;
}
