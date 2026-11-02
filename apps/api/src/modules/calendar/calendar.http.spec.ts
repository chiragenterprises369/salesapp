import { MeetingSchema } from '@vistar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * Calendar over HTTP (change #19 wave B): meetings with attendees and lead links, weekly recurrence expanded in
 * ranges, one occurrence rescheduled (detached) and one cancelled, respond, data scope, availability with time
 * off, reminder scan. Run: `pnpm --filter @vistar/api test calendar.http`.
 */
let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let emp: { userId: string; token: string };
let other: { userId: string; token: string };
const DAY = 86_400_000;
/** Next Monday 10:00 IST (04:30Z), at least a day ahead. */
const start = (() => {
  const d = new Date(Date.now() + 2 * DAY);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(4, 30, 0, 0);
  return d.getTime();
})();

beforeAll(async () => {
  h = await createHarness('cal');
  a = await h.workspace('a');
  emp = await h.member(a.workspaceId, 'employee', 'cal-emp');
  other = await h.member(a.workspaceId, 'employee', 'cal-other');
}, 90_000);

afterAll(async () => {
  await h?.close();
});

describe('meetings', () => {
  let seriesId = '';

  it('creates a weekly series and expands it in a range', async () => {
    const res = await h.api().post('/api/v1/meetings').set(bearer(emp.token)).send({
      title: 'Weekly review',
      startAt: new Date(start).toISOString(),
      endAt: new Date(start + 45 * 60_000).toISOString(),
      mode: 'video',
      videoUrl: 'https://meet.example.test/abc',
      attendeeUserIds: [a.adminId],
      recurrence: { freq: 'weekly', count: 3 },
      reminders: [10, 60],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const m = MeetingSchema.parse(res.body);
    seriesId = m.id;
    expect(m.attendees.map((x) => x.userId)).toEqual(expect.arrayContaining([emp.userId, a.adminId]));
    const list = await h.api().get(`/api/v1/meetings?from=${new Date(start - DAY).toISOString()}&to=${new Date(start + 30 * DAY).toISOString()}`).set(bearer(emp.token));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const occ = list.body.items.filter((x: { id: string }) => x.id === seriesId);
    expect(occ).toHaveLength(3);
    expect(occ[1].startAt).toBe(new Date(start + 7 * DAY).toISOString());
  });

  it('reschedules one occurrence (detached) and cancels another', async () => {
    const second = new Date(start + 7 * DAY).toISOString();
    const moved = await h.api().patch(`/api/v1/meetings/${seriesId}`).set(bearer(emp.token)).send({ scope: 'occurrence', occurrenceStart: second, startAt: new Date(start + 7 * DAY + 2 * 3_600_000).toISOString() });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.seriesId).toBe(seriesId);
    const third = new Date(start + 14 * DAY).toISOString();
    expect((await h.api().post(`/api/v1/meetings/${seriesId}/cancel`).set(bearer(emp.token)).send({ occurrenceStart: third })).status).toBe(200);
    const list = await h.api().get(`/api/v1/meetings?from=${new Date(start - DAY).toISOString()}&to=${new Date(start + 30 * DAY).toISOString()}`).set(bearer(emp.token));
    const ids = list.body.items.map((x: { id: string }) => x.id);
    expect(ids.filter((id: string) => id === seriesId)).toHaveLength(1);
    expect(ids).toContain(moved.body.id);
  });

  it('attendees can respond; other employees cannot see or edit it', async () => {
    const res = await h.api().post(`/api/v1/meetings/${seriesId}/respond`).set(bearer(a.token)).send({ response: 'accepted' });
    expect(res.body.attendees.find((x: { userId: string }) => x.userId === a.adminId).response).toBe('accepted');
    expect((await h.api().get(`/api/v1/meetings/${seriesId}`).set(bearer(other.token))).status).toBe(404);
    expect((await h.api().patch(`/api/v1/meetings/${seriesId}`).set(bearer(other.token)).send({ title: 'x' })).status).toBe(404);
  });

  it('ranges longer than 62 days are rejected', async () => {
    const res = await h.api().get(`/api/v1/meetings?from=${new Date(start).toISOString()}&to=${new Date(start + 70 * DAY).toISOString()}`).set(bearer(emp.token));
    expect(res.status).toBe(400);
  });

  it('availability shows meetings and time off as busy', async () => {
    const off = await h.api().post('/api/v1/time-off').set(bearer(emp.token)).send({ kind: 'leave', startAt: new Date(start + DAY).toISOString(), endAt: new Date(start + 2 * DAY).toISOString() });
    expect(off.status, JSON.stringify(off.body)).toBe(201);
    expect((await h.api().post('/api/v1/time-off').set(bearer(emp.token)).send({ userId: other.userId, startAt: new Date(start).toISOString(), endAt: new Date(start + DAY).toISOString() })).status).toBe(403);
    const res = await h.api().get(`/api/v1/calendar/availability?userId=${emp.userId}&from=${new Date(start - DAY).toISOString()}&to=${new Date(start + 3 * DAY).toISOString()}`).set(bearer(a.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const kinds = res.body.items[0].busy.map((b: { kind: string }) => b.kind);
    expect(kinds).toEqual(expect.arrayContaining(['meeting', 'time_off']));
    expect(res.body.items[0].workingHours.length).toBeGreaterThan(0);
  });
});
