import type { RGB } from './palette';

/**
 * Fixed-size particle pool (struct of arrays, no allocation per frame). The cap is hard: spawn()
 * fails when the pool or the current budget is full, so the live count can never exceed it.
 * Dead particles are swapped with the last live one, so the live range stays dense.
 */

export const PARTICLE_CAP = 300;

export const SPARK = 0;
export const DUST = 1;
export const CONFETTI = 2;
export const SHARD = 3;
export type ParticleKind = typeof SPARK | typeof DUST | typeof CONFETTI | typeof SHARD;

export interface ParticleSpec {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Life (ms). */
  ttl: number;
  size: number;
  color: RGB;
  /** Shard edge colour. */
  edge?: RGB;
  alpha?: number;
  /** px/s^2 downward. */
  gravity?: number;
  /** Velocity damping per second (0 = none). */
  drag?: number;
  rot?: number;
  spin?: number;
  /** Width / height ratio (confetti, shards). */
  aspect?: number;
  /** Delay before the particle shows and moves (ms). */
  delay?: number;
}

export class ParticlePool {
  readonly cap: number;
  /** Live particles. */
  count = 0;
  /** Highest live count since the last reset (test hook). */
  peak = 0;
  private budget: number;
  private kind: Uint8Array;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private age: Float32Array;
  private ttl: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private aspect: Float32Array;
  private rgb: Uint8Array;
  private edge: Uint8Array;

  constructor(cap = PARTICLE_CAP) {
    this.cap = cap;
    this.budget = cap;
    this.kind = new Uint8Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.ttl = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.rot = new Float32Array(cap);
    this.spin = new Float32Array(cap);
    this.aspect = new Float32Array(cap);
    this.rgb = new Uint8Array(cap * 3);
    this.edge = new Uint8Array(cap * 3);
  }

  /** Live-count limit below the cap (quality tier and intensity). */
  setBudget(n: number) {
    this.budget = Math.max(0, Math.min(this.cap, Math.floor(n)));
  }

  get limit(): number {
    return this.budget;
  }

  /** Free slots under the budget. */
  get free(): number {
    return Math.max(0, this.budget - this.count);
  }

  spawn(s: ParticleSpec): boolean {
    if (this.count >= this.budget) return false;
    const i = this.count++;
    if (this.count > this.peak) this.peak = this.count;
    this.kind[i] = s.kind;
    this.x[i] = s.x;
    this.y[i] = s.y;
    this.vx[i] = s.vx;
    this.vy[i] = s.vy;
    this.age[i] = -(s.delay ?? 0);
    this.ttl[i] = Math.max(1, s.ttl);
    this.size[i] = s.size;
    this.alpha[i] = s.alpha ?? 1;
    this.grav[i] = s.gravity ?? 0;
    this.drag[i] = s.drag ?? 0;
    this.rot[i] = s.rot ?? 0;
    this.spin[i] = s.spin ?? 0;
    this.aspect[i] = s.aspect ?? 1;
    this.rgb[i * 3] = s.color.r;
    this.rgb[i * 3 + 1] = s.color.g;
    this.rgb[i * 3 + 2] = s.color.b;
    const e = s.edge ?? s.color;
    this.edge[i * 3] = e.r;
    this.edge[i * 3 + 1] = e.g;
    this.edge[i * 3 + 2] = e.b;
    return true;
  }

  private kill(i: number) {
    const last = --this.count;
    if (i === last) return;
    this.kind[i] = this.kind[last]!;
    this.x[i] = this.x[last]!;
    this.y[i] = this.y[last]!;
    this.vx[i] = this.vx[last]!;
    this.vy[i] = this.vy[last]!;
    this.age[i] = this.age[last]!;
    this.ttl[i] = this.ttl[last]!;
    this.size[i] = this.size[last]!;
    this.alpha[i] = this.alpha[last]!;
    this.grav[i] = this.grav[last]!;
    this.drag[i] = this.drag[last]!;
    this.rot[i] = this.rot[last]!;
    this.spin[i] = this.spin[last]!;
    this.aspect[i] = this.aspect[last]!;
    for (let k = 0; k < 3; k++) {
      this.rgb[i * 3 + k] = this.rgb[last * 3 + k]!;
      this.edge[i * 3 + k] = this.edge[last * 3 + k]!;
    }
  }

