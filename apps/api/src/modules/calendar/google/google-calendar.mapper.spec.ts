import { describe, expect, it } from 'vitest';
import type { MeetingRow } from '../calendar.mapper.js';
import { googleEventId, incomingPatch, localDay, meetingIdOf, recurrenceLines, toGoogleEvent } from './google-calendar.mapper.js';

// change #20 (PROD-HUB), D-075. Written for the Kiro Crew run; not executed in this wave.

const ID = '0196f1e2-3a4b-7c5d-8e6f-0123456789ab';

function meeting(over: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: ID,
    workspaceId: 'w',
    title: 'Demo at Shakti',
    description: 'Bring the price list',
    mode: 'in_person',
    location: 'Pune office',
    videoUrl: null,
    startAt: new Date('2026-11-05T05:30:00.000Z'),
    endAt: new Date('2026-11-05T06:30:00.000Z'),
    allDay: false,
    timezone: 'Asia/Kolkata',
    status: 'scheduled',
    organizerId: 'u1',
    leadId: 'l1',
    contactId: null,
    companyId: null,
    dealId: null,
    reminders: [15, 60],
    recurrence: null,
    seriesEndAt: null,
    exceptionDates: [],
    seriesId: null,
    outcome: null,
    cancelReason: null,
    createdById: 'u1',
    version: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    organizer: null,
    attendees: [
      { id: 'a1', workspaceId: 'w', meetingId: ID, userId: 'u1', contactId: null, name: 'Asha', email: 'asha@shakti.in', response: 'accepted', respondedAt: null },
      { id: 'a2', workspaceId: 'w', meetingId: ID, userId: null, contactId: 'c1', name: 'Ravi', email: 'RAVI@buyer.in', response: 'pending', respondedAt: null },
      { id: 'a3', workspaceId: 'w', meetingId: ID, userId: null, contactId: null, name: 'Dup', email: 'ravi@buyer.in', response: 'pending', respondedAt: null },
      { id: 'a4', workspaceId: 'w', meetingId: ID, userId: null, contactId: null, name: 'No mail', email: null, response: 'pending', respondedAt: null },
    ],
    lead: { id: 'l1', name: 'Shakti Traders' },
    contact: null,
    company: null,
    deal: null,
    ...over,
  } as unknown as MeetingRow;
}

describe('Google event ids', () => {
  it('derives a base32hex id from the meeting id and back', () => {
    const eid = googleEventId(ID);
    expect(eid).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(meetingIdOf(eid)).toBe(ID);
    expect(meetingIdOf('abc123')).toBeNull();
    expect(meetingIdOf(`${eid}_20261105T053000Z`)).toBeNull();
  });
});

describe('meeting to Google event', () => {
  it('maps a timed meeting with guests, reminders and Vistar properties', () => {
    const e = toGoogleEvent(meeting(), { workspaceId: 'w', link: 'https://app.vistar.in/app/calendar?meeting=x', reminders: true });
    expect(e.summary).toBe('Demo at Shakti');
    expect(e.start).toEqual({ dateTime: '2026-11-05T05:30:00.000Z', timeZone: 'Asia/Kolkata' });
    expect(e.location).toBe('Pune office');
    expect(e.status).toBe('confirmed');
    expect(e.attendees?.map((a) => a.email)).toEqual(['asha@shakti.in', 'RAVI@buyer.in']);
    expect(e.attendees?.[0]?.responseStatus).toBe('accepted');
    expect(e.reminders?.overrides).toEqual([
      { method: 'popup', minutes: 15 },
      { method: 'popup', minutes: 60 },
    ]);
    expect(e.extendedProperties?.private).toEqual({ vistarMeetingId: ID, vistarWorkspaceId: 'w', vistarVersion: '3' });
    expect(e.description).toContain('Open in Vistar: https://app.vistar.in');
  });

  it('all-day meetings use local dates with an exclusive end', () => {
    const e = toGoogleEvent(meeting({ allDay: true, startAt: new Date('2026-11-04T18:30:00.000Z'), endAt: new Date('2026-11-05T18:30:00.000Z') }), { workspaceId: 'w', link: 'x', reminders: false });
    expect(e.start).toEqual({ date: '2026-11-05' });
    expect(e.end).toEqual({ date: '2026-11-06' });
    expect(e.reminders).toEqual({ useDefault: true });
  });

  it('cancelled meetings are cancelled events; video meetings use the link as location', () => {
    expect(toGoogleEvent(meeting({ status: 'cancelled' }), { workspaceId: 'w', link: 'x', reminders: true }).status).toBe('cancelled');
    expect(toGoogleEvent(meeting({ mode: 'video', videoUrl: 'https://meet.example/abc' }), { workspaceId: 'w', link: 'x', reminders: true }).location).toBe('https://meet.example/abc');
  });

  it('writes RRULE and EXDATE for series', () => {
    const lines = recurrenceLines({ freq: 'weekly', interval: 2, byWeekday: ['mon', 'thu'], count: 10 }, new Date('2026-11-05T05:30:00.000Z'), 'Asia/Kolkata', ['2026-11-19'], false);
    expect(lines).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=10', 'EXDATE;TZID=Asia/Kolkata:20261119T110000']);
    expect(recurrenceLines({ freq: 'daily', interval: 1, until: '2026-12-31' }, new Date(), 'Asia/Kolkata', [], false)).toEqual(['RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20261231T235959Z']);
    expect(recurrenceLines(null, new Date(), 'UTC', [], false)).toEqual([]);
  });

  it('local day in the meeting timezone', () => {
    expect(localDay(new Date('2026-11-04T19:00:00.000Z'), 'Asia/Kolkata')).toBe('2026-11-05');
  });
});

describe('incoming Google changes', () => {
  const m = meeting();
  it('no change for our own push', () => {
    expect(incomingPatch(toGoogleEvent(m, { workspaceId: 'w', link: 'x', reminders: true }), m)).toBeNull();
  });

  it('title, place and time of a single meeting', () => {
    const p = incomingPatch({ summary: 'Demo moved', location: 'Mumbai', start: { dateTime: '2026-11-06T05:30:00Z' }, end: { dateTime: '2026-11-06T06:00:00Z' } }, m);
    expect(p).toEqual({ title: 'Demo moved', location: 'Mumbai', startAt: new Date('2026-11-06T05:30:00Z'), endAt: new Date('2026-11-06T06:00:00Z') });
  });

  it('cancellation; series keep their times', () => {
    expect(incomingPatch({ status: 'cancelled' }, m)).toEqual({ cancel: true });
    expect(incomingPatch({ status: 'cancelled' }, meeting({ status: 'cancelled' }))).toBeNull();
    const series = meeting({ recurrence: { freq: 'daily', interval: 1 } as never });
    expect(incomingPatch({ summary: series.title, location: series.location ?? undefined, start: { dateTime: '2026-11-07T05:30:00Z' }, end: { dateTime: '2026-11-07T06:30:00Z' } }, series)).toBeNull();
  });
});
