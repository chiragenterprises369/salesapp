import type { SeatMap } from '@vistar/shared';

export interface SeatPerson {
  id: string;
  deskIndex: number | null;
  name: string;
}

/**
 * Seat of each person on a published custom floor (pure): seats with `assignedUserId` first, then the
 * free desk seats in seat-map order to everyone else in deskIndex order (then name). People without a
 * seat (more people than desks) get null and the floor shows them in the lounge.
 */
export function assignSeats(seatMap: SeatMap | null, people: readonly SeatPerson[]): Map<string, string | null> {
  const out = new Map<string, string | null>(people.map((p) => [p.id, null]));
  if (!seatMap) return out;
  const taken = new Set<string>();
  for (const seat of seatMap.seats) {
    if (seat.assignedUserId && out.has(seat.assignedUserId) && out.get(seat.assignedUserId) === null) {
      out.set(seat.assignedUserId, seat.id);
      taken.add(seat.id);
    }
  }
  const free = seatMap.seats.filter((s) => s.kind === 'desk' && !s.assignedUserId && !taken.has(s.id));
  const waiting = people
    .filter((p) => out.get(p.id) === null)
    .sort((a, b) => (a.deskIndex ?? Number.MAX_SAFE_INTEGER) - (b.deskIndex ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  waiting.forEach((p, i) => {
    const seat = free[i];
    if (seat) out.set(p.id, seat.id);
  });
  return out;
}
