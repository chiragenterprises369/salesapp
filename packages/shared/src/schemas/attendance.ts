import { z } from 'zod';
import { PresenceStatusSchema } from '../enums.js';
import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from './common.js';
import { TimeSlotSchema, UserSummarySchema, WEEKDAYS, type BusinessHours, type Weekday } from './workspace.js';

/**
 * ATTENDANCE AND FIELD TRACKING (D-063, SPEC 29.1). Owner of the routes: realtime stream.
 *
 * Applies to users with `User.isFieldStaff` (set by a company admin) in companies with the `field_tracking`
 * feature flag. Location is accepted only while the user is checked in AND inside working hours
 * (User.workingHours, else Workspace.businessHours, in Workspace.timezone, holidays closed); points outside
 * are rejected per point, never stored. The app stops its foreground service outside working hours using
 * the same rule (isWithinWorkingHours). Tracking consent (TrackingConsent, version TRACKING_CONSENT_VERSION)
 * is required before the first check-in.
 */

export const TRACKING_CONSENT_VERSION = '2026-11-v1';
/** Interval the app should use for location points while tracking. */
export const LOCATION_INTERVAL_SEC = 120;
/** Points older than this are rejected (too_old); the app keeps at most this much offline backlog. */
export const LOCATION_MAX_AGE_SEC = 24 * 3600;

export const GeoFixSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Horizontal accuracy in metres. */
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
});
export type GeoFix = z.infer<typeof GeoFixSchema>;

export const AttendanceCheckSchema = GeoFixSchema.extend({
  deviceId: IdSchema.optional(),
  note: z.string().trim().max(200).optional(),
});
export type AttendanceCheck = z.infer<typeof AttendanceCheckSchema>;

export const AttendanceSessionSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  /** Workspace-timezone day of the check-in. */
  date: IsoDateSchema,
  checkInAt: IsoDateTimeSchema,
  checkIn: GeoFixSchema.extend({ accuracy: z.number().nullable() }),
  checkOutAt: IsoDateTimeSchema.nullable(),
  checkOut: GeoFixSchema.extend({ accuracy: z.number().nullable() }).nullable(),
  /** manual = the employee; end_of_day = closed by the server after working hours; admin = closed by an admin. */
  checkOutReason: z.enum(['manual', 'end_of_day', 'admin']).nullable(),
  workedMin: z.number().int().min(0),
  pointCount: z.number().int().min(0),
});
export type AttendanceSession = z.infer<typeof AttendanceSessionSchema>;

export const LocationPointSchema = GeoFixSchema.extend({
  at: IsoDateTimeSchema.describe('Device time of the fix'),
  speed: z.number().min(0).max(150).nullable().optional().describe('m/s'),
  heading: z.number().min(0).max(360).nullable().optional(),
  battery: z.number().int().min(0).max(100).nullable().optional(),
  isMock: z.boolean().optional().describe('Android mock-location flag; such points are rejected'),
});
export type LocationPoint = z.infer<typeof LocationPointSchema>;

/** POST /me/location: idempotent per (user, at); duplicates are counted, not stored twice. */
export const LocationBatchSchema = z.object({
  deviceId: IdSchema.optional(),
  points: z.array(LocationPointSchema).min(1).max(500),
});
export type LocationBatch = z.infer<typeof LocationBatchSchema>;

export const LOCATION_REJECT_REASONS = ['outside_working_hours', 'not_checked_in', 'too_old', 'in_future', 'mock_location', 'tracking_disabled'] as const;
export const LocationBatchResultSchema = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  rejected: z.array(z.object({ at: IsoDateTimeSchema, reason: z.enum(LOCATION_REJECT_REASONS) })),
});
export type LocationBatchResult = z.infer<typeof LocationBatchResultSchema>;

export const TrackingConsentSchema = z.object({
  accepted: z.boolean(),
  version: z.string().nullable(),
  at: IsoDateTimeSchema.nullable(),
  /** Version the app must show; re-consent when it differs from `version`. */
  currentVersion: z.string(),
});
export type TrackingConsent = z.infer<typeof TrackingConsentSchema>;

export const TrackingConsentUpdateSchema = z.object({
  accepted: z.boolean(),
  version: z.string().min(1).max(40),
  deviceId: IdSchema.optional(),
});

