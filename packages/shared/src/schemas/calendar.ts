import { z } from 'zod';
import { AttendeeResponseSchema, MeetingModeSchema, MeetingStatusSchema, PresenceStatusSchema, RecurrenceFrequencySchema, TimeOffKindSchema, type RecurrenceFrequency } from '../enums.js';
import { IdSchema, IsoDateSchema, IsoDateTimeSchema, queryArray } from './common.js';
import { AccountSummarySchema, ContactSummarySchema, LeadRefSchema } from './crm.js';
import { UserSummarySchema, WeekdaySchema, type Weekday } from './workspace.js';

/**
 * CALENDAR AND MEETINGS (change #19 wave B, SPEC 29.9).
 * - A meeting has an organizer (data scope applies through organizerId and attendee users), attendees
 *   (team members, contacts or guests), optional links to a lead, contact, account and deal, a place or a
 *   video link, reminders (minutes before the start; a notification `meeting_reminder` plus the event
 *   `meeting.reminder` to each attending user) and a simple recurrence.
 * - Recurrence: daily | weekly (on weekdays) | monthly (same day of month), every `interval`, ending
 *   after `count` occurrences or on `until` (default and maximum: 2 years). GET /meetings expands
 *   occurrences inside the requested range (`occurrenceStart` set). Editing with scope `occurrence`
 *   detaches that occurrence into its own meeting (the series gets an exception date); cancelling one
 *   occurrence adds an exception date.
 * - Availability: working hours (User.workingHours ?? workspace hours), busy blocks (meetings,
 *   time off) and the live presence status, for the calendar and for lead routing.
 */

export const RecurrenceSchema = z
  .object({
    freq: RecurrenceFrequencySchema,
    interval: z.number().int().min(1).max(30).default(1),
    /** weekly only; default = the weekday of the first start */
    byWeekday: z.array(WeekdaySchema).max(7).optional(),
    count: z.number().int().min(1).max(366).optional(),
    until: IsoDateSchema.optional(),
  })
  .refine((r) => !(r.count && r.until), { error: 'Use either an end date or a number of occurrences' });
export type Recurrence = z.infer<typeof RecurrenceSchema>;

/** Maximum span of a series and of one GET /meetings range. */
export const MAX_SERIES_DAYS = 731;
export const MAX_CALENDAR_RANGE_DAYS = 62;
export const MAX_REMINDERS = 5;

export const MeetingAttendeeSchema = z.object({
  id: IdSchema,
  userId: IdSchema.nullable(),
  contactId: IdSchema.nullable(),
  name: z.string(),
  email: z.string().nullable(),
  response: AttendeeResponseSchema,
  isOrganizer: z.boolean(),
});
export type MeetingAttendee = z.infer<typeof MeetingAttendeeSchema>;

export const MeetingSchema = z.object({
  id: IdSchema.describe('Series id for expanded occurrences'),
  title: z.string(),
  description: z.string().nullable(),
  mode: MeetingModeSchema,
  location: z.string().nullable(),
  videoUrl: z.string().nullable(),
  startAt: IsoDateTimeSchema.describe('Start of this occurrence'),
  endAt: IsoDateTimeSchema,
  allDay: z.boolean(),
  timezone: z.string(),
  status: MeetingStatusSchema,
  organizer: UserSummarySchema.nullable(),
  attendees: z.array(MeetingAttendeeSchema),
  lead: LeadRefSchema.nullable(),
  contact: ContactSummarySchema.nullable(),
  account: AccountSummarySchema.nullable(),
  deal: z.object({ id: IdSchema, title: z.string() }).nullable(),
  reminders: z.array(z.number().int()),
  recurrence: RecurrenceSchema.nullable(),
  exceptionDates: z.array(IsoDateSchema),
  /** Set on expanded occurrences of a series (the original start of that occurrence). */
  occurrenceStart: IsoDateTimeSchema.nullable(),
  /** A detached occurrence points at its series. */
  seriesId: IdSchema.nullable(),
  outcome: z.string().nullable(),
  cancelReason: z.string().nullable(),
  version: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Meeting = z.infer<typeof MeetingSchema>;

const MeetingInputFields = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable(),
  mode: MeetingModeSchema,
  location: z.string().trim().max(300).nullable(),
  videoUrl: z.url().max(500).nullable(),
  startAt: IsoDateTimeSchema,
  endAt: IsoDateTimeSchema,
  allDay: z.boolean(),
  timezone: z.string().max(60).describe('IANA zone; default the workspace timezone'),
  organizerId: IdSchema.describe('Default: the caller; others need calendar.update and scope'),
  attendeeUserIds: z.array(IdSchema).max(50),
  attendeeContactIds: z.array(IdSchema).max(50),
  guests: z.array(z.object({ name: z.string().trim().min(1).max(120), email: z.email().nullable().default(null) })).max(20),
  leadId: IdSchema.nullable(),
  contactId: IdSchema.nullable(),
  accountId: IdSchema.nullable(),
  dealId: IdSchema.nullable(),
  reminders: z.array(z.number().int().min(0).max(10_080)).max(MAX_REMINDERS),
  recurrence: RecurrenceSchema.nullable(),
});

