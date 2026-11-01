import { z } from 'zod';
import { EmployeeStatusSchema, LeadSourceSchema, TARGET_METRICS } from '../enums.js';
import { IdSchema, IsoDateTimeSchema } from './common.js';
import { LeadListItemSchema } from './lead.js';
import { TaskSchema } from './task.js';
import { UserSummarySchema } from './workspace.js';

export const DashboardQuerySchema = z.object({
  from: IsoDateTimeSchema.optional().describe('Default: start of today, workspace timezone'),
  to: IsoDateTimeSchema.optional(),
  teamId: IdSchema.optional(),
  compare: z.enum(['none', 'previous_period']).default('previous_period'),
});
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

const kpi = z.object({
  value: z.number(),
  /** Value for the comparison period; null when compare=none. */
  previous: z.number().nullable(),
  /** Last N points for the sparkline (oldest first). */
  sparkline: z.array(z.number()),
});
export type Kpi = z.infer<typeof kpi>;

export const DashboardKpisSchema = z.object({
  newLeads: kpi,
  callsToday: kpi,
  answeredPct: kpi.describe('0-100'),
  conversionPct: kpi.describe('0-100'),
  revenueInr: kpi,
  avgResponseSec: kpi.describe('Lead created -> first outbound touch'),
});
export type DashboardKpis = z.infer<typeof DashboardKpisSchema>;

export const FunnelStepSchema = z.object({ stageId: IdSchema, name: z.string(), count: z.number().int(), valueInr: z.number().int() });
export const SourceBreakdownSchema = z.object({ source: LeadSourceSchema, count: z.number().int(), wonValueInr: z.number().int() });
export const CallsPerHourSchema = z.object({ hour: z.number().int().min(0).max(23), answered: z.number().int(), missed: z.number().int() });

export const LeaderboardEntrySchema = z.object({
  user: UserSummarySchema,
  rank: z.number().int(),
  revenueInr: z.number().int(),
  dealsWon: z.number().int(),
  calls: z.number().int(),
  targetPct: z.number().nullable(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const ATTENTION_KINDS = ['hot_lead_unassigned', 'task_overdue', 'workflow_failed', 'missed_call', 'sla_breach'] as const;
export const AttentionKindSchema = z.enum(ATTENTION_KINDS);
export type AttentionKind = z.infer<typeof AttentionKindSchema>;

/** "Needs attention" item (dashboard panel and Team Floor "Needs you" bubbles). */
export const AttentionItemSchema = z.object({
  id: z.string().describe('Stable key, e.g. task_overdue:<taskId>'),
  kind: AttentionKindSchema,
  title: z.string(),
  subtitle: z.string().nullable(),
  href: z.string().nullable(),
  leadId: IdSchema.nullable(),
  userId: IdSchema.nullable().describe('Employee the bubble is shown above; null = manager cabin'),
  severity: z.enum(['info', 'warning', 'critical']),
  createdAt: IsoDateTimeSchema,
});
export type AttentionItem = z.infer<typeof AttentionItemSchema>;

export const FeedItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['lead_created', 'lead_assigned', 'call_ended', 'stage_moved', 'message_received', 'task_completed', 'workflow_failed']),
  text: z.string().describe('Pre-rendered sentence, e.g. "Priya moved Shree Ganesh Traders to Quote sent"'),
  actor: UserSummarySchema.nullable(),
  leadId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type FeedItem = z.infer<typeof FeedItemSchema>;

export const DashboardSummarySchema = z.object({
  kpis: DashboardKpisSchema,
  funnel: z.array(FunnelStepSchema),
  sources: z.array(SourceBreakdownSchema),
  callsPerHour: z.array(CallsPerHourSchema),
  leaderboard: z.array(LeaderboardEntrySchema),
  feed: z.array(FeedItemSchema),
  attention: z.array(AttentionItemSchema),
  generatedAt: IsoDateTimeSchema,
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

/** Team Floor initial snapshot; afterwards the client applies realtime events. */
export const TeamFloorEmployeeSchema = z.object({
  user: UserSummarySchema,
  status: EmployeeStatusSchema,
  deskIndex: z.number().int().min(0).describe('Stable desk slot on the sales floor'),
  currentLeadId: IdSchema.nullable(),
  currentLeadName: z.string().nullable(),
  activeCall: z.object({ callId: IdSchema, startedAt: IsoDateTimeSchema, leadName: z.string().nullable() }).nullable(),
  callsToday: z.number().int(),
  avgTalkSec: z.number().int(),
  targetPct: z.number().nullable(),
});
export type TeamFloorEmployee = z.infer<typeof TeamFloorEmployeeSchema>;

export const TeamFloorSnapshotSchema = z.object({
  kpis: z.object({
    active: z.number().int(),
    onCall: z.number().int(),
    idle: z.number().int(),
    busy: z.number().int(),
    callsToday: z.number().int(),
    leadsWaiting: z.number().int(),
  }),
  employees: z.array(TeamFloorEmployeeSchema).max(200),
  leadsWaiting: z.array(z.object({ leadId: IdSchema, name: z.string(), createdAt: IsoDateTimeSchema })),
  attention: z.array(AttentionItemSchema),
  generatedAt: IsoDateTimeSchema,
});
export type TeamFloorSnapshot = z.infer<typeof TeamFloorSnapshotSchema>;

/** Employee panel Home ("today view"), always own scope. */
export const MyTodaySchema = z.object({
  tasksDue: z.array(TaskSchema),
  followUps: z.array(LeadListItemSchema).describe('Leads with nextFollowUpAt today or overdue'),
  callsToMake: z.array(TaskSchema).describe('Open call tasks due today or overdue'),
  newAssigned: z.array(LeadListItemSchema).describe('Assigned to me in the last 24 h'),
  targets: z.array(
    z.object({
      metric: z.enum(TARGET_METRICS),
      period: z.string().describe('YYYY-MM'),
      target: z.number().int(),
      achieved: z.number().int(),
    }),
  ),
  stats: z.object({
    callsToday: z.number().int(),
    talkSecToday: z.number().int(),
    leadsContactedToday: z.number().int(),
    wonInrThisMonth: z.number().int(),
    rank: z.number().int().nullable().describe('null when the company hides ranks (Workspace.showEmployeeRank)'),
  }),
  generatedAt: IsoDateTimeSchema,
});
export type MyToday = z.infer<typeof MyTodaySchema>;
