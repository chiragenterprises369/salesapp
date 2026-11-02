import { z } from 'zod';
import {
  BoardSkinSchema,
  CelebrationIntensitySchema,
  ComponentStyleSchema,
  DataScopeSchema,
  EmployeeStatusSchema,
  InterfaceStyleSchema,
  LeadsViewModeSchema,
  MANUAL_PRESENCE_STATUSES,
  MotionIntensitySchema,
  PlanSchema,
  RoleKindSchema,
  TeamFloorModeSchema,
  WorkspaceStatusSchema,
} from '../enums.js';
import { FEATURE_FLAGS, PermissionSchema, type FeatureFlag } from '../rbac.js';
import { HhMmSchema, ThemeModeSchema, ThemePreferenceSchema } from '../theme.js';
import { ResolvedLabelsSchema } from '../customization/labels.js';
import { ActivePackSchema } from '../packs/active.js';
import { EMPTY_BRANDING, WorkspaceBrandingSchema } from './branding.js';
import { HexColorSchema, IdSchema, IsoDateSchema, IsoDateTimeSchema, PhoneSchema } from './common.js';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;

export const TimeSlotSchema = z.object({ start: HhMmSchema, end: HhMmSchema });

/** Business hours per weekday; empty array = closed. Times are in Workspace.timezone. */
export const BusinessHoursSchema = z.record(WeekdaySchema, z.array(TimeSlotSchema));
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: [{ start: '09:30', end: '18:30' }],
  tue: [{ start: '09:30', end: '18:30' }],
  wed: [{ start: '09:30', end: '18:30' }],
  thu: [{ start: '09:30', end: '18:30' }],
  fri: [{ start: '09:30', end: '18:30' }],
  sat: [{ start: '10:00', end: '14:00' }],
  sun: [],
};

export const HolidaySchema = z.object({ date: IsoDateSchema, name: z.string().min(1).max(80) });

export const FeatureFlagsSchema = z.object(
  Object.fromEntries(FEATURE_FLAGS.map((f) => [f, z.boolean()])) as Record<FeatureFlag, z.ZodBoolean>,
);

/** Company-controlled support access for Super Admin impersonation. */
export const SupportAccessSchema = z.object({
  /** Impersonation allowed until this time; null = off. */
  until: IsoDateTimeSchema.nullable(),
  /** Allow viewing message bodies and call recordings during impersonation. */
  includeContent: z.boolean(),
});
export type SupportAccess = z.infer<typeof SupportAccessSchema>;

