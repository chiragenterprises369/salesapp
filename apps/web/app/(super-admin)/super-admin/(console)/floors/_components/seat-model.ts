import { SeatMapSchema, type FloorSeatKind, type SeatMap } from '@vistar/shared';
import { useCallback, useState } from 'react';
import { insidePolygon } from '@/features/team-floor/state/layout';

/**
 * Seat tool model (pure helpers + an undo history): seats and zones of a floor version in scene metres
 * (x right, z down). Positions snap to 5 cm, rotations to 15 degrees unless asked otherwise.
 */

export type Selection =
  { kind: 'seat'; id: string } | { kind: 'zone'; id: string; vertex?: number } | null;
export type SeatTool = 'select' | 'seat' | 'zone';
export type Seat = SeatMap['seats'][number];
export type Zone = SeatMap['zones'][number];

export const SEAT_KIND_LABEL: Record<FloorSeatKind, string> = {
  desk: 'Desk',
  cabin: 'Cabin',
  meeting: 'Meeting chair',
  lounge: 'Lounge seat',
  reception: 'Reception',
};
export const ZONE_KIND_LABEL: Record<Zone['kind'], string> = {
  work_area: 'Work area',
  cabin: 'Cabin',
  meeting_room: 'Meeting room',
  reception: 'Reception',
  pantry_lounge: 'Pantry or lounge',
  other: 'Other',
};
const PREFIX: Record<FloorSeatKind, string> = {
  desk: 'd',
  cabin: 'cabin-',
  meeting: 'm',
  lounge: 'l',
  reception: 'r',
};

export const snap = (v: number, step = 0.05) => Math.round(v / step) * step;
export const snapAngle = (deg: number, step = 15) => {
  let a = Math.round(deg / step) * step;
  while (a > 180) a -= 360;
  while (a <= -180) a += 360;
  return a;
};
const round = (v: number) => Math.round(v * 1000) / 1000;

export function zoneAt(map: SeatMap, x: number, z: number): string | null {
  for (let i = map.zones.length - 1; i >= 0; i--)
    if (insidePolygon(x, z, map.zones[i]!.polygon)) return map.zones[i]!.id;
  return null;
}

function nextId(taken: Set<string>, prefix: string) {
  for (let n = 1; ; n++) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

export function addSeat(
  map: SeatMap,
  kind: FloorSeatKind,
  x: number,
  z: number,
  rotation = 0,
): { map: SeatMap; id: string } {
  const id = nextId(new Set(map.seats.map((s) => s.id)), PREFIX[kind]);
  const seat: Seat = {
    id,
    kind,
    position: [round(snap(x)), 0, round(snap(z))],
    rotation,
    label: null,
    zoneId: zoneAt(map, x, z),
  };
  return { map: { ...map, seats: [...map.seats, seat] }, id };
}

export function updateSeat(
  map: SeatMap,
  id: string,
  patch: Partial<Seat>,
  rezone = false,
): SeatMap {
  return {
    ...map,
    seats: map.seats.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, ...patch };
      if (rezone) next.zoneId = zoneAt(map, next.position[0], next.position[2]);
      return next;
    }),
  };
}

export function removeSeat(map: SeatMap, id: string): SeatMap {
  return { ...map, seats: map.seats.filter((s) => s.id !== id) };
}

export function addZone(
  map: SeatMap,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): { map: SeatMap; id: string } {
  const id = nextId(new Set(map.zones.map((z) => z.id)), 'zone-');
  const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)].map((v) => round(snap(v, 0.1)));
  const [c, d] = [Math.min(z0, z1), Math.max(z0, z1)].map((v) => round(snap(v, 0.1)));
  const zone: Zone = {
    id,
    name: `Zone ${map.zones.length + 1}`,
    kind: 'other',
    polygon: [
      [a!, c!],
      [b!, c!],
      [b!, d!],
      [a!, d!],
    ],
  };
  const next = { ...map, zones: [...map.zones, zone] };
  // Seats inside the new zone without a zone join it.
  return {
    map: {
      ...next,
      seats: next.seats.map((s) =>
        s.zoneId ? s : { ...s, zoneId: zoneAt(next, s.position[0], s.position[2]) },
      ),
    },
    id,
  };
}

export function updateZone(map: SeatMap, id: string, patch: Partial<Zone>): SeatMap {
  return { ...map, zones: map.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) };
}

export function removeZone(map: SeatMap, id: string): SeatMap {
  return {
    ...map,
    zones: map.zones.filter((z) => z.id !== id),
    seats: map.seats.map((s) => (s.zoneId === id ? { ...s, zoneId: null } : s)),
  };
}

/** Splits the longest edge of a zone (one more corner to drag). */
export function addCorner(map: SeatMap, id: string): SeatMap {
  return {
    ...map,
    zones: map.zones.map((z) => {
      if (z.id !== id || z.polygon.length >= 64) return z;
      let best = 0;
      let len = -1;
      z.polygon.forEach((p, i) => {
        const q = z.polygon[(i + 1) % z.polygon.length]!;
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (l > len) {
          len = l;
          best = i;
        }
      });
      const p = z.polygon[best]!;
      const q = z.polygon[(best + 1) % z.polygon.length]!;
      const mid: [number, number] = [round((p[0] + q[0]) / 2), round((p[1] + q[1]) / 2)];
      return {
        ...z,
        polygon: [...z.polygon.slice(0, best + 1), mid, ...z.polygon.slice(best + 1)],
      };
    }),
  };
}

export function removeCorner(map: SeatMap, id: string, vertex: number): SeatMap {
  return {
    ...map,
    zones: map.zones.map((z) =>
      z.id === id && z.polygon.length > 3
        ? { ...z, polygon: z.polygon.filter((_, i) => i !== vertex) }
        : z,
    ),
  };
}

/** Problems that block saving (SeatMapSchema plus seat-tool rules), as sentences. */
export function seatMapProblems(map: SeatMap): string[] {
  const out: string[] = [];
  if (!map.seats.length) out.push('Place at least one seat.');
  const parsed = SeatMapSchema.safeParse(map);
  if (!parsed.success)
    for (const i of parsed.error.issues.slice(0, 12))
      out.push(`${i.path.join('.') || 'seat map'}: ${i.message}`);
  return [...new Set(out)];
}

export interface History {
  map: SeatMap;
  /** `merge` replaces the present state (drag in progress) instead of adding an undo step. */
  set: (next: SeatMap, merge?: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: (map: SeatMap) => void;
}

const LIMIT = 60;

export function useSeatMapHistory(initial: SeatMap): History {
  const [h, setH] = useState<{ past: SeatMap[]; present: SeatMap; future: SeatMap[] }>({
    past: [],
    present: initial,
    future: [],
  });
  const set = useCallback(
    (next: SeatMap, merge = false) =>
      setH((cur) =>
        merge
          ? { ...cur, present: next }
          : { past: [...cur.past, cur.present].slice(-LIMIT), present: next, future: [] },
      ),
    [],
  );
  const undo = useCallback(
    () =>
      setH((cur) =>
        cur.past.length
          ? {
              past: cur.past.slice(0, -1),
              present: cur.past[cur.past.length - 1]!,
              future: [cur.present, ...cur.future],
            }
          : cur,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setH((cur) =>
        cur.future.length
          ? {
              past: [...cur.past, cur.present],
              present: cur.future[0]!,
              future: cur.future.slice(1),
            }
          : cur,
      ),
    [],
  );
  const reset = useCallback((map: SeatMap) => setH({ past: [], present: map, future: [] }), []);
  return {
    map: h.present,
    set,
    undo,
    redo,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    reset,
  };
}