  /** Advance by `dtMs` (already time-scaled). */
  step(dtMs: number) {
    const dt = dtMs / 1000;
    for (let i = 0; i < this.count; i++) {
      const age = (this.age[i]! += dtMs);
      if (age < 0) continue;
      if (age >= this.ttl[i]!) {
        this.kill(i);
        i--;
        continue;
      }
      const d = this.drag[i]!;
      if (d > 0) {
        const f = Math.max(0, 1 - d * dt);
        this.vx[i]! *= f;
        this.vy[i]! *= f;
      }
      this.vy[i]! += this.grav[i]! * dt;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.rot[i]! += this.spin[i]! * dt;
    }
  }

  clear() {
    this.count = 0;
  }

  resetPeak() {
    this.peak = this.count;
  }

  private color(src: Uint8Array, i: number, a: number): string {
    return `rgba(${src[i * 3]},${src[i * 3 + 1]},${src[i * 3 + 2]},${Math.min(1, a).toFixed(3)})`;
  }

  /** Paint every live particle. `glow` adds a soft halo to sparks and dust. */
  draw(ctx: CanvasRenderingContext2D, opts: { glow: boolean; glowAlpha: number; additive: boolean }) {
    const { glow, glowAlpha } = opts;
    for (let i = 0; i < this.count; i++) {
      const age = this.age[i]!;
      if (age < 0) continue;
      const life = age / this.ttl[i]!;
      const k = this.kind[i]!;
      // Fade in fast, fade out over the last 40% (never a hard pop, never a flash).
      const fade = Math.min(1, age / 80) * (life > 0.6 ? 1 - (life - 0.6) / 0.4 : 1);
      const a = this.alpha[i]! * fade;
      if (a <= 0.01) continue;
      const x = this.x[i]!;
      const y = this.y[i]!;
      const s = this.size[i]!;
      if (k === SPARK) {
        // A short streak along the velocity (reads as a firework spark).
        const vx = this.vx[i]!;
        const vy = this.vy[i]!;
        const sp = Math.hypot(vx, vy) || 1;
        const len = Math.min(14, 2 + sp * 0.045);
        if (glow) {
          ctx.fillStyle = this.color(this.rgb, i, a * glowAlpha);
          ctx.beginPath();
          ctx.arc(x, y, s * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = this.color(this.rgb, i, a);
        ctx.lineWidth = s;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - (vx / sp) * len, y - (vy / sp) * len);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else if (k === DUST) {
        if (glow) {
          ctx.fillStyle = this.color(this.rgb, i, a * glowAlpha * 0.8);
          ctx.beginPath();
          ctx.arc(x, y, s * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = this.color(this.rgb, i, a);
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
      } else if (k === CONFETTI) {
        const r = this.rot[i]!;
        // Flutter: the visible width swings as the piece turns.
        const w = s * this.aspect[i]! * Math.abs(Math.cos(r * 1.7));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(r);
        ctx.fillStyle = this.color(this.rgb, i, a);
        ctx.fillRect(-w / 2, -s / 2, Math.max(0.6, w), s);
        ctx.restore();
      } else {
        const r = this.rot[i]!;
        const w = s * this.aspect[i]!;
        const h = s;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(r);
        // An irregular torn quad.
        ctx.beginPath();
        ctx.moveTo(-w * 0.5, -h * 0.42);
        ctx.lineTo(w * 0.46, -h * 0.5);
        ctx.lineTo(w * 0.5, h * 0.34);
        ctx.lineTo(-w * 0.38, h * 0.5);
        ctx.closePath();
        ctx.fillStyle = this.color(this.rgb, i, a * 0.92);
        ctx.fill();
        ctx.strokeStyle = this.color(this.edge, i, a * 0.7);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}
