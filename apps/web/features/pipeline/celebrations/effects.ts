import { Spring, type SpringParams } from '@/features/shared/physics';
import type { Rect } from '../drag/types';
import { lighten, rgba, type PaintStyle, type RGB } from './palette';
import { CONFETTI, DUST, SHARD, SPARK, type ParticlePool } from './particles';

/**
 * Canvas effects for board events. Each effect advances with (time-scaled) ms and paints in
 * viewport coordinates; particles go to the shared pool, so the cap holds for all of them together.
 */

export interface EffectEnv {
  pool: ParticlePool;
  style: PaintStyle;
  intensity: 'full' | 'subtle';
  /** 0..1: particle budget share for the tier and intensity (counts scale with it). */
  density: number;
  /** Halos on (dark themes, high and medium tiers). */
  glow: boolean;
  /** Start another effect (landing ring after a stream-in, ...). */
  add: (e: Effect) => void;
}

export interface Effect {
  /** Advance by `dt` ms (already slowed in slow motion). False when finished. */
  update(dt: number, env: EffectEnv): boolean;
  draw(ctx: CanvasRenderingContext2D, env: EffectEnv): void;
}

interface Point {
  x: number;
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const centre = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const count = (base: number, env: EffectEnv) => Math.max(1, Math.round(base * env.density * (env.intensity === 'subtle' ? 0.5 : 1)));

function quad(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/**
 * A light ribbon along a path, from `tail` to `head` (path parameter 0..1): a soft wide glow under
 * a thin bright core, fading toward the tail. Glow width and alpha are capped (--glow-alpha-max).
 */
export function drawRibbon(
  ctx: CanvasRenderingContext2D,
  path: (u: number) => Point,
  tail: number,
  head: number,
  color: RGB,
  alpha: number,
  width: number,
  env: EffectEnv,
) {
  if (head - tail < 0.01 || alpha <= 0.01) return;
  const steps = 18;
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) pts.push(path(tail + ((head - tail) * i) / steps));
  const a = pts[0]!;
  const b = pts[steps]!;
  const grad = (peak: number) => {
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(0.7, rgba(color, peak * 0.55));
    g.addColorStop(1, rgba(color, peak));
    return g;
  };
  const stroke = (w: number, style: CanvasGradient | string) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (let i = 1; i <= steps; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.stroke();
  };
  if (env.glow) stroke(width * 3.4, grad(alpha * env.style.glowAlpha));
  stroke(width, grad(alpha * (env.style.dark ? 0.95 : 0.8)));
  if (env.style.dark) stroke(Math.max(1, width * 0.35), grad(alpha * 0.9 * (env.style.additive ? 1 : 0.6)));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

/** Ring pulse around a card at arrival (one soft expanding pulse, no flash). */
export class RingPulse implements Effect {
  private age = 0;
  constructor(
    private rect: Rect,
    private color: RGB,
    private duration = 560,
  ) {}
  update(dt: number) {
    this.age += dt;
    return this.age < this.duration;
  }
  draw(ctx: CanvasRenderingContext2D, env: EffectEnv) {
    const t = this.age / this.duration;
    const grow = 2 + 9 * easeOutCubic(t);
    const a = Math.pow(1 - t, 1.6) * (env.style.dark ? 0.9 : 0.75);
    const { x, y, width, height } = this.rect;
    if (env.glow) {
      ctx.strokeStyle = rgba(this.color, a * env.style.glowAlpha);
      ctx.lineWidth = 7;
      roundRect(ctx, x - grow, y - grow, width + grow * 2, height + grow * 2, 10 + grow);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(this.color, a);
    ctx.lineWidth = 2;
    roundRect(ctx, x - grow, y - grow, width + grow * 2, height + grow * 2, 10 + grow);
    ctx.stroke();
  }
}

/**
 * Stage move: a short ribbon under the card while it flies along the existing arc (same path and
 * spring as the board's FlightGhost), then it retracts into the card.
 */
export class FlightRibbon implements Effect {
  private spring: Spring;
  private age = 0;
  private settledAt = -1;
  private readonly arc: number;
  private readonly a: Point;
  private readonly d: Point;

  constructor(
    from: Rect,
    to: Rect,
    arcHeight: number,
    flight: SpringParams,
    private color: RGB,
  ) {
    this.spring = new Spring(flight.stiffness, flight.damping, 0, 0.002, flight.mass ?? 1);
    this.spring.target = 1;
    this.a = centre(from);
    const b = centre(to);
    const dx = b.x - this.a.x;
    const dy = b.y - this.a.y;
    this.d = { x: dx, y: dy };
    // FlightGhost: higher arcs for longer trips; a within-column hop barely lifts.
    this.arc = Math.min(arcHeight, Math.hypot(dx, dy) * 0.35) * (Math.abs(to.x - from.x) > 8 ? 1 : 0.4);
  }

  private path = (u: number): Point => {
    const c = clamp01(u);
    return { x: this.a.x + this.d.x * u, y: this.a.y + this.d.y * u - this.arc * Math.sin(Math.PI * c) };
  };

  update(dt: number, env: EffectEnv) {
    this.age += dt;
    if (this.settledAt < 0) {
      // Sub-steps keep the explicit integration stable at low frame rates.
      let left = dt / 1000;
      while (left > 0) {
        const h = Math.min(left, 0.008);
        this.spring.step(h);
        left -= h;
      }
      if (this.spring.resting || this.age > 1600) this.settledAt = this.age;
      if (env.intensity === 'full' && Math.random() < 0.45 * env.density && this.spring.x < 0.97) {
        const p = this.path(this.spring.x);
        env.pool.spawn({ kind: DUST, x: p.x + rand(-6, 6), y: p.y + rand(-4, 4), vx: rand(-14, 14), vy: rand(-10, 18), ttl: rand(380, 620), size: rand(0.9, 1.6), color: lighten(this.color, 0.2), alpha: 0.85 });
      }
      return true;
    }
    return this.age - this.settledAt < 300;
  }

  draw(ctx: CanvasRenderingContext2D, env: EffectEnv) {
    const head = clamp01(this.spring.x);
    const fade = this.settledAt < 0 ? 1 : 1 - (this.age - this.settledAt) / 300;
    const tail = Math.max(0, head - 0.55 * fade);
    drawRibbon(ctx, this.path, tail, head, this.color, 0.9 * fade, env.intensity === 'full' ? 3 : 2, env);
  }
}

/**
 * New lead: a glowing card streams in along a light ribbon (lead source colour) to its slot and
 * lands softly (dust and a ring). `target` is read every frame: the real card is dropping in.
 */
export class StreamIn implements Effect {
  private age = 0;
  private landed = false;
  private readonly start: Point;
  private readonly ctrl: Point;
  private last: Rect;

  constructor(
    private target: () => Rect | null,
    initial: Rect,
    private color: RGB,
    private duration: number,
  ) {
    this.last = initial;
    const c = centre(initial);
    this.start = { x: c.x - Math.max(260, initial.width * 1.1), y: c.y - 150 };
    this.ctrl = { x: c.x - initial.width * 0.55, y: c.y - 170 };
  }

  private path = (u: number): Point => quad(this.start, this.ctrl, centre(this.last), clamp01(u));

  update(dt: number, env: EffectEnv) {
    this.age += dt;
    this.last = this.target() ?? this.last;
    const t = this.age / this.duration;
    if (t < 1 && env.intensity === 'full' && Math.random() < 0.5 * env.density) {
      const p = this.path(easeOutCubic(t));
      env.pool.spawn({ kind: DUST, x: p.x + rand(-10, 10), y: p.y + rand(-8, 8), vx: rand(-30, 10), vy: rand(-12, 12), ttl: rand(420, 700), size: rand(0.9, 1.8), color: lighten(this.color, 0.25), alpha: 0.9 });
    }
    if (t >= 1 && !this.landed) {
      this.landed = true;
      const r = this.last;
      const n = count(12, env);
      for (let i = 0; i < n; i++) {
        env.pool.spawn({ kind: DUST, x: rand(r.x + 6, r.x + r.width - 6), y: r.y + r.height - rand(0, 6), vx: rand(-40, 40), vy: rand(-46, -8), ttl: rand(380, 640), size: rand(0.8, 1.5), color: lighten(this.color, 0.2), alpha: 0.85, drag: 2 });
      }
      env.add(new RingPulse(r, this.color, 620));
    }
    return this.age < this.duration + 380;
  }

  draw(ctx: CanvasRenderingContext2D, env: EffectEnv) {
    const t = this.age / this.duration;
    const head = easeOutCubic(t);
    const after = Math.max(0, this.age - this.duration) / 380;
    const fade = 1 - after;
    drawRibbon(ctx, this.path, Math.max(0, head - 0.6 * fade), head, this.color, 0.95 * fade, env.intensity === 'full' ? 3.5 : 2.2, env);
    // The glowing card silhouette rides the head and dissolves onto the real card.
    const show = t < 1 ? Math.min(1, t / 0.15) * (t > 0.7 ? 1 - (t - 0.7) / 0.45 : 1) : Math.max(0, 0.33 - after) * 1.2;
    if (show <= 0.01) return;
    const p = this.path(head);
    const r = this.last;
    const s = 0.86 + 0.14 * head;
    const w = r.width * s;
    const h = r.height * s;
    const dark = env.style.dark;
    ctx.fillStyle = rgba(this.color, show * (dark ? 0.16 : 0.1));
    roundRect(ctx, p.x - w / 2, p.y - h / 2, w, h, 10);
    ctx.fill();
    if (env.glow) {
      ctx.strokeStyle = rgba(this.color, show * env.style.glowAlpha);
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(dark ? lighten(this.color, 0.3) : this.color, show * 0.9);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** Quote sent: a small envelope flies from the card to the column header and dissolves into the column. */
export class EnvelopeFlight implements Effect {
  private age = 0;
  private dissolved = false;
  private readonly ctrl: Point;
  private readonly duration = 820;

  constructor(
    private from: Point,
    private to: Point,
    private color: RGB,
    private paper: RGB,
  ) {
    this.ctrl = { x: (from.x + to.x) / 2 + 46, y: Math.min(from.y, to.y) - 64 };
  }

  private path = (u: number): Point => quad(this.from, this.ctrl, this.to, clamp01(u));

  update(dt: number, env: EffectEnv) {
    this.age += dt;
    const t = this.age / this.duration;
    if (t >= 0.86 && !this.dissolved) {
      this.dissolved = true;
      const p = this.path(easeInOutCubic(0.86));
      const n = count(16, env);
      for (let i = 0; i < n; i++) {
        env.pool.spawn({ kind: DUST, x: p.x + rand(-10, 10), y: p.y + rand(-6, 6), vx: rand(-34, 34), vy: rand(30, 110), ttl: rand(520, 900), size: rand(0.9, 1.7), color: lighten(this.color, 0.25), alpha: 0.9, drag: 1.2 });
      }
    }
    return t < 1.15;
  }

  draw(ctx: CanvasRenderingContext2D, env: EffectEnv) {
    const t = this.age / this.duration;
    const e = easeInOutCubic(t);
    const fade = t < 0.1 ? t / 0.1 : t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.2) : 1;
    drawRibbon(ctx, this.path, Math.max(0, e - 0.32), Math.min(1, e), this.color, 0.7 * Math.min(1, fade + 0.2), env.intensity === 'full' ? 2.2 : 1.6, env);
    if (fade <= 0.01) return;
    const p = this.path(e);
    const q = this.path(Math.min(1, e + 0.02));
    const angle = Math.max(-0.5, Math.min(0.5, Math.atan2(q.y - p.y, q.x - p.x) * 0.5));
    const scale = 1 - 0.4 * clamp01((t - 0.72) / 0.28);
    const w = 22 * scale;
    const h = 15 * scale;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    if (env.glow) {
      ctx.fillStyle = rgba(this.color, fade * env.style.glowAlpha);
      roundRect(ctx, -w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 6);
      ctx.fill();
    }
    ctx.fillStyle = rgba(this.paper, fade * 0.96);
    roundRect(ctx, -w / 2, -h / 2, w, h, 2.5);
    ctx.fill();
    ctx.strokeStyle = rgba(this.color, fade);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Flap.
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 1, -h / 2 + 1);
    ctx.lineTo(0, h * 0.08);
    ctx.lineTo(w / 2 - 1, -h / 2 + 1);
    ctx.stroke();
    ctx.restore();
  }
}

export interface WonColors {
  stage: RGB;
  gold: RGB;
  accent: RGB;
  /** Rupee glyph fill and its outline (light themes need a light outline). */
  glyph: RGB;
  outline: RGB;
}

/** Won: a short burst of sparks (and confetti on Full) above the column with a rising rupee glyph. */
export class WonBurst implements Effect {
  private age = 0;
  private fired = 0;
  private confetti = false;
  private readonly shells: Array<{ at: number; x: number; y: number }>;
  private readonly duration = 1600;

  constructor(
    private column: Rect,
    private colors: WonColors,
    intensity: 'full' | 'subtle',
  ) {
    const cx = column.x + column.width / 2;
    const top = column.y;
    this.shells =
      intensity === 'full'
        ? [
            { at: 0, x: cx, y: top + 10 },
            { at: 150, x: cx - column.width * 0.24, y: top + 52 },
            { at: 290, x: cx + column.width * 0.22, y: top + 34 },
          ]
        : [{ at: 0, x: cx, y: top + 20 }];
  }

  update(dt: number, env: EffectEnv) {
    this.age += dt;
    const palette = [this.colors.stage, this.colors.gold, lighten(this.colors.stage, 0.35), this.colors.accent];
    while (this.fired < this.shells.length && this.age >= this.shells[this.fired]!.at) {
      const s = this.shells[this.fired++]!;
      const n = count(this.fired === 1 ? 40 : 30, env);
      const fast = env.intensity === 'full' ? 1 : 0.7;
      for (let i = 0; i < n; i++) {
        const ang = (Math.PI * 2 * i) / n + rand(-0.12, 0.12);
        const sp = rand(70, 190) * fast;
        env.pool.spawn({
          kind: SPARK,
          x: s.x,
          y: s.y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 24,
          ttl: rand(620, 1050),
          size: rand(1.4, 2.2),
          color: pick(palette),
          gravity: 150,
          drag: 1.5,
          alpha: 0.95,
        });
      }
    }
    if (!this.confetti && env.intensity === 'full' && this.age >= 60) {
      this.confetti = true;
      const n = count(18, env);
      const { x, width, y } = this.column;
      for (let i = 0; i < n; i++) {
        env.pool.spawn({
          kind: CONFETTI,
          x: rand(x + 12, x + width - 12),
          y: y + rand(-6, 24),
          vx: rand(-40, 40),
          vy: rand(-70, 10),
          ttl: rand(1200, 1600),
          size: rand(4, 6),
          aspect: rand(0.45, 0.75),
          color: pick(palette),
          gravity: 110,
          drag: 0.9,
          rot: rand(0, Math.PI),
          spin: rand(-7, 7),
          alpha: 0.95,
          delay: rand(0, 160),
        });
      }
    }
    return this.age < this.duration;
  }

  draw(ctx: CanvasRenderingContext2D, env: EffectEnv) {
    const t = this.age;
    const a = t < 180 ? t / 180 : t > 1100 ? Math.max(0, 1 - (t - 1100) / 450) : 1;
    if (a <= 0.01) return;
    const rise = easeOutCubic(t / 520);
    const scale = 0.72 + 0.28 * rise;
    const x = this.column.x + this.column.width / 2;
    const y = this.column.y + 76 - 36 * rise;
    const size = Math.round(34 * scale);
    ctx.save();
    ctx.font = `700 ${size}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (env.glow) {
      ctx.strokeStyle = rgba(this.colors.glyph, a * env.style.glowAlpha);
      ctx.lineWidth = 9;
      ctx.lineJoin = 'round';
      ctx.strokeText('₹', x, y);
    }
    ctx.strokeStyle = rgba(this.colors.outline, a * 0.9);
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText('₹', x, y);
    ctx.fillStyle = rgba(this.colors.glyph, a);
    ctx.fillText('₹', x, y);
    ctx.restore();
  }
}

/** Lost: the card breaks into a few shards that tumble down and fade (no flash, no red overlay). */
export class LostShatter implements Effect {
  private done = false;
  constructor(
    private rect: Rect,
    private card: RGB,
    private edge: RGB,
  ) {}

  update(_dt: number, env: EffectEnv) {
    if (this.done) return false;
    this.done = true;
    const full = env.intensity === 'full';
    const cols = full ? 3 : 2;
    const rows = full ? 3 : 2;
    const { x, y, width, height } = this.rect;
    const cw = width / cols;
    const ch = height / rows;
    const cx = x + width / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = x + cw * (c + 0.5);
        const py = y + ch * (r + 0.5);
        env.pool.spawn({
          kind: SHARD,
          x: px,
          y: py,
          vx: ((px - cx) / width) * 70 + rand(-14, 14),
          vy: rand(-28, 6) - (rows - r) * 4,
          ttl: rand(950, 1350),
          size: ch * 0.98,
          aspect: (cw / ch) * rand(0.92, 1.04),
          color: this.card,
          edge: this.edge,
          gravity: 240,
          drag: 0.5,
          rot: rand(-0.05, 0.05),
          spin: rand(-2.2, 2.2),
          alpha: 0.95,
          delay: (r * cols + c) * 18,
        });
      }
    }
    const n = count(8, env);
    for (let i = 0; i < n; i++) {
      env.pool.spawn({ kind: DUST, x: rand(x, x + width), y: rand(y, y + height), vx: rand(-20, 20), vy: rand(10, 60), ttl: rand(600, 1000), size: rand(0.8, 1.4), color: this.edge, alpha: 0.6 });
    }
    return false;
  }

  draw() {
    /* particles only */
  }
}
