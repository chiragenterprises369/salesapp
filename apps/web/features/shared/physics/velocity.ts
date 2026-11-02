/**
 * Pointer velocity and the tilt it drives.
 *
 * VelocityTracker low-pass filters instantaneous velocity (exponential smoothing with time
 * constant `tauMs`), so tilt follows the hand, not the jitter. Velocities are px per ms.
 */

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export class VelocityTracker {
  vx = 0;
  vy = 0;
  private x = Number.NaN;
  private y = Number.NaN;
  private t = 0;

  constructor(public tauMs = 70) {}

  /** Start fresh at a position (pick-up). */
  reset(x: number, y: number, t = performance.now()) {
    this.x = x;
    this.y = y;
    this.t = t;
    this.vx = 0;
    this.vy = 0;
  }

  /**
   * Feed a position sample. Call once per frame (also when the pointer did not move, so the
   * velocity decays and the tilt levels out when the hand stops).
   */
  sample(x: number, y: number, t = performance.now()) {
    if (Number.isNaN(this.x)) {
      this.reset(x, y, t);
      return;
    }
    const dt = clamp(t - this.t, 1, 64);
    const a = 1 - Math.exp(-dt / this.tauMs);
    this.vx += ((x - this.x) / dt - this.vx) * a;
    this.vy += ((y - this.y) / dt - this.vy) * a;
    this.x = x;
    this.y = y;
    this.t = t;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }
}

export interface TiltOptions {
  /** Max tilt in degrees for the combined rotateX/rotateY and for rotateZ. */
  max: number;
  /** Degrees of rotateX/rotateY per px/ms. */
  gain: number;
  /** Degrees of rotateZ per px/ms of horizontal velocity (defaults to `gain`). */
  zGain?: number;
  /** Separate clamp for rotateZ (defaults to `max`). */
  zMax?: number;
  /** 0..1 multiplier (adaptive quality, reduced motion = 0). */
  amount?: number;
}

export interface Tilt {
  rx: number;
  ry: number;
  rz: number;
}

export const NO_TILT: Tilt = { rx: 0, ry: 0, rz: 0 };

/**
 * Tilt for a velocity: the body leans into the motion. rotateY follows horizontal speed, rotateX
 * vertical speed, rotateZ swings with horizontal speed. Combined X/Y is clamped to `max`.
 */
export function tiltFromVelocity(vx: number, vy: number, o: TiltOptions): Tilt {
  const amount = o.amount ?? 1;
  if (amount <= 0 || o.max <= 0) return NO_TILT;
  let rx = -vy * o.gain * amount;
  let ry = vx * o.gain * amount;
  const mag = Math.hypot(rx, ry);
  const max = o.max * amount;
  if (mag > max) {
    rx = (rx / mag) * max;
    ry = (ry / mag) * max;
  }
  const zMax = (o.zMax ?? o.max) * amount;
  const rz = clamp(vx * (o.zGain ?? o.gain) * amount, -zMax, zMax);
  return { rx, ry, rz };
}
