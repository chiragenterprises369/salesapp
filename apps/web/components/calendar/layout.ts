/**
 * Pure layout helpers for the calendar views (unit-tested): overlap lanes in a day column and the
 * drag math (snap, clamp, move keeping the duration).
 */

export interface Span {
  id: string;
  /** Minutes from midnight (may exceed 1440 for events that run past midnight; clamped by the view). */
  start: number;
  end: number;
}

export interface Placed extends Span {
  lane: number;
  lanes: number;
}

/** Greedy lanes per overlap cluster: events that overlap share the width of their cluster. */
export function placeInLanes(spans: readonly Span[]): Placed[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = cluster.reduce((m, p) => Math.max(m, p.lane + 1), 0);
    cluster.forEach((p) => (p.lanes = lanes));
    out.push(...cluster);
    cluster = [];
  };
  for (const s of sorted) {
    const end = Math.max(s.end, s.start + 15);
    if (cluster.length && s.start >= clusterEnd) flush();
    const laneEnds: number[] = [];
    for (const p of cluster) laneEnds[p.lane] = Math.max(laneEnds[p.lane] ?? -1, Math.max(p.end, p.start + 15));
    let lane = laneEnds.findIndex((e) => e <= s.start);
    if (lane === -1) lane = laneEnds.length;
    cluster.push({ ...s, end, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) flush();
  return out;
}

export const SNAP_MINUTES = 15;
export const snap = (minutes: number, step = SNAP_MINUTES) => Math.round(minutes / step) * step;

/** New start (minutes) after a vertical drag, kept inside the day so the event still fits. */
export function dragStart(originalStart: number, deltaMinutes: number, duration: number): number {
  const next = snap(originalStart + deltaMinutes);
  return Math.min(Math.max(0, next), Math.max(0, 1440 - Math.min(duration, 1440)));
}