const timeOrder = (m: { startAt?: string; endAt?: string }) => !m.startAt || !m.endAt || Date.parse(m.endAt) > Date.parse(m.startAt);

export const MeetingCreateSchema = MeetingInputFields.partial()
  .extend({
    title: z.string().trim().min(1).max(160),
    startAt: IsoDateTimeSchema,
    endAt: IsoDateTimeSchema,
    mode: MeetingModeSchema.default('in_person'),
    allDay: z.boolean().default(false),
    attendeeUserIds: z.array(IdSchema).max(50).default([]),
    attendeeContactIds: z.array(IdSchema).max(50).default([]),
    guests: z.array(z.object({ name: z.string().trim().min(1).max(120), email: z.email().nullable().default(null) })).max(20).default([]),
    reminders: z.array(z.number().int().min(0).max(10_080)).max(MAX_REMINDERS).default([15]),
  })
  .refine(timeOrder, { error: 'The end must be after the start', path: ['endAt'] });
export type MeetingCreate = z.infer<typeof MeetingCreateSchema>;

/**
 * Patch a meeting. For a recurring meeting, `scope: 'occurrence'` + `occurrenceStart` edits one
 * occurrence (detached into its own meeting); the default `series` edits the whole series.
 * Drag to reschedule = PATCH { startAt, endAt } (with scope occurrence for one occurrence).
 */
export const MeetingUpdateSchema = MeetingInputFields.partial()
  .extend({
    status: MeetingStatusSchema.optional(),
    outcome: z.string().trim().max(4000).nullable().optional(),
    scope: z.enum(['series', 'occurrence']).default('series'),
    occurrenceStart: IsoDateTimeSchema.optional(),
    expectedVersion: z.number().int().optional(),
  })
  .refine(timeOrder, { error: 'The end must be after the start', path: ['endAt'] })
  .refine((m) => m.scope !== 'occurrence' || !!m.occurrenceStart, { error: 'Say which occurrence to change', path: ['occurrenceStart'] });
export type MeetingUpdate = z.infer<typeof MeetingUpdateSchema>;

export const MeetingCancelSchema = z.object({
  occurrenceStart: IsoDateTimeSchema.optional().describe('Cancel one occurrence of a series; omitted = the whole meeting'),
  reason: z.string().trim().max(500).nullable().optional(),
});
export type MeetingCancel = z.infer<typeof MeetingCancelSchema>;

export const MeetingRespondSchema = z.object({ response: AttendeeResponseSchema.exclude(['pending']) });
export type MeetingRespond = z.infer<typeof MeetingRespondSchema>;

/** Range is required (at most MAX_CALENDAR_RANGE_DAYS). userId omitted = the caller's calendar; 'all' = everyone in scope. */
export const MeetingListQuerySchema = z.object({
  from: IsoDateTimeSchema,
  to: IsoDateTimeSchema,
  userId: queryArray(z.union([IdSchema, z.literal('me'), z.literal('all')])),
  leadId: IdSchema.optional(),
  contactId: IdSchema.optional(),
  accountId: IdSchema.optional(),
  dealId: IdSchema.optional(),
  status: queryArray(MeetingStatusSchema),
});
export type MeetingListQuery = z.infer<typeof MeetingListQuerySchema>;

// ---------------------------------------------------------------- time off and availability

