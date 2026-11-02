import { z } from 'zod';
import { CallDirectionSchema, CallOutcomeSchema, CallResultSchema, CallSourceSchema, CallStatusSchema } from '../enums.js';
import { CursorPaginationQuerySchema, CustomFieldValuesSchema, IdSchema, IsoDateTimeSchema, PhoneSchema, queryArray } from './common.js';
import { UserSummarySchema } from './workspace.js';

export const CallSchema = z.object({
  id: IdSchema,
  direction: CallDirectionSchema,
  status: CallStatusSchema,
  /** The rep's disposition (interested, callback, ...). The technical result is `result`. */
  outcome: CallOutcomeSchema.nullable(),
  leadId: IdSchema.nullable(),
  leadName: z.string().nullable(),
  user: UserSummarySchema.nullable(),
  /** E.164; "" when unknown (private number, or the SIM number is not shared by the phone). */
  from: z.string(),
  to: z.string(),
  startedAt: IsoDateTimeSchema,
  /** null when not answered or not observable (outgoing SIM calls: Android does not report the answer). */
  answeredAt: IsoDateTimeSchema.nullable(),
  endedAt: IsoDateTimeSchema.nullable(),
  /** Talk time; for SIM calls taken from the device call log after the call. */
  durationSec: z.number().int().min(0),
  hasRecording: z.boolean(),
  notes: z.string().nullable(),
  disposition: z.string().nullable(),
  provider: z.string(),
  /** Custom field values (field target "call"); hidden fields are stripped per role. */
  customFields: CustomFieldValuesSchema,
  // change #19 (D-057)
  source: CallSourceSchema,
  result: CallResultSchema.nullable().describe('null while the call is live'),
  /** Counterpart number normalised to E.164 (used to match leads); null when unknown. */
  phone: PhoneSchema.nullable(),
  /** Android CallLog id (unique per user) for SIM calls. */
  deviceCallId: z.string().nullable(),
  recordingFileId: IdSchema.nullable(),
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
  customFields: CustomFieldValuesSchema.optional().describe('Validated against call field definitions; only the given keys change'),
});
export type CallUpdate = z.infer<typeof CallUpdateSchema>;

export const CallListQuerySchema = CursorPaginationQuerySchema.extend({
  userId: IdSchema.optional(),
  leadId: IdSchema.optional(),
  status: queryArray(CallStatusSchema),
  outcome: queryArray(CallOutcomeSchema),
  source: queryArray(CallSourceSchema),
  result: queryArray(CallResultSchema),
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

// ---------------------------------------------------------------- SIM calls from the Android app (D-057)

/** Raw number as the phone shows it; the server normalises (normalizeIndianPhone for Indian numbers). */
const DevicePhoneSchema = z.string().max(32);

/**
 * One row of the Android call log. Idempotent by (user, deviceCallId): sending the same row again updates
 * it when something changed (duration, result), otherwise it is "unchanged".
 */
export const DeviceCallLogEntrySchema = z.object({
  deviceCallId: z.string().min(1).max(120).describe('Android CallLog._ID; unique per user'),
  clientCallId: z.string().min(8).max(80).optional().describe('Id used in POST /me/calls/active for this call: completes that live row instead of creating a new one'),
  direction: CallDirectionSchema,
  phone: DevicePhoneSchema.describe('"" for private numbers'),
  startedAt: IsoDateTimeSchema,
  answeredAt: IsoDateTimeSchema.nullable().optional(),
  endedAt: IsoDateTimeSchema.nullable().optional(),
  durationSec: z.number().int().min(0).max(86_400),
  result: CallResultSchema,
  leadId: IdSchema.nullable().optional().describe('Lead the call was started from; otherwise matched by phone in the data scope'),
  simSlot: z.number().int().min(0).max(3).nullable().optional(),
});
export type DeviceCallLogEntry = z.infer<typeof DeviceCallLogEntrySchema>;

export const DeviceCallLogBatchSchema = z.object({
  deviceId: IdSchema.optional(),
  entries: z.array(DeviceCallLogEntrySchema).min(1).max(200),
});
export type DeviceCallLogBatch = z.infer<typeof DeviceCallLogBatchSchema>;

export const DeviceCallLogResultSchema = z.object({
  items: z.array(
    z.object({
      deviceCallId: z.string(),
      callId: IdSchema,
      status: z.enum(['created', 'updated', 'unchanged']),
      leadId: IdSchema.nullable(),
    }),
  ),
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
});
export type DeviceCallLogResult = z.infer<typeof DeviceCallLogResultSchema>;

/**
 * Live phone state from the app (POST /me/calls/active): `started` when the dialer opens or a call rings
 * (creates the Call with status in_progress, source sim, emits call.started and sets presence on_call);
 * `ended` at hang-up (status completed until the call log row arrives, emits call.ended). Idempotent by
 * (user, clientCallId).
 */
export const ActiveCallEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('started'),
    clientCallId: z.string().min(8).max(80),
    direction: CallDirectionSchema,
    phone: DevicePhoneSchema,
    startedAt: IsoDateTimeSchema,
    leadId: IdSchema.nullable().optional(),
    deviceId: IdSchema.optional(),
  }),
  z.object({
    event: z.literal('ended'),
    clientCallId: z.string().min(8).max(80),
    endedAt: IsoDateTimeSchema,
  }),
]);
export type ActiveCallEvent = z.infer<typeof ActiveCallEventSchema>;
