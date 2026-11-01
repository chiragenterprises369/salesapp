import { z } from 'zod';
import { CallDirectionSchema, CallOutcomeSchema, CallStatusSchema } from '../enums.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateTimeSchema, PhoneSchema, queryArray } from './common.js';
import { UserSummarySchema } from './workspace.js';

export const CallSchema = z.object({
  id: IdSchema,
  direction: CallDirectionSchema,
  status: CallStatusSchema,
  outcome: CallOutcomeSchema.nullable(),
  leadId: IdSchema.nullable(),
  leadName: z.string().nullable(),
  user: UserSummarySchema.nullable(),
  from: PhoneSchema,
  to: PhoneSchema,
  startedAt: IsoDateTimeSchema,
  answeredAt: IsoDateTimeSchema.nullable(),
  endedAt: IsoDateTimeSchema.nullable(),
  durationSec: z.number().int().min(0),
  hasRecording: z.boolean(),
  notes: z.string().nullable(),
  disposition: z.string().nullable(),
  provider: z.string(),
});
export type Call = z.infer<typeof CallSchema>;

export const ClickToCallSchema = z.object({
  leadId: IdSchema.optional(),
  to: PhoneSchema.optional().describe('Required when leadId is not given'),
});
export type ClickToCall = z.infer<typeof ClickToCallSchema>;

export const CallUpdateSchema = z.object({
  outcome: CallOutcomeSchema.optional(),
  notes: z.string().max(5000).optional(),
  disposition: z.string().max(80).optional(),
});
export type CallUpdate = z.infer<typeof CallUpdateSchema>;

export const CallListQuerySchema = CursorPaginationQuerySchema.extend({
  userId: IdSchema.optional(),
  leadId: IdSchema.optional(),
  status: queryArray(CallStatusSchema),
  outcome: queryArray(CallOutcomeSchema),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});
export type CallListQuery = z.infer<typeof CallListQuerySchema>;

/** Short-lived signed URL for a recording. Requires calls.recordings. */
export const RecordingUrlSchema = z.object({
  url: z.string().url(),
  expiresAt: IsoDateTimeSchema,
  waveform: z.array(z.number().min(0).max(1)).describe('Downsampled peaks for the player'),
});
export type RecordingUrl = z.infer<typeof RecordingUrlSchema>;