export const WorkspaceSchema = z.object({
  id: IdSchema,
  name: z.string(),
  slug: z.string(),
  status: WorkspaceStatusSchema,
  timezone: z.string().describe('IANA timezone, default Asia/Kolkata'),
  currency: z.literal('INR'),
  businessHours: BusinessHoursSchema,
  holidays: z.array(HolidaySchema),
  plan: PlanSchema,
  logoUrl: z.string().url().nullable().describe('Legacy: public URL of branding.logoLight (kept in sync)'),
  accentColor: HexColorSchema.nullable().describe('Legacy: mirrors branding.brandColor; use branding.colors for contrast-safe values'),
  defaultTheme: ThemeModeSchema,
  /** Admin-set default Leads view (Setting key leads.defaultViewMode); null = "board". */
  defaultLeadsViewMode: LeadsViewModeSchema.nullable(),
  /** Show rank on My Performance (Setting key performance.showRank). */
  showEmployeeRank: z.boolean(),
  /** Admin-set app interface style for users who have not chosen one (Setting key ui.defaultInterfaceStyle). */
  defaultInterfaceStyle: InterfaceStyleSchema.default('classic'),
  /** Admin-set Leads Board skin for users who have not chosen one (Setting key leads.defaultBoardSkin). */
  defaultBoardSkin: BoardSkinSchema.default('depth'),
  /** Web component design for the whole company (Setting key ui.componentStyle, D-059); employees cannot override it. */
  componentStyle: ComponentStyleSchema.default('standard'),
  /** Company branding (Setting keys branding.*, D-060). */
  branding: WorkspaceBrandingSchema.default(EMPTY_BRANDING),
  supportAccess: SupportAccessSchema,
  /** Effective flags = plan defaults + Super Admin overrides. */
  features: FeatureFlagsSchema,
  createdAt: IsoDateTimeSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceUpdateSchema = WorkspaceSchema.pick({
  name: true,
  timezone: true,
  businessHours: true,
  holidays: true,
  logoUrl: true,
  accentColor: true,
  defaultTheme: true,
  defaultLeadsViewMode: true,
  showEmployeeRank: true,
})
  // Plain enums, not the defaulted response fields: Zod 4 applies defaults inside optional keys.
  .extend({ defaultInterfaceStyle: InterfaceStyleSchema, defaultBoardSkin: BoardSkinSchema, componentStyle: ComponentStyleSchema })
  .partial();
export type WorkspaceUpdate = z.infer<typeof WorkspaceUpdateSchema>;

export const SupportAccessUpdateSchema = z.object({
  enabled: z.boolean(),
  durationHours: z.number().int().min(1).max(168).default(24),
  includeContent: z.boolean().default(false),
});
export type SupportAccessUpdate = z.input<typeof SupportAccessUpdateSchema>;

/**
 * Setting table keys (Setting.key). UserSettings fields map 1:1 to `user` keys;
 * workspace keys back WorkspaceSchema fields that are not columns.
 */
export const SETTING_KEYS = {
  user: {
    theme: 'theme',
    teamFloorMode: 'teamFloor.mode',
    notifications: 'notifications',
    reducedMotion: 'a11y.reducedMotion',
    leadsViewMode: 'leads.viewMode',
    interfaceStyle: 'ui.interfaceStyle',
    motionIntensity: 'ui.motionIntensity',
    boardSkin: 'leads.boardSkin',
    celebrations: 'leads.celebrations',
  },
  workspace: {
    defaultLeadsViewMode: 'leads.defaultViewMode',
    showEmployeeRank: 'performance.showRank',
    leadRouting: 'leads.routing',
    /** LabelOverrides (customization/labels.ts) */
    labels: 'ui.labels',
    defaultInterfaceStyle: 'ui.defaultInterfaceStyle',
    defaultBoardSkin: 'leads.defaultBoardSkin',
    /** ComponentStyle (D-059), default standard */
    componentStyle: 'ui.componentStyle',
    /** Branding (D-060). Values: string | null; file keys hold a File id (purpose logo / favicon / login_image). */
    brandingDisplayName: 'branding.displayName',
    brandingLogoLight: 'branding.logoLight',
    brandingLogoDark: 'branding.logoDark',
    brandingBrandColor: 'branding.brandColor',
    /** string[6] of #RRGGBB */
    brandingChartPalette: 'branding.chartPalette',
    brandingLoginImage: 'branding.loginImage',
    brandingFavicon: 'branding.favicon',
    /** SellerProfile (schemas/documents.ts): GSTIN, address with state code, bank, prefixes, terms (change #19 wave B). */
    sellerProfile: 'billing.sellerProfile',
  },
} as const;

/** Team Floor avatar customisation. */
export const AvatarConfigSchema = z.object({
  skinTone: HexColorSchema,
  hairColor: HexColorSchema,
  hairStyle: z.enum(['short', 'long', 'bun', 'curly', 'bald']),
  outfitColor: HexColorSchema,
});
export type AvatarConfig = z.infer<typeof AvatarConfigSchema>;

export const UserSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** Role kind (decides panel and default scope). */
  role: RoleKindSchema,
  status: EmployeeStatusSchema,
  avatar: AvatarConfigSchema.nullable(),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const UserSchema = UserSummarySchema.extend({
  workspaceId: IdSchema,
  email: z.email(),
  phone: PhoneSchema.nullable(),
  title: z.string().nullable(),
  roleId: IdSchema,
  roleName: z.string(),
  teamId: IdSchema.nullable(),
  isActive: z.boolean(),
  workingHours: BusinessHoursSchema.nullable().describe('null = workspace business hours'),
  statusChangedAt: IsoDateTimeSchema.nullable(),
  lastSeenAt: IsoDateTimeSchema.nullable(),
  /** Field staff get attendance and GPS tracking (D-063); set by a company admin. */
  isFieldStaff: z.boolean().default(false),
  createdAt: IsoDateTimeSchema,
});
export type User = z.infer<typeof UserSchema>;

export const UserUpdateSchema = z
  .object({
    name: z.string().min(1).max(80),
    phone: PhoneSchema.nullable(),
    title: z.string().max(80).nullable(),
    teamId: IdSchema.nullable(),
    roleId: IdSchema,
    isActive: z.boolean(),
    workingHours: BusinessHoursSchema.nullable(),
    avatar: AvatarConfigSchema.nullable(),
    isFieldStaff: z.boolean(),
  })
  .partial();
export type UserUpdate = z.infer<typeof UserUpdateSchema>;

/** Self-service profile update (employee panel). Role/team/active/field staff are admin-only. */
export const ProfileUpdateSchema = UserUpdateSchema.pick({ name: true, phone: true, title: true, avatar: true });
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

/**
 * Employee status control (PUT /me/status, D-062): the employee's own status. `on_call` is never manual
 * (it comes from phone state or telephony). Legacy `idle` = available.
 */
export const StatusUpdateSchema = z.object({
  status: z.enum([...MANUAL_PRESENCE_STATUSES, 'idle'] as const),
  note: z.string().trim().max(140).optional().describe('Shown on the Team Floor, e.g. "Client visit, Andheri"'),
});
export type StatusUpdate = z.infer<typeof StatusUpdateSchema>;

export const TeamSchema = z.object({
  id: IdSchema,
  name: z.string(),
  managerId: IdSchema.nullable(),
  memberIds: z.array(IdSchema),
});
export type Team = z.infer<typeof TeamSchema>;

/** Role = kind + data scope + permission set. System roles exist for each kind; admins add custom roles. */
export const RoleSchema = z.object({
  id: IdSchema,
  key: z.string().regex(/^[a-z0-9_]+$/).describe('Slug; system roles use the kind name'),
  name: z.string(),
  kind: RoleKindSchema,
  dataScope: DataScopeSchema,
  permissions: z.array(PermissionSchema),
  isSystem: z.boolean(),
  memberCount: z.number().int(),
});
export type Role = z.infer<typeof RoleSchema>;

export const RoleCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: RoleKindSchema,
  dataScope: DataScopeSchema,
  permissions: z.array(PermissionSchema),
});
export type RoleCreate = z.infer<typeof RoleCreateSchema>;
export const RoleUpdateSchema = RoleCreateSchema.partial();

