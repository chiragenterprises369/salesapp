import { z } from 'zod';
import {
  DataScopeSchema,
  EmployeeStatusSchema,
  LeadsViewModeSchema,
  PlanSchema,
  RoleKindSchema,
  TeamFloorModeSchema,
  WorkspaceStatusSchema,
} from '../enums.js';
import { FEATURE_FLAGS, PermissionSchema, type FeatureFlag } from '../rbac.js';
import { HhMmSchema, ThemeModeSchema, ThemePreferenceSchema } from '../theme.js';
import { ResolvedLabelsSchema } from '../customization/labels.js';
import { ActivePackSchema } from '../packs/active.js';
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
  logoUrl: z.string().url().nullable(),
  accentColor: HexColorSchema.nullable().describe('Branding accent; clamped to AA contrast by the UI'),
  defaultTheme: ThemeModeSchema,
  /** Admin-set default Leads view (Setting key leads.defaultViewMode); null = "board". */
  defaultLeadsViewMode: LeadsViewModeSchema.nullable(),
  /** Show rank on My Performance (Setting key performance.showRank). */
  showEmployeeRank: z.boolean(),
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
}).partial();
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
  },
  workspace: {
    defaultLeadsViewMode: 'leads.defaultViewMode',
    showEmployeeRank: 'performance.showRank',
    leadRouting: 'leads.routing',
    /** LabelOverrides (customization/labels.ts) */
    labels: 'ui.labels',
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
  })
  .partial();
export type UserUpdate = z.infer<typeof UserUpdateSchema>;

/** Self-service profile update (employee panel). Role/team/active are admin-only. */
export const ProfileUpdateSchema = UserUpdateSchema.pick({ name: true, phone: true, title: true, avatar: true });
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

/** Employee status control: Available (idle), On call, Break (away), Offline. */
export const StatusUpdateSchema = z.object({ status: z.enum(['idle', 'on_call', 'away', 'offline']) });
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
