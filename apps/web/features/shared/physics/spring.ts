/**
 * Spring parameters and presets shared by every physical interaction (Board cards, builder nodes).
 *
 * Units: stiffness k (N/m-like, per s^2), damping c (per s), mass m. These map 1:1 to
 * `@react-spring/web` (`tension = k`, `friction = c`, `mass = m`); react-spring integrates in ms
 * and takes `velocity` in units per ms, which is what VelocityTracker reports.
 *
 * Slow motion: running a spring s times slower is the same as a spring with k*s^2 and c*s (and the
 * initial velocity scaled by s), so time scaling never changes the shape of the motion.
 */

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass?: number;
}

/** `@react-spring/web` SpringConfig subset we produce. */
export interface ReactSpringConfig {
  tension: number;
  friction: number;
  mass: number;
  precision?: number;
  velocity?: number;
  clamp?: boolean;
}

/**
 * Default presets. Feature configs (e.g. the Board's board-physics.config.ts) start from these and
 * override what they need; the builder uses them as they are.
 */
export const SPRINGS = {
  /** Pick-up: scale, lift and shadow (spec: stiffness ~320, damping ~22, mass 1). */
  lift: { stiffness: 320, damping: 22, mass: 1 },
  /** A dragged body following the pointer: a light lag that reads as weight. */
  follow: { stiffness: 900, damping: 54, mass: 1 },
  /** Tilt smoothing (rotate follows the filtered velocity, then levels out). */
  tilt: { stiffness: 300, damping: 24, mass: 1 },
  /** Hover lift. */
  hover: { stiffness: 520, damping: 42, mass: 1 },
  /** Drop: snap into the slot with a small overshoot (damping ratio ~0.66). */
  snap: { stiffness: 520, damping: 30, mass: 1 },
  /** Released outside any target: back to the origin with a gentle bounce (ratio ~0.5). */
  springBack: { stiffness: 260, damping: 16, mass: 1 },
  /** Offsets settling back to rest after a throw or a glide (builder nodes). */
  settle: { stiffness: 260, damping: 20, mass: 1 },
  /** Neighbours opening or closing a gap. */
  gap: { stiffness: 520, damping: 40, mass: 1 },
  /** A body travelling between two places (rollback, realtime move). */
  flight: { stiffness: 300, damping: 24, mass: 1 },
} as const satisfies Record<string, SpringParams>;

export type SpringPresetName = keyof typeof SPRINGS;

/** Damping ratio (zeta). Below 1 the spring overshoots; ~0.5 bounces, ~0.7 settles with a hint. */
export function dampingRatio(p: SpringParams): number {
  return p.damping / (2 * Math.sqrt(p.stiffness * (p.mass ?? 1)));
}

/** Clamp a time scale to a sane range (0.05x .. 4x). */
export function clampTimeScale(s: number): number {
  return Number.isFinite(s) ? Math.min(4, Math.max(0.05, s)) : 1;
}

/**
 * Physical params -> react-spring config, optionally time-scaled (slow motion) and with an initial
 * velocity in units per ms (scaled with the clock so a slowed throw keeps its shape).
 */
export function springConfig(
  p: SpringParams,
  opts: { timeScale?: number; velocity?: number; precision?: number; clamp?: boolean } = {},
): ReactSpringConfig {
  const s = clampTimeScale(opts.timeScale ?? 1);
  const out: ReactSpringConfig = { tension: p.stiffness * s * s, friction: p.damping * s, mass: p.mass ?? 1 };
  if (opts.velocity !== undefined) out.velocity = opts.velocity * s;
  if (opts.precision !== undefined) out.precision = opts.precision;
  if (opts.clamp) out.clamp = true;
  return out;
}

/**
 * Imperative damped spring (semi-implicit Euler) for loops that do not go through react-spring
 * (the builder's physics world). `step(dt)` takes seconds; units are whatever the caller uses.
 */
export class Spring {
  x: number;
  v = 0;
  target: number;

  constructor(
    public k: number,
    public c: number,
    initial = 0,
    private eps = 0.01,
    public m = 1,
  ) {
    this.x = initial;
    this.target = initial;
  }

  static from(p: SpringParams, initial = 0, eps = 0.01): Spring {
    return new Spring(p.stiffness, p.damping, initial, eps, p.mass ?? 1);
  }

  /** Replace the constants (live tuning) without touching position or velocity. */
  tune(p: SpringParams) {
    this.k = p.stiffness;
    this.c = p.damping;
    this.m = p.mass ?? 1;
  }

  /** Advance by dt seconds. Returns true while still moving. */
  step(dt: number): boolean {
    if (this.x === this.target && this.v === 0) return false;
    const a = (-this.k * (this.x - this.target) - this.c * this.v) / this.m;
    this.v += a * dt;
    this.x += this.v * dt;
    if (Math.abs(this.v) < this.eps && Math.abs(this.x - this.target) < this.eps) {
      this.x = this.target;
      this.v = 0;
      return false;
    }
    return true;
  }

  set(value: number) {
    this.x = value;
    this.target = value;
    this.v = 0;
  }

  get resting(): boolean {
    return this.x === this.target && this.v === 0;
  }
}
