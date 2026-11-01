/**
 * Release momentum. A thrown body keeps travelling a little past the release point before the
 * spring pulls it into place; the distance is the release velocity times a short "throw" time,
 * capped so a flick never sends it across the screen.
 */
export interface ThrowOptions {
  /** How long the momentum carries the body (ms). */
  throwMs: number;
  /** Cap on the carried distance (px). */
  maxPx: number;
}

/** Distance (px) the release velocity (px/ms) carries a body. */
export function projectRelease(vx: number, vy: number, o: ThrowOptions): { dx: number; dy: number } {
  let dx = vx * o.throwMs;
  let dy = vy * o.throwMs;
  const len = Math.hypot(dx, dy);
  if (len > o.maxPx && len > 0) {
    dx = (dx / len) * o.maxPx;
    dy = (dy / len) * o.maxPx;
  }
  return { dx, dy };
}

/** Release velocity capped to a speed (px/ms), handed to the landing spring as its start velocity. */
export function capVelocity(vx: number, vy: number, maxSpeed: number): { vx: number; vy: number } {
  const s = Math.hypot(vx, vy);
  if (s <= maxSpeed || s === 0) return { vx, vy };
  return { vx: (vx / s) * maxSpeed, vy: (vy / s) * maxSpeed };
}
