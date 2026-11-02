import { z } from 'zod';
import { CustomDomainStatusSchema, FloorRequestStatusSchema, PlanSchema, WorkspaceStatusSchema } from '../enums.js';
import { FeatureFlagSchema, PlanLimitsSchema } from '../rbac.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateTimeSchema } from './common.js';
import { FeatureFlagsSchema } from './workspace.js';

/** Super Admin panel contracts (owner: superadmin-panel, Phase 9 unless brought forward). */

export const PlanDefinitionSchema = z.object({
  key: PlanSchema,
  name: z.string(),
  priceInrMonthly: z.number().int().min(0),
  priceInrYearly: z.number().int().min(0),
  limits: PlanLimitsSchema,
  features: FeatureFlagsSchema,
  /** Overage pricing per unit beyond limits; null = hard block at the limit. */
  overage: z
    .object({
      perSeatInr: z.number().int().nullable(),
      per1000LeadsInr: z.number().int().nullable(),
      per1000WhatsappInr: z.number().int().nullable(),
      per1000RunsInr: z.number().int().nullable(),
    })
    .nullable(),
  trialDays: z.number().int().min(0),
  isActive: z.boolean(),
});
export type PlanDefinition = z.infer<typeof PlanDefinitionSchema>;

export const UsageSnapshotSchema = z.object({
  period: z.string().describe('YYYY-MM'),
  seats: z.number().int(),
  leads: z.number().int(),
  whatsappMessages: z.number().int(),
  workflowRuns: z.number().int(),
  storageMb: z.number().int(),
});
export type UsageSnapshot = z.infer<typeof UsageSnapshotSchema>;

export const CompanySchema = z.object({
  id: IdSchema,
  name: z.string(),
  slug: z.string(),
  status: WorkspaceStatusSchema,
  plan: PlanSchema,
  trialEndsAt: IsoDateTimeSchema.nullable(),
  mrrInr: z.number().int(),
  usage: UsageSnapshotSchema,
  flagOverrides: z.partialRecord(FeatureFlagSchema, z.boolean()).describe('Only the flags the Super Admin overrode'),
  ownerEmail: z.string().nullable(),
  lastActiveAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  /** Effective flags (plan + overrides); the per-company switches custom_domain and field_tracking are flags. */
  features: FeatureFlagsSchema.optional(),
  /** Custom domain of the company, if any (D-060). */
  customDomain: z.object({ hostname: z.string(), status: CustomDomainStatusSchema }).nullable().optional(),
  /** Custom floor progress (D-061): latest request status and the published floor version. */
  floor: z.object({ requestStatus: FloorRequestStatusSchema.nullable(), publishedVersion: z.number().int().nullable() }).optional(),
  /** Active users (seats in use). */
  userCount: z.number().int().optional(),
});
export type Company = z.infer<typeof CompanySchema>;

/** POST /api/super/companies response: the admin invite link is returned once (always in development; in production only when no email could be sent). */
export const CompanyCreatedSchema = CompanySchema.extend({
  adminInvite: z.object({
    email: z.email(),
    url: z.string().url().nullable(),
    expiresAt: IsoDateTimeSchema,
    emailed: z.boolean(),
  }),
});
export type CompanyCreated = z.infer<typeof CompanyCreatedSchema>;

export const CompanyListQuerySchema = CursorPaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  status: WorkspaceStatusSchema.optional(),
  plan: PlanSchema.optional(),
});

export const CompanyCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  plan: PlanSchema,
  adminName: z.string().trim().min(1).max(80),
  adminEmail: z.email(),
  timezone: z.string().default('Asia/Kolkata'),
  trialDays: z.number().int().min(0).max(90).default(14),
});
export const CompanyUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  plan: PlanSchema.optional(),
  trialEndsAt: IsoDateTimeSchema.nullable().optional(),
});
export const CompanyStatusChangeSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().min(5).max(500),
});
export const CompanyFlagsUpdateSchema = z.object({
  overrides: z.record(FeatureFlagSchema, z.boolean().nullable()).describe('null removes the override'),
});

export const ImpersonationStartSchema = z.object({
  workspaceId: IdSchema,
  reason: z.string().trim().min(10, { error: 'Explain why you need access (min 10 characters)' }).max(500),
  durationMin: z.number().int().min(5).max(120).default(30),
  readOnly: z.boolean().default(true),
});
export const ImpersonationSessionSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  workspaceName: z.string(),
  reason: z.string(),
  readOnly: z.boolean(),
  contentAccess: z.boolean(),
  startedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  endedAt: IsoDateTimeSchema.nullable(),
  /** Workspace-audience token with the `imp` claim; returned once at start. */
  accessToken: z.string().optional(),
});
export type ImpersonationSession = z.infer<typeof ImpersonationSessionSchema>;

export const PlatformOverviewSchema = z.object({
  activeCompanies: z.number().int(),
  trialCompanies: z.number().int(),
  mrrInr: z.number().int(),
  signups30d: z.number().int(),
  churnPct30d: z.number(),
  health: z.object({ status: z.enum(['ok', 'degraded', 'down']), failedJobs24h: z.number().int(), webhookFailures24h: z.number().int(), errorRatePct: z.number() }),
  generatedAt: IsoDateTimeSchema,
});
export type PlatformOverview = z.infer<typeof PlatformOverviewSchema>;

export const PlatformAuditLogSchema = z.object({
  id: IdSchema,
  adminId: IdSchema.nullable(),
  adminName: z.string().nullable(),
  action: z.string().describe('e.g. company.suspend, plan.change, impersonation.start'),
  workspaceId: IdSchema.nullable(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  reason: z.string().nullable(),
  diff: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type PlatformAuditLog = z.infer<typeof PlatformAuditLogSchema>;
