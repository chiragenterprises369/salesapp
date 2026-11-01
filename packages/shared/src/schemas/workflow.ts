import { z } from 'zod';
import { WorkflowRunStatusSchema, WorkflowStatusSchema, WorkflowStepStatusSchema } from '../enums.js';
import { WorkflowGraphSchema } from '../workflow/graph.js';
import { NodeTypeSchema } from '../workflow/nodes.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateTimeSchema } from './common.js';
import { LeadCreateSchema } from './lead.js';
import { UserSummarySchema } from './workspace.js';

export const WorkflowSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: WorkflowStatusSchema,
  triggerType: NodeTypeSchema.nullable(),
  activeVersion: z.number().int().nullable(),
  latestVersion: z.number().int(),
  draft: WorkflowGraphSchema.describe('Current editable draft graph'),
  templateKey: z.string().nullable(),
  stats: z.object({ runs: z.number().int(), completed: z.number().int(), failed: z.number().int(), active: z.number().int() }),
  createdBy: UserSummarySchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const WorkflowListItemSchema = WorkflowSchema.omit({ draft: true });
export type WorkflowListItem = z.infer<typeof WorkflowListItemSchema>;

export const WorkflowCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  templateKey: z.string().optional().describe('Start from WORKFLOW_TEMPLATES[key]'),
  graph: WorkflowGraphSchema.optional(),
});
export type WorkflowCreate = z.infer<typeof WorkflowCreateSchema>;

export const WorkflowUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  draft: WorkflowGraphSchema.optional(),
});
export type WorkflowUpdate = z.infer<typeof WorkflowUpdateSchema>;

export const WorkflowPublishSchema = z.object({ note: z.string().max(200).optional() });
export const WorkflowStatusChangeSchema = z.object({ status: z.enum(['active', 'paused', 'draft']) });
export const WorkflowRollbackSchema = z.object({ version: z.number().int().min(1) });

export const WorkflowVersionSchema = z.object({
  id: IdSchema,
  workflowId: IdSchema,
  version: z.number().int(),
  graph: WorkflowGraphSchema,
  note: z.string().nullable(),
  createdBy: UserSummarySchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;

export const WorkflowRunStepSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  nodeId: z.string(),
  nodeType: NodeTypeSchema,
  status: WorkflowStepStatusSchema,
  attempt: z.number().int(),
  /** Output handle taken, e.g. "yes", "price". */
  branch: z.string().nullable(),
  summary: z.string().nullable().describe('e.g. "Sent template indiamart_welcome"'),
  error: z.string().nullable(),
  scheduledFor: IsoDateTimeSchema.nullable().describe('For waits: when the run resumes'),
  startedAt: IsoDateTimeSchema.nullable(),
  finishedAt: IsoDateTimeSchema.nullable(),
});
export type WorkflowRunStep = z.infer<typeof WorkflowRunStepSchema>;

export const WorkflowRunSchema = z.object({
  id: IdSchema,
  workflowId: IdSchema,
  version: z.number().int(),
  leadId: IdSchema.nullable(),
  leadName: z.string().nullable(),
  status: WorkflowRunStatusSchema,
  isTest: z.boolean(),
  currentNodeIds: z.array(z.string()),
  error: z.string().nullable(),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
  steps: z.array(WorkflowRunStepSchema).optional(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const WorkflowRunListQuerySchema = CursorPaginationQuerySchema.extend({
  workflowId: IdSchema.optional(),
  leadId: IdSchema.optional(),
  status: WorkflowRunStatusSchema.optional(),
  isTest: z.stringbool().optional().describe('true | false'),
});

/** Test run with a dummy lead. Waits are compressed so the run finishes in seconds. */
export const WorkflowTestRunSchema = z.object({
  graph: WorkflowGraphSchema.optional().describe('Defaults to the current draft'),
  leadId: IdSchema.optional(),
  dummyLead: LeadCreateSchema.partial().optional(),
  simulateReply: z.string().max(500).optional().describe('Pretend the lead replied with this text'),
  waitScale: z.number().min(0).max(1).default(0).describe('0 = skip waits, 1 = real time'),
  dryRun: z.boolean().default(true).describe('true = messages are not actually sent'),
});
export type WorkflowTestRun = z.infer<typeof WorkflowTestRunSchema>;

export const WorkflowTemplateSummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  triggerType: NodeTypeSchema,
  nodeCount: z.number().int(),
});
