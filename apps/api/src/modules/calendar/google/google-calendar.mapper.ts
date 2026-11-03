import type { Recurrence } from '@vistar/shared';
import { safeTimezone, zonedParts } from '../../leads/lib/tz.js';
import { parseRecurrence, type MeetingRow } from '../calendar.mapper.js';

/**
 * Pure mapping between Vistar meetings and Google Calendar events (change #20, D-075). Vistar picks the Google
 * event id itself: "vst" + the meeting UUID without dashes (Google allows base32hex ids a-v and 0-9, 5 to 1024
 * characters; hex digits are inside that set). So no extra column is needed to find the event of a meeting, and an
 * incoming change maps back to its meeting by id.
 */

const PREFIX = 'vst';

export function googleEventId(meetingId: string): string {
  return `${PREFIX}${meetingId.replace(/-/g, '').toLowerCase()}`;
}

/** Meeting id of a Vistar-made Google event id, else null. Recurring instances ("<id>_<time>") return null. */
export function meetingIdOf(eventId: string): string | null {
  const m = /^vst([0-9a-f]{32})$/.exec(eventId);
  if (!m) return null;
  const h = m[1]!;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const BYDAY: Record<string, string> = { mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU' };

const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock parts of an instant in a timezone. */
function local(at: Date, tz: string) {
  return zonedParts(at, safeTimezone(tz));
}

/** YYYY-MM-DD in the timezone. */
export function localDay(at: Date, tz: string): string {
  const p = local(at, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** RRULE and EXDATE lines for a Vistar recurrence (exception dates are local days of cancelled or moved occurrences). */
export function recurrenceLines(r: Recurrence | null, start: Date, tz: string, exceptionDates: readonly string[], allDay: boolean): string[] {
  if (!r) return [];
  const parts = [`FREQ=${r.freq.toUpperCase()}`, `INTERVAL=${r.interval ?? 1}`];
  if (r.freq === 'weekly' && r.byWeekday?.length) parts.push(`BYDAY=${r.byWeekday.map((d) => BYDAY[d]).filter(Boolean).join(',')}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  else if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}T235959Z`);
  const lines = [`RRULE:${parts.join(';')}`];
  if (exceptionDates.length) {
    const p = local(start, tz);
    const time = `T${pad(p.hour)}${pad(p.minute)}00`;
    const dates = [...exceptionDates].sort().map((d) => d.replace(/-/g, ''));
    lines.push(allDay ? `EXDATE;VALUE=DATE:${dates.join(',')}` : `EXDATE;TZID=${safeTimezone(tz)}:${dates.map((d) => `${d}${time}`).join(',')}`);
  }
  return lines;
}

export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  recurrence?: string[];
  recurringEventId?: string;
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string; organizer?: boolean; optional?: boolean }>;
  reminders?: { useDefault: boolean; overrides?: Array<{ method: 'popup' | 'email'; minutes: number }> };
  extendedProperties?: { private?: Record<string, string> };
  source?: { title: string; url: string };
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  htmlLink?: string;
  updated?: string;
}

const RESPONSE: Record<string, string> = { pending: 'needsAction', accepted: 'accepted', declined: 'declined', tentative: 'tentative' };
const MARKER = '\n\n-- Vistar';

/** Google event body for a meeting (insert or full update). `link` = the meeting in the Vistar web app. */
export function toGoogleEvent(m: MeetingRow, opts: { workspaceId: string; link: string; reminders: boolean }): GoogleEvent {
  const tz = safeTimezone(m.timezone);
  const recurrence = parseRecurrence(m.recurrence);
  const start: GoogleEventTime = m.allDay ? { date: localDay(m.startAt, tz) } : { dateTime: m.startAt.toISOString(), timeZone: tz };
  // all-day end is exclusive in Google: the day after the last local day
  const end: GoogleEventTime = m.allDay ? { date: addDays(localDay(new Date(Math.max(m.startAt.getTime(), m.endAt.getTime() - 1)), tz), 1) } : { dateTime: m.endAt.toISOString(), timeZone: tz };
  const footer = [m.mode === 'video' && m.videoUrl ? `Video: ${m.videoUrl}` : null, m.lead ? `Lead: ${m.lead.name}` : null, `Open in Vistar: ${opts.link}`].filter(Boolean).join('\n');
  const seen = new Set<string>();
  const attendees = m.attendees
    .filter((a) => !!a.email && !seen.has(a.email.toLowerCase()) && seen.add(a.email.toLowerCase()))
    .slice(0, 100)
    .map((a) => ({ email: a.email!, displayName: a.name, responseStatus: RESPONSE[a.response] ?? 'needsAction', ...(a.userId && a.userId === m.organizerId ? { organizer: false } : {}) }));
  return {
    summary: m.title.slice(0, 1024),
    description: `${(m.description ?? '').slice(0, 7000)}${MARKER}\n${footer}`.trim(),
    location: (m.mode === 'video' ? (m.videoUrl ?? m.location) : m.location) ?? undefined,
    start,
    end,
    ...(recurrence ? { recurrence: recurrenceLines(recurrence, m.startAt, tz, m.exceptionDates, m.allDay) } : {}),
    status: m.status === 'cancelled' ? 'cancelled' : 'confirmed',
    attendees,
    reminders: opts.reminders ? { useDefault: false, overrides: [...new Set(m.reminders)].filter((n) => n >= 0 && n <= 40_320).slice(0, 5).map((minutes) => ({ method: 'popup' as const, minutes })) } : { useDefault: true },
    extendedProperties: { private: { vistarMeetingId: m.id, vistarWorkspaceId: opts.workspaceId, vistarVersion: String(m.version) } },
    source: { title: 'Vistar', url: opts.link },
    guestsCanModify: false,
    guestsCanInviteOthers: false,
  };
}

/** Instant of a Google event time (all-day = local midnight in the meeting timezone, approximated as UTC midnight). */
function instantOf(t: GoogleEventTime | undefined): Date | null {
  if (!t) return null;
  if (t.dateTime) {
    const d = new Date(t.dateTime);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export interface IncomingPatch {
  title?: string;
  location?: string | null;
  startAt?: Date;
  endAt?: Date;
  cancel?: boolean;
}

/**
 * What changed in Google compared with the meeting: title, location, start and end (single timed meetings only:
 * series and all-day meetings keep their times from Vistar), cancellation. Null when nothing changed (our own push
 * coming back through the incremental sync).
 */
export function incomingPatch(e: GoogleEvent, m: MeetingRow): IncomingPatch | null {
  if (e.status === 'cancelled') return m.status === 'cancelled' ? null : { cancel: true };
  const patch: IncomingPatch = {};
  if (typeof e.summary === 'string' && e.summary.trim() && e.summary.trim() !== m.title) patch.title = e.summary.trim().slice(0, 200);
  if (m.mode !== 'video' && (e.location ?? null) !== (m.location ?? null)) patch.location = e.location ? e.location.slice(0, 300) : null;
  if (!m.allDay && !m.recurrence) {
    const s = instantOf(e.start);
    const en = instantOf(e.end);
    if (s && en && en > s) {
      if (s.getTime() !== m.startAt.getTime()) patch.startAt = s;
      if (en.getTime() !== m.endAt.getTime()) patch.endAt = en;
    }
  }
  return Object.keys(patch).length ? patch : null;
}
