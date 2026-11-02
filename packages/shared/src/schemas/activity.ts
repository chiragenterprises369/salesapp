import { z } from 'zod';
import {
  CallOutcomeSchema,
  CallStatusSchema,
  MessageDirectionSchema,
  WorkflowStepStatusSchema,
} from '../enums.js';
import { IdSchema, IsoDateTimeSchema, UtmSchema } from './common.js';
import { UserSummarySchema } from './workspace.js';

/** Timeline entry on a lead. Discriminated by `type`; each type has a typed payload. */
const base = {
  id: IdSchema,
  leadId: IdSchema,
  actor: UserSummarySchema.nullable().describe('null for system/workflow/integration actions'),
  createdAt: IsoDateTimeSchema,
};

export const ActivitySchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('lead_created'), payload: z.object({
    source: z.string(),
    /** Lead capture form that created the lead (change #19 wave B). */
    formId: IdSchema.optional(),
    formName: z.string().optional(),
    utm: UtmSchema.optional(),
  }) }),
  z.object({ ...base, type: z.literal('note'), payload: z.object({ body: z.string() }) }),
  z.object({
    ...base,
    type: z.literal('call'),
    payload: z.object({
      callId: IdSchema,
      status: CallStatusSchema,
      outcome: CallOutcomeSchema.nullable(),
      durationSec: z.number().int(),
      hasRecording: z.boolean(),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('message'),
    payload: z.object({
      conversationId: IdSchema,
      messageId: IdSchema,
      direction: MessageDirectionSchema,
      preview: z.string().max(200),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('email'),
    payload: z.object({ subject: z.string(), direction: MessageDirectionSchema }),
  }),
  z.object({
    ...base,
    type: z.literal('stage_changed'),
    payload: z.object({ fromStageId: IdSchema.nullable(), toStageId: IdSchema }),
  }),
  z.object({
    ...base,
    type: z.literal('assigned'),
    payload: z.object({ fromUserId: IdSchema.nullable(), toUserId: IdSchema.nullable(), rule: z.string().nullable() }),
  }),
  z.object({ ...base, type: z.literal('task_created'), payload: z.object({ taskId: IdSchema, title: z.string() }) }),
  z.object({ ...base, type: z.literal('task_completed'), payload: z.object({ taskId: IdSchema, title: z.string() }) }),
  z.object({
    ...base,
    type: z.literal('workflow_step'),
    payload: z.object({
      workflowId: IdSchema,
      workflowName: z.string(),
      runId: IdSchema,
      nodeId: z.string(),
      nodeType: z.string(),
      status: WorkflowStepStatusSchema,
      summary: z.string().describe('e.g. "Sent template welcome_v2"'),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('file_uploaded'),
    payload: z.object({ fileId: IdSchema, name: z.string(), size: z.number().int() }),
  }),
  z.object({
    ...base,
    type: z.literal('field_updated'),
    payload: z.object({ field: z.string(), from: z.unknown(), to: z.unknown() }),
  }),
  z.object({ ...base, type: z.literal('merged'), payload: z.object({ mergedLeadIds: z.array(IdSchema) }) }),
]);
export type Activity = z.infer<typeof ActivitySchema>;
export type ActivityOf<T extends Activity['type']> = Extract<Activity, { type: T }>;
