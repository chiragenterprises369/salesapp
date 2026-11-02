import { z } from 'zod';
import { ComponentStyleSchema, CustomDomainStatusSchema } from '../enums.js';
import { ThemeModeSchema } from '../theme.js';
import { HexColorSchema, IdSchema, IsoDateTimeSchema } from './common.js';
import { FileRefSchema } from './storage.js';

/**
 * BRANDING, COMPONENT STYLE AND CUSTOM DOMAINS (D-059, D-060, SPEC 29.3, 29.4).
 *
 * Stored as workspace Setting rows (SETTING_KEYS.workspace.branding*, ui.componentStyle); exposed on
 * WorkspaceSchema (`branding`, `componentStyle`), so MeResponse carries them. Admin-only writes
 * (settings.manage), audited. Branding files are uploaded first with POST /files (purpose logo, favicon,
 * login_image; public visibility) and then referenced by id.
 * Colours: `colors` / `chartColors` are the contrast-guarded values from branding.ts (3:1 on the light and
 * dark surfaces); the stored choice stays in `brandColor` / `chartPalette`.
 */

export const ResolvedBrandColorsSchema = z.object({
  base: HexColorSchema.describe('The colour the admin chose'),
  light: HexColorSchema.describe('Use on light surfaces (>= 3:1 vs #FFFFFF)'),
  dark: HexColorSchema.describe('Use on dark surfaces (>= 3:1 vs #171A21)'),
  lightForeground: HexColorSchema.describe('Text on a `light` fill'),
  darkForeground: HexColorSchema.describe('Text on a `dark` fill'),
  adjusted: z.boolean().describe('True when light or dark differs from base'),
});

export const ChartPaletteSchema = z.array(HexColorSchema).length(6);

export const ResolvedChartPaletteSchema = z.object({
  base: ChartPaletteSchema,
  light: ChartPaletteSchema,
  dark: ChartPaletteSchema,
  adjusted: z.array(z.number().int().min(0).max(5)),
});

export const WorkspaceBrandingSchema = z.object({
  /** Shown instead of the workspace name in the shell, login page and app; null = workspace name. */
  displayName: z.string().nullable(),
  logoLight: FileRefSchema.nullable(),
  logoDark: FileRefSchema.nullable().describe('null = use logoLight on dark surfaces'),
  brandColor: HexColorSchema.nullable().describe('null = Vistar indigo (tokens)'),
  chartPalette: ChartPaletteSchema.nullable().describe('null = token chart-1..6'),
  loginImage: FileRefSchema.nullable(),
  favicon: FileRefSchema.nullable(),
  colors: ResolvedBrandColorsSchema.nullable(),
  chartColors: ResolvedChartPaletteSchema.nullable(),
});
export type WorkspaceBranding = z.infer<typeof WorkspaceBrandingSchema>;

export const EMPTY_BRANDING: WorkspaceBranding = {
  displayName: null,
  logoLight: null,
  logoDark: null,
  brandColor: null,
  chartPalette: null,
  loginImage: null,
  favicon: null,
  colors: null,
  chartColors: null,
};

/** PATCH /workspace/branding: only the given keys change; null clears. File ids must be the workspace's public branding files. */
export const BrandingUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60).nullable(),
    logoLightFileId: IdSchema.nullable(),
    logoDarkFileId: IdSchema.nullable(),
    loginImageFileId: IdSchema.nullable(),
    faviconFileId: IdSchema.nullable(),
    brandColor: HexColorSchema.nullable(),
    chartPalette: ChartPaletteSchema.nullable(),
  })
  .partial();
export type BrandingUpdate = z.infer<typeof BrandingUpdateSchema>;

/** What the login page and the Next middleware may know about a workspace without signing in. */
export const PublicWorkspaceSchema = z.object({
  slug: z.string(),
  name: z.string().describe('branding.displayName or the workspace name'),
  branding: WorkspaceBrandingSchema,
  componentStyle: ComponentStyleSchema,
  defaultTheme: ThemeModeSchema,
});
export type PublicWorkspace = z.infer<typeof PublicWorkspaceSchema>;

export const SlugParamSchema = z.object({ slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/) });

/** Host header value without port, lower case. */
export const HostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?!-)(?:[a-z0-9-]{1,63}(?<!-)\.)+(?:[a-z]{2,63}|localhost)$/, { error: 'Enter a domain like crm.yourcompany.com' });

export const HostResolveQuerySchema = z.object({ host: z.string().min(1).max(300).describe('Host header; a :port suffix is ignored') });

export const HostResolutionSchema = z.object({
  host: z.string(),
  /** custom_domain = verified CustomDomain of a company with the custom_domain switch on; dev_localhost = `<slug>.localhost` (non-production only). */
  source: z.enum(['custom_domain', 'dev_localhost']),
  workspace: PublicWorkspaceSchema,
});
export type HostResolution = z.infer<typeof HostResolutionSchema>;

/** DNS record name for the ownership check: TXT `_vistar-verify.<hostname>` = `vistar-verify=<token>`. */
export const CUSTOM_DOMAIN_TXT_PREFIX = '_vistar-verify';
export const CUSTOM_DOMAIN_TXT_VALUE_PREFIX = 'vistar-verify=';

export const CustomDomainSchema = z.object({
  id: IdSchema,
  hostname: z.string(),
  status: CustomDomainStatusSchema,
  verifiedAt: IsoDateTimeSchema.nullable(),
  lastCheckedAt: IsoDateTimeSchema.nullable(),
  lastError: z.string().nullable().describe('Why the last check failed, user-safe'),
  dns: z.object({
    cname: z.object({ name: z.string(), value: z.string().describe('CUSTOM_DOMAIN_CNAME_TARGET') }),
    txt: z.object({ name: z.string(), value: z.string() }),
  }),
  createdAt: IsoDateTimeSchema,
});
export type CustomDomain = z.infer<typeof CustomDomainSchema>;

export const CustomDomainStateSchema = z.object({
  /** Effective `custom_domain` feature flag (Super Admin switch). When false the set/verify routes return FEATURE_DISABLED. */
  enabled: z.boolean(),
  domain: CustomDomainSchema.nullable(),
});
export type CustomDomainState = z.infer<typeof CustomDomainStateSchema>;

export const CustomDomainSetSchema = z.object({ hostname: HostnameSchema });
export type CustomDomainSet = z.infer<typeof CustomDomainSetSchema>;