export const MyAttendanceTodaySchema = z.object({
  date: IsoDateSchema,
  timezone: z.string(),
  isFieldStaff: z.boolean(),
  /** Effective `field_tracking` flag of the company. */
  trackingEnabled: z.boolean(),
  consent: TrackingConsentSchema,
  workingHours: z.array(TimeSlotSchema).describe('Today; [] = closed or holiday'),
  insideWorkingHours: z.boolean(),
  /** Open session (checked in) or null. */
  session: AttendanceSessionSchema.nullable(),
  sessions: z.array(AttendanceSessionSchema).describe('All sessions of today, oldest first'),
  /** The app should send location now: field staff, flag on, consent, checked in, inside working hours. */
  trackingActive: z.boolean(),
  locationIntervalSec: z.number().int(),
});
export type MyAttendanceToday = z.infer<typeof MyAttendanceTodaySchema>;

export const AttendanceRegisterQuerySchema = z.object({
  date: IsoDateSchema.optional().describe('Default today (workspace timezone)'),
  teamId: IdSchema.optional(),
  fieldStaffOnly: z.stringbool().optional(),
});

export const AttendanceRegisterRowSchema = z.object({
  user: UserSummarySchema,
  isFieldStaff: z.boolean(),
  status: z.enum(['present', 'checked_out', 'absent', 'holiday', 'off_day']),
  firstCheckInAt: IsoDateTimeSchema.nullable(),
  lastCheckOutAt: IsoDateTimeSchema.nullable(),
  workedMin: z.number().int(),
  sessions: z.array(AttendanceSessionSchema),
});

/** Company attendance register for one day; data scope applies (managers: their team). */
export const AttendanceRegisterSchema = z.object({
  date: IsoDateSchema,
  timezone: z.string(),
  items: z.array(AttendanceRegisterRowSchema),
  summary: z.object({ present: z.number().int(), checkedOut: z.number().int(), absent: z.number().int() }),
});
export type AttendanceRegister = z.infer<typeof AttendanceRegisterSchema>;

export const FieldLiveQuerySchema = z.object({ teamId: IdSchema.optional() });

export const FieldLivePositionSchema = z.object({
  user: UserSummarySchema,
  sessionId: IdSchema,
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().nullable(),
  at: IsoDateTimeSchema,
  battery: z.number().int().nullable(),
  presence: PresenceStatusSchema.nullable(),
  /** No point for more than 2 x LOCATION_INTERVAL_SEC. */
  stale: z.boolean(),
});

/** Last known position of every checked-in field staff member in scope. */
export const FieldLiveSchema = z.object({ items: z.array(FieldLivePositionSchema), generatedAt: IsoDateTimeSchema });
export type FieldLive = z.infer<typeof FieldLiveSchema>;

export const FieldRouteQuerySchema = z.object({ date: IsoDateSchema.optional() });

export const FieldRouteSchema = z.object({
  user: UserSummarySchema,
  date: IsoDateSchema,
  sessions: z.array(AttendanceSessionSchema),
  points: z.array(LocationPointSchema.extend({ sessionId: IdSchema })).max(5000).describe('Oldest first'),
  distanceM: z.number().int(),
});
export type FieldRoute = z.infer<typeof FieldRouteSchema>;

// ---------------------------------------------------------------- working hours (shared rule)

const WEEKDAY_BY_SHORT: Record<string, Weekday> = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' };

/** Local date (YYYY-MM-DD), weekday and minutes since midnight of `at` in `timezone`. */
export function localClock(at: Date, timezone: string): { date: string; weekday: Weekday; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = WEEKDAY_BY_SHORT[get('weekday')] ?? WEEKDAYS[0];
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Today's slots for `at` (empty on holidays and closed days). Slots must not cross midnight (end > start). */
export function workingSlotsAt(hours: BusinessHours, timezone: string, at: Date, holidays: ReadonlyArray<{ date: string }> = []) {
  const clock = localClock(at, timezone);
  const holiday = holidays.some((h) => h.date === clock.date);
  return { ...clock, holiday, slots: holiday ? [] : (hours[clock.weekday] ?? []) };
}

/** True when `at` falls inside a working slot (start inclusive, end exclusive) in the workspace timezone. */
export function isWithinWorkingHours(hours: BusinessHours, timezone: string, at: Date, holidays: ReadonlyArray<{ date: string }> = []): boolean {
  const { slots, minutes } = workingSlotsAt(hours, timezone, at, holidays);
  return slots.some((s) => minutes >= toMinutes(s.start) && minutes < toMinutes(s.end));
}
