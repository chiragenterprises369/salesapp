import type { AttendanceRegister, AttendanceSession, FieldLive, FieldRoute, UserSummary } from '@vistar/shared';
import { mockUsers } from '@vistar/shared/fixtures';

/**
 * TEST-ONLY attendance data for the mock data mode (NEXT_PUBLIC_DATA_SOURCE=mock, automated tests).
 * Never used in API mode. Deterministic: three field staff around Mumbai, one checked out.
 */
const BASES: Array<[number, number]> = [
  [19.076, 72.8777],
  [19.1136, 72.8697],
  [19.0176, 72.8562],
];

function fieldStaff(): UserSummary[] {
  return mockUsers()
    .filter((u) => u.role === 'employee')
    .slice(0, 3);
}

function sessionFor(u: UserSummary, i: number, date: string, now: number): AttendanceSession {
  const checkIn = now - (3 + i) * 3600_000;
  const out = i === 2 ? now - 30 * 60_000 : null;
  const [lat, lng] = BASES[i] ?? BASES[0]!;
  return {
    id: `mock-session-${i}`,
    userId: u.id,
    date,
    checkInAt: new Date(checkIn).toISOString(),
    checkIn: { lat, lng, accuracy: 12 },
    checkOutAt: out ? new Date(out).toISOString() : null,
    checkOut: out ? { lat: lat + 0.02, lng: lng + 0.015, accuracy: 18 } : null,
    checkOutReason: out ? 'manual' : null,
    workedMin: Math.round(((out ?? now) - checkIn) / 60_000),
    pointCount: 40,
  };
}

export function mockRegister(date: string, now = Date.now()): AttendanceRegister {
  const staff = fieldStaff();
  const items: AttendanceRegister['items'] = staff.map((u, i) => {
    const s = sessionFor(u, i, date, now);
    return {
      user: u,
      isFieldStaff: true,
      status: s.checkOutAt ? 'checked_out' : 'present',
      firstCheckInAt: s.checkInAt,
      lastCheckOutAt: s.checkOutAt,
      workedMin: s.workedMin,
      sessions: [s],
    };
  });
  const absent = mockUsers().find((u) => u.role === 'employee' && !staff.includes(u));
  if (absent) items.push({ user: absent, isFieldStaff: true, status: 'absent', firstCheckInAt: null, lastCheckOutAt: null, workedMin: 0, sessions: [] });
  return { date, timezone: 'Asia/Kolkata', items, summary: { present: 2, checkedOut: 1, absent: absent ? 1 : 0 } };
}

export function mockFieldLive(now = Date.now()): FieldLive {
  const staff = fieldStaff().slice(0, 2);
  return {
    generatedAt: new Date(now).toISOString(),
    items: staff.map((u, i) => {
      const [lat, lng] = BASES[i] ?? BASES[0]!;
      const at = now - (i === 1 ? 18 : 1) * 60_000;
      return {
        user: u,
        sessionId: `mock-session-${i}`,
        lat: lat + 0.01,
        lng: lng + 0.008,
        accuracy: 15,
        at: new Date(at).toISOString(),
        battery: i === 1 ? 14 : 76,
        presence: i === 1 ? 'field_visit' : 'available',
        stale: i === 1,
      };
    }),
  };
}

export function mockRoute(userId: string, date: string, now = Date.now()): FieldRoute | null {
  const staff = fieldStaff();
  const i = staff.findIndex((u) => u.id === userId);
  const u = staff[i];
  if (!u) return null;
  const s = sessionFor(u, i, date, now);
  const [lat, lng] = BASES[i] ?? BASES[0]!;
  const start = Date.parse(s.checkInAt);
  const points: FieldRoute['points'] = Array.from({ length: 40 }, (_, k) => {
    // A walk out, a 20-minute stop (points 15..25 stay put), then onwards.
    const step = k < 15 ? k : k <= 25 ? 15 : k - 10;
    return { lat: lat + step * 0.0012, lng: lng + step * 0.0009, accuracy: 10, at: new Date(start + k * 120_000).toISOString(), sessionId: s.id, battery: 80 - k };
  });
  return { user: u, date, sessions: [s], points, distanceM: 4200 };
}
