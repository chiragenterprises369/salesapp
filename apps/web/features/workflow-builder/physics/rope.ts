/**
 * Verlet rope between two handles.
 * - 12 points. Points 0/11 sit on the handles; points 1/10 are pinned a short "boot" away from the
 *   handle (down out of the source, down into the target) so the rope leaves and enters vertically.
 * - The free chain (points 2..9) gets gravity, velocity damping and distance constraints.
 * - Rest length follows the current span, plus slack that grows with the horizontal distance
 *   (straight drops stay taut, wide spans sag up to ~26 px).
 */
export const ROPE_POINTS = 12;
const N = ROPE_POINTS;
const GRAVITY = 0.38; // px per step^2 (step = 1/60 s)
const DAMPING = 0.94;
const ITERATIONS = 6;
const REST_EPS = 0.015;
const REST_STEPS = 24;

export class Rope {
  readonly cur = new Float64Array(N * 2);
  readonly prev = new Float64Array(N * 2);
  restSteps = 0;
  private ready = false;
  private sx = NaN;
  private sy = NaN;
  private tx = NaN;
  private ty = NaN;

  get atRest(): boolean {
    return this.restSteps >= REST_STEPS;
  }

  /** Lay the rope straight between the boots, then settle it without rendering. */
  reset(sx: number, sy: number, tx: number, ty: number, presettleSteps = 240) {
    const lead = leadFor(sx, sy, tx, ty);
    const ax = sx;
    const ay = sy + lead;
    const bx = tx;
    const by = ty - lead;
    for (let i = 1; i <= N - 2; i++) {
      const t = (i - 1) / (N - 3);
      this.cur[i * 2] = this.prev[i * 2] = ax + (bx - ax) * t;
      this.cur[i * 2 + 1] = this.prev[i * 2 + 1] = ay + (by - ay) * t;
    }
    this.ready = true;
    this.sx = sx;
    this.sy = sy;
    this.tx = tx;
    this.ty = ty;
    for (let s = 0; s < presettleSteps; s++) this.step(sx, sy, tx, ty);
    // Kill residual velocity so a freshly created rope starts at rest.
    this.prev.set(this.cur);
    this.restSteps = REST_STEPS;
  }

  /** One fixed step. Returns the largest point movement (px) in this step. */
  step(sx: number, sy: number, tx: number, ty: number): number {
    if (!this.ready) {
      this.reset(sx, sy, tx, ty);
      return 0;
    }
    const endMoved = Math.max(Math.abs(sx - this.sx), Math.abs(sy - this.sy), Math.abs(tx - this.tx), Math.abs(ty - this.ty));
    this.sx = sx;
    this.sy = sy;
    this.tx = tx;
    this.ty = ty;

    const c = this.cur;
    const p = this.prev;
    const lead = leadFor(sx, sy, tx, ty);
    c[0] = p[0] = sx;
    c[1] = p[1] = sy;
    c[2] = p[2] = sx;
    c[3] = p[3] = sy + lead;
    const last = (N - 1) * 2;
    const boot = (N - 2) * 2;
    c[last] = p[last] = tx;
    c[last + 1] = p[last + 1] = ty;
    c[boot] = p[boot] = tx;
    c[boot + 1] = p[boot + 1] = ty - lead;

    const ax = c[2]!;
    const ay = c[3]!;
    const bx = c[boot]!;
    const by = c[boot + 1]!;
    const chord = Math.hypot(bx - ax, by - ay);
    // Slack grows with the horizontal span. When the target sits below the source, the rope may not
    // droop below the target's boot, or it would hook back up into the input.
    const drop = by - ay;
    const sag = Math.min(26, Math.abs(bx - ax) * 0.075, drop > 0 ? Math.max(2, drop * 0.45) : 26);
    const length = chord + (chord > 1 ? (8 * sag * sag) / (3 * chord) : 0);
    const seg = length / (N - 3);

    // Integrate the free points.
    for (let i = 2; i <= N - 3; i++) {
      const xi = i * 2;
      const vx = (c[xi]! - p[xi]!) * DAMPING;
      const vy = (c[xi + 1]! - p[xi + 1]!) * DAMPING;
      p[xi] = c[xi]!;
      p[xi + 1] = c[xi + 1]!;
      c[xi] = c[xi]! + vx;
      c[xi + 1] = c[xi + 1]! + vy + GRAVITY;
    }

    // Distance constraints between the boots (points 1..N-2).
    for (let it = 0; it < ITERATIONS; it++) {
      for (let i = 1; i <= N - 3; i++) {
        const a = i * 2;
        const b = (i + 1) * 2;
        const dx = c[b]! - c[a]!;
        const dy = c[b + 1]! - c[a + 1]!;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - seg) / d;
        const pinA = i === 1;
        const pinB = i + 1 === N - 2;
        if (pinA && pinB) continue;
        if (pinA) {
          c[b] = c[b]! - dx * diff;
          c[b + 1] = c[b + 1]! - dy * diff;
        } else if (pinB) {
          c[a] = c[a]! + dx * diff;
          c[a + 1] = c[a + 1]! + dy * diff;
        } else {
          c[a] = c[a]! + dx * diff * 0.5;
          c[a + 1] = c[a + 1]! + dy * diff * 0.5;
          c[b] = c[b]! - dx * diff * 0.5;
          c[b + 1] = c[b + 1]! - dy * diff * 0.5;
        }
      }
    }

    let moved = endMoved;
    for (let i = 2; i <= N - 3; i++) {
      const xi = i * 2;
      moved = Math.max(moved, Math.abs(c[xi]! - p[xi]!), Math.abs(c[xi + 1]! - p[xi + 1]!));
    }
    this.restSteps = moved < REST_EPS ? this.restSteps + 1 : 0;
    return moved;
  }

  /** Smooth SVG path through all points (Catmull-Rom as cubic Béziers). */
  path(): string {
    const c = this.cur;
    const px = (i: number) => c[Math.max(0, Math.min(N - 1, i)) * 2]!;
    const py = (i: number) => c[Math.max(0, Math.min(N - 1, i)) * 2 + 1]!;
    let d = `M${px(0).toFixed(1)},${py(0).toFixed(1)}`;
    for (let i = 0; i < N - 1; i++) {
      const c1x = px(i) + (px(i + 1) - px(i - 1)) / 6;
      const c1y = py(i) + (py(i + 1) - py(i - 1)) / 6;
      const c2x = px(i + 1) - (px(i + 2) - px(i)) / 6;
      const c2y = py(i + 1) - (py(i + 2) - py(i)) / 6;
      d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${px(i + 1).toFixed(1)},${py(i + 1).toFixed(1)}`;
    }
    return d;
  }
}

function leadFor(sx: number, sy: number, tx: number, ty: number): number {
  const gap = ty - sy;
  return Math.max(6, Math.min(18, Math.hypot(tx - sx, ty - sy) * 0.14, gap > 0 ? gap * 0.3 : 18));
}