export const TimeOffSchema = z.object({
  id: IdSchema,
  user: UserSummarySchema,
  kind: TimeOffKindSchema,
  startAt: IsoDateTimeSchema,
  endAt: IsoDateTimeSchema,
  note: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type TimeOff = z.infer<typeof TimeOffSchema>;

/** Own time off needs calendar.create; for someone else team.manage (and scope). */
export const TimeOffCreateSchema = z
  .object({
    userId: IdSchema.optional(),
    kind: TimeOffKindSchema.default('leave'),
    startAt: IsoDateTimeSchema,
    endAt: IsoDateTimeSchema,
    note: z.string().trim().max(300).nullable().optional(),
  })
  .refine(timeOrder, { error: 'The end must be after the start', path: ['endAt'] });
export type TimeOffCreate = z.infer<typeof TimeOffCreateSchema>;

export const TimeOffListQuerySchema = z.object({
  userId: queryArray(z.union([IdSchema, z.literal('me')])),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});
export type TimeOffListQuery = z.infer<typeof TimeOffListQuerySchema>;

export const AvailabilityQuerySchema = z.object({
  userId: queryArray(z.union([IdSchema, z.literal('me')])).describe('Omitted = everyone in scope (max 100)'),
  from: IsoDateTimeSchema,
  to: IsoDateTimeSchema,
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

export const IntervalSchema = z.object({ start: IsoDateTimeSchema, end: IsoDateTimeSchema });
export type Interval = z.infer<typeof IntervalSchema>;

export const UserAvailabilitySchema = z.object({
  user: UserSummarySchema,
  /** Working-hour intervals inside the range (workspace holidays removed). */
  workingHours: z.array(IntervalSchema),
  busy: z.array(
    IntervalSchema.extend({
      kind: z.enum(['meeting', 'time_off']),
      /** null when the caller may not see the meeting */
      title: z.string().nullable(),
      meetingId: IdSchema.nullable(),
    }),
  ),
  presence: PresenceStatusSchema.nullable().describe('Live status now (null = unknown)'),
  /** Inside working hours, not on time off, not in a meeting, and not offline right now. */
  availableNow: z.boolean(),
});
export type UserAvailability = z.infer<typeof UserAvailabilitySchema>;

// ---------------------------------------------------------------- recurrence expansion (pure; API and web)

const WEEKDAY_INDEX: Record<Weekday, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY = 86_400_000;

/**
 * Occurrence starts (ms) of a series that overlap [from, to). Steps are in whole days in UTC (a series
 * keeps its wall-clock time in IST, which has no daylight saving). `exceptions` are YYYY-MM-DD dates
 * (of the occurrence start in UTC+05:30) that are skipped. Hard cap: 2 years and 1 000 occurrences.
 */
export function expandOccurrences(
  series: { startAt: number; durationMs: number; recurrence: Recurrence | null; exceptionDates?: readonly string[] },
  from: number,
  to: number,
  tzOffsetMinutes = 330,
): number[] {
  const { startAt, durationMs, recurrence } = series;
  const out: number[] = [];
  const skip = new Set(series.exceptionDates ?? []);
  const localDate = (ms: number) => new Date(ms + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
  const push = (ms: number) => {
    if (ms + durationMs > from && ms < to && !skip.has(localDate(ms))) out.push(ms);
  };
  if (!recurrence) {
    push(startAt);
    return out;
  }
  const limit = Math.min(recurrence.until ? Date.parse(`${recurrence.until}T23:59:59.999Z`) - tzOffsetMinutes * 60_000 : Infinity, startAt + MAX_SERIES_DAYS * DAY);
  const maxCount = recurrence.count ?? 1000;
  const interval = recurrence.interval ?? 1;
  let n = 0;
  const step = (freq: RecurrenceFrequency, i: number): number => {
    if (freq === 'daily') return startAt + i * interval * DAY;
    const d = new Date(startAt);
    d.setUTCMonth(d.getUTCMonth() + i * interval);
    return d.getTime();
  };
  if (recurrence.freq === 'weekly') {
    const startLocal = new Date(startAt + tzOffsetMinutes * 60_000);
    const startDow = startLocal.getUTCDay();
    const days = (recurrence.byWeekday?.length ? recurrence.byWeekday.map((w) => WEEKDAY_INDEX[w]) : [startDow]).sort((a, b) => a - b);
    const weekStart = startAt - startDow * DAY;
    for (let w = 0; n < maxCount; w += interval) {
      const base = weekStart + w * 7 * DAY;
      if (base > limit || base > to) break;
      for (const dow of days) {
        const ms = base + dow * DAY;
        if (ms < startAt) continue;
        if (ms > limit || n >= maxCount) break;
        n++;
        push(ms);
      }
    }
    return out;
  }
  for (let i = 0; n < maxCount; i++) {
    const ms = step(recurrence.freq, i);
    if (ms > limit || ms > to) break;
    // monthly on the 29th-31st: skip months without that day (setUTCMonth overflows into the next month)
    if (recurrence.freq === 'monthly' && new Date(ms).getUTCDate() !== new Date(startAt).getUTCDate()) continue;
    n++;
    push(ms);
  }
  return out;
}

/** End of the last occurrence (ms), for range queries; null for a single meeting. */
export function seriesEnd(series: { startAt: number; durationMs: number; recurrence: Recurrence | null }, tzOffsetMinutes = 330): number | null {
  if (!series.recurrence) return null;
  const all = expandOccurrences({ ...series, exceptionDates: [] }, series.startAt, series.startAt + MAX_SERIES_DAYS * DAY + 1, tzOffsetMinutes);
  const last = all.at(-1) ?? series.startAt;
  return last + series.durationMs;
}
