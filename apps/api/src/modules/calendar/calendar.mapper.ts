import { RecurrenceSchema, type Meeting, type Recurrence, type TimeOff } from '@vistar/shared';
import { iso, toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ACCOUNT_SUMMARY_SELECT, CONTACT_SUMMARY_SELECT, toAccountSummary, toContactSummary } from '../crm/crm.mapper.js';

export const MEETING_INCLUDE = {
  organizer: { select: USER_SUMMARY_SELECT },
  attendees: { orderBy: { name: 'asc' } },
  lead: { select: { id: true, name: true } },
  contact: { select: CONTACT_SUMMARY_SELECT },
  company: { select: ACCOUNT_SUMMARY_SELECT },
  deal: { select: { id: true, title: true } },
} as const satisfies Prisma.MeetingInclude;
export type MeetingRow = Prisma.MeetingGetPayload<{ include: typeof MEETING_INCLUDE }>;

export const parseRecurrence = (j: unknown): Recurrence | null => {
  if (!j) return null;
  const r = RecurrenceSchema.safeParse(j);
  return r.success ? r.data : null;
};

/** A meeting, or one occurrence of a series (start/end moved to the occurrence, occurrenceStart set). */
export function toMeeting(m: MeetingRow, occurrenceStart: number | null = null): Meeting {
  const duration = m.endAt.getTime() - m.startAt.getTime();
  const start = occurrenceStart ?? m.startAt.getTime();
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    mode: m.mode === 'video' ? 'video' : m.mode === 'phone' ? 'phone' : 'in_person',
    location: m.location,
    videoUrl: m.videoUrl,
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + duration).toISOString(),
    allDay: m.allDay,
    timezone: m.timezone,
    status: m.status,
    organizer: toUserSummary(m.organizer),
    attendees: m.attendees.map((a) => ({ id: a.id, userId: a.userId, contactId: a.contactId, name: a.name, email: a.email, response: a.response, isOrganizer: !!a.userId && a.userId === m.organizerId })),
    lead: m.lead ? { id: m.lead.id, name: m.lead.name } : null,
    contact: toContactSummary(m.contact),
    account: toAccountSummary(m.company),
    deal: m.deal ? { id: m.deal.id, title: m.deal.title } : null,
    reminders: [...m.reminders].sort((a, b) => a - b),
    recurrence: parseRecurrence(m.recurrence),
    exceptionDates: m.exceptionDates,
    occurrenceStart: occurrenceStart !== null && m.recurrence ? new Date(occurrenceStart).toISOString() : null,
    seriesId: m.seriesId,
    outcome: m.outcome,
    cancelReason: m.cancelReason,
    version: m.version,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export const TIME_OFF_INCLUDE = { user: { select: USER_SUMMARY_SELECT } } as const satisfies Prisma.TimeOffInclude;
export type TimeOffRow = Prisma.TimeOffGetPayload<{ include: typeof TIME_OFF_INCLUDE }>;

export function toTimeOff(t: TimeOffRow): TimeOff {
  return {
    id: t.id,
    user: toUserSummary(t.user),
    kind: (['leave', 'holiday', 'training', 'other'] as const).find((k) => k === t.kind) ?? 'other',
    startAt: t.startAt.toISOString(),
    endAt: t.endAt.toISOString(),
    note: t.note,
    createdAt: iso(t.createdAt)!,
  };
}
