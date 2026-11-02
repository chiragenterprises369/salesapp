import { z } from 'zod';
import {
  ClientKindSchema,
  EmployeeStatusSchema,
  ManualPresenceStatusSchema,
  PresenceSourceSchema,
  PresenceStatusSchema,
} from '../enums.js';
import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from './common.js';

/**
 * LIVE STATUS CONTRACT (D-062, SPEC 29.2). Owner of the engine: realtime stream.
 *
 * The server decides the status from observed facts only: sessions (login/logout), heartbeats (web or app
 * open), phone state (POST /me/calls/active from the Android app), call results (device call log,
 * telephony), the employee's own status (PUT /me/status), attendance check-in and working hours.
 * Precedence (highest first): on_call (live call) > manual status (in_meeting, on_break, lunch, field_visit,
 * away, offline) > available (heartbeat within PRESENCE_TIMEOUT_MS) > offline (no heartbeat for 45 s).
 * A call ending restores the previous manual status, otherwise available.
 * Known limits shown in the UI: physical presence at a desk is not observable; outgoing SIM calls are
 * "on call" from dialing (Android does not report the answer), talk time comes from the call log afterwards.
 *
 * Current state: Presence (one row per user). History: PresenceEvent. User.status keeps the coarse
 * EmployeeStatus (presenceToEmployeeStatus) for existing consumers.
 */

export const PresenceActivitySchema = z.object({
  callId: IdSchema.nullable(),
  callStartedAt: IsoDateTimeSchema.nullable(),
  leadId: IdSchema.nullable(),
  leadName: z.string().nullable(),
  /** Last client that sent a heartbeat and what it reported. */
  client: ClientKindSchema.nullable(),
  clientActivity: z.enum(['active', 'idle', 'hidden']).nullable(),
  /** Optional note the employee added to a manual status, e.g. "Client visit, Andheri". */
  note: z.string().nullable(),
});
export type PresenceActivity = z.infer<typeof PresenceActivitySchema>;

export const PresenceSchema = z.object({
  userId: IdSchema,
  status: PresenceStatusSchema,
  /** Coarse status on User / UserSummary (presenceToEmployeeStatus). */
  employeeStatus: EmployeeStatusSchema,
  source: PresenceSourceSchema,
  since: IsoDateTimeSchema,
  manualStatus: ManualPresenceStatusSchema.nullable(),
  lastHeartbeatAt: IsoDateTimeSchema.nullable(),
  /** Last observed activity of any kind (heartbeat, call, check-in); shown as "last seen". */
  lastSeenAt: IsoDateTimeSchema.nullable(),
  activity: PresenceActivitySchema,
});
export type Presence = z.infer<typeof PresenceSchema>;

export const MyPresenceSchema = PresenceSchema.extend({
  heartbeatIntervalSec: z.number().int(),
  timeoutSec: z.number().int(),
  insideWorkingHours: z.boolean(),
});
export type MyPresence = z.infer<typeof MyPresenceSchema>;

/** POST /me/presence/heartbeat (also accepted over the socket as `presence.heartbeat`). */
export const PresenceHeartbeatSchema = z.object({
  client: ClientKindSchema,
  activity: z.enum(['active', 'idle', 'hidden']),
  currentLeadId: IdSchema.nullable().optional(),
  /** Android: whether the app is in the foreground. */
  appState: z.enum(['foreground', 'background']).optional(),
});
export type PresenceHeartbeat = z.infer<typeof PresenceHeartbeatSchema>;

export const PresenceEventSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  status: PresenceStatusSchema,
  previousStatus: PresenceStatusSchema.nullable(),
  source: PresenceSourceSchema,
  callId: IdSchema.nullable(),
  at: IsoDateTimeSchema,
});
export type PresenceEvent = z.infer<typeof PresenceEventSchema>;

export const PresenceHistoryQuerySchema = z.object({
  date: IsoDateSchema.optional().describe('Workspace-timezone day; default today'),
});

/** Per-person live details on the Team Floor snapshot (TeamFloorEmployee.presence). */
export const TeamFloorPresenceSchema = PresenceSchema.omit({ userId: true }).extend({
  /** Seat id on the published custom floor (FloorSeat.id); null on the default template (use deskIndex). */
  seatId: z.string().nullable(),
  isFieldStaff: z.boolean(),
  checkedIn: z.boolean(),
});
export type TeamFloorPresence = z.infer<typeof TeamFloorPresenceSchema>;