export const NotificationPrefsSchema = z.object({
  inApp: z.boolean().default(true),
  push: z.boolean().default(true),
  emailDigest: z.enum(['off', 'daily', 'weekly']).default('daily'),
  /** Per-type mutes. */
  muted: z.array(z.string()).default([]),
});

/** Per-user settings (stored in Setting with scope=user, one row per SETTING_KEYS.user key). */
export const UserSettingsSchema = z.object({
  theme: ThemePreferenceSchema,
  teamFloorMode: TeamFloorModeSchema.default('auto'),
  notifications: NotificationPrefsSchema,
  reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
  /** Last chosen Leads page view; null = never chosen (fall back to workspace default, then "board"). */
  leadsViewMode: LeadsViewModeSchema.nullable().default(null),
  /** App interface style; null = follow Workspace.defaultInterfaceStyle. Effective value: resolveInterfaceStyle(). */
  interfaceStyle: InterfaceStyleSchema.nullable().default(null),
  /** Motion intensity everywhere. Effective value: resolveMotion(). */
  motionIntensity: MotionIntensitySchema.default('full'),
  /** Leads Board skin; null = follow Workspace.defaultBoardSkin. Effective value: resolveBoardSkin(). */
  boardSkin: BoardSkinSchema.nullable().default(null),
  /** Board event celebrations; null = follow motion intensity. Effective value: resolveCelebrations(). */
  celebrations: CelebrationIntensitySchema.nullable().default(null),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;
/** Defaults for a user with no Setting rows (API and mocks). */
export const DEFAULT_USER_SETTINGS: UserSettings = UserSettingsSchema.parse({ theme: {}, notifications: {} });
/**
 * PATCH body: every field optional with NO defaults (Zod 4 `.partial()` would re-apply defaults and
 * overwrite unrelated settings). Nested objects merge server-side.
 */
export const UserSettingsUpdateSchema = z
  .object({
    theme: z.object({ mode: ThemeModeSchema, darkFrom: HhMmSchema, darkTo: HhMmSchema }).partial(),
    teamFloorMode: TeamFloorModeSchema,
    notifications: z
      .object({ inApp: z.boolean(), push: z.boolean(), emailDigest: z.enum(['off', 'daily', 'weekly']), muted: z.array(z.string()) })
      .partial(),
    reducedMotion: z.enum(['system', 'on', 'off']),
    leadsViewMode: LeadsViewModeSchema.nullable(),
    interfaceStyle: InterfaceStyleSchema.nullable(),
    motionIntensity: MotionIntensitySchema,
    boardSkin: BoardSkinSchema.nullable(),
    celebrations: CelebrationIntensitySchema.nullable(),
  })
  .partial();
export type UserSettingsUpdate = z.infer<typeof UserSettingsUpdateSchema>;

/** Present when a Super Admin is impersonating; drives the persistent banner. */
export const ImpersonationInfoSchema = z.object({
  sessionId: IdSchema,
  adminName: z.string(),
  reason: z.string(),
  readOnly: z.boolean(),
  /** Message bodies and recordings visible only if the company enabled support access content. */
  contentAccess: z.boolean(),
  expiresAt: IsoDateTimeSchema,
});
export type ImpersonationInfo = z.infer<typeof ImpersonationInfoSchema>;

export const MeResponseSchema = z.object({
  user: UserSchema,
  role: RoleSchema,
  workspace: WorkspaceSchema,
  permissions: z.array(PermissionSchema),
  /** Team member ids visible to a manager (dataScope=team); [] otherwise. */
  teamMemberIds: z.array(IdSchema),
  settings: UserSettingsSchema,
  impersonation: ImpersonationInfoSchema.nullable(),
  /** Display labels (e.g. Lead shown as "Enquiry"); defaults merged with workspace overrides. */
  labels: ResolvedLabelsSchema,
  /** Active, entitled Industry Packs (details: GET /packs/runtime). */
  packs: z.array(ActivePackSchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
