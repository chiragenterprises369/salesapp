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
 * a bright core, fading toward the tail, with two thin side strands that weave around it. Glow
 * width and alpha are capped (--glow-alpha-max).
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
  strands = env.intensity === 'full',
) {
  if (head - tail < 0.01 || alpha <= 0.01) return;
  const steps = 22;
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) pts.push(path(tail + ((head - tail) * i) / steps));
  const a = pts[0]!;
  const b = pts[steps]!;
  const grad = (c: RGB, peak: number) => {
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, rgba(c, 0));
    g.addColorStop(0.6, rgba(c, peak * 0.5));
    g.addColorStop(1, rgba(c, peak));
    return g;
  };
  const stroke = (w: number, style: CanvasGradient | string, offset = 0, phase = 0) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const p = pts[i]!;
      let x = p.x;
      let y = p.y;
      if (offset) {
        // Normal of the path, weaving amplitude that grows toward the tail.
        const q = pts[Math.min(steps, i + 1)]!;
        const o = pts[Math.max(0, i - 1)]!;
        const dx = q.x - o.x;
        const dy = q.y - o.y;
        const len = Math.hypot(dx, dy) || 1;
        const k = offset * (1 - i / steps) * Math.sin(phase + (i / steps) * Math.PI * 1.5);
        x += (-dy / len) * k;
        y += (dx / len) * k;
      }
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  const dark = env.style.dark;
  if (env.glow) stroke(width * 3.6, grad(color, alpha * env.style.glowAlpha));
  else stroke(width * 2.6, grad(color, alpha * 0.14));
  stroke(width, grad(color, alpha * (dark ? 0.95 : 0.85)));
  if (dark) stroke(Math.max(1, width * 0.35), grad(lighten(color, 0.6), alpha * 0.9));
  if (strands) {
    const thin = Math.max(0.8, width * 0.28);
    stroke(thin, grad(lighten(color, 0.3), alpha * 0.75), width * 3.2, 0.4);
    stroke(thin, grad(color, alpha * 0.6), -width * 2.6, 1.9);
  }
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
    const tail = Math.max(0, head - 0.75 * fade);
    drawRibbon(ctx, this.path, tail, head, this.color, 0.95 * fade, env.intensity === 'full' ? 4 : 2.5, env);
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
    // Enters from the left (the board's edge clips the start), sweeps up and lands on the slot.
    this.start = { x: c.x - Math.max(300, initial.width * 1.3), y: c.y + initial.height * 0.9 };
    this.ctrl = { x: c.x - initial.width * 0.35, y: c.y - initial.height * 0.95 };
  }

  private path = (u: number): Point => quad(this.start, this.ctrl, centre(this.last), clamp01(u));
  private progress = (t: number) => 1 - Math.pow(1 - clamp01(t), 2.2);

  update(dt: number, env: EffectEnv) {
    this.age += dt;
    this.last = this.target() ?? this.last;
    const t = this.age / this.duration;
    if (t < 1 && env.intensity === 'full' && Math.random() < 0.5 * env.density) {
      const p = this.path(this.progress(t));
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
    const head = this.progress(t);
    const after = Math.max(0, this.age - this.duration) / 380;
    const fade = 1 - after;
    drawRibbon(ctx, this.path, Math.max(0, head - 0.7 * fade), head, this.color, fade, env.intensity === 'full' ? 4.5 : 2.8, env);
    // The glowing card rides the head: it grows and levels out as it nears the slot, then dissolves onto the real card.
    const show = t < 1 ? Math.min(1, t / 0.12) * (t > 0.6 ? Math.max(0, 1 - (t - 0.6) / 0.4) : 1) : 0;
    if (show <= 0.01) return;
    const p = this.path(head);
    const r = this.last;
    const s = 0.55 + 0.45 * head;
    const w = r.width * s;
    const h = r.height * s;
    const dark = env.style.dark;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-0.16 * (1 - head));
    ctx.fillStyle = rgba(this.color, show * (dark ? 0.22 : 0.14));
    roundRect(ctx, -w / 2, -h / 2, w, h, 10 * s);
    ctx.fill();
    if (env.glow) {
      ctx.strokeStyle = rgba(this.color, show * env.style.glowAlpha);
      ctx.lineWidth = 7;
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(dark ? lighten(this.color, 0.35) : this.color, show * 0.95);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // Bright top edge (like the real cards); no fake text, so the real text under it stays readable.
    ctx.strokeStyle = rgba(dark ? lighten(this.color, 0.65) : this.color, show * 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 8 * s, -h / 2 + 0.5);
    ctx.lineTo(w / 2 - 8 * s, -h / 2 + 0.5);
    ctx.stroke();
    ctx.restore();
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
    drawRibbon(ctx, this.path, Math.max(0, e - 0.4), Math.min(1, e), this.color, 0.85 * Math.min(1, fade + 0.2), env.intensity === 'full' ? 3 : 2, env);
    if (fade <= 0.01) return;
    const p = this.path(e);
    const q = this.path(Math.min(1, e + 0.02));
    const dir = Math.atan2(q.y - p.y, q.x - p.x);
    const angle = Math.max(-0.45, Math.min(0.45, dir * 0.4));
    const scale = 1 - 0.4 * clamp01((t - 0.72) / 0.28);
    const w = 28 * scale;
    const h = 19 * scale;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (env.glow) {
      ctx.fillStyle = rgba(this.color, fade * env.style.glowAlpha);
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.95, h * 1.05, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Speed lines behind the envelope.
    ctx.strokeStyle = rgba(lighten(this.color, 0.4), fade * 0.7);
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (const [o, l] of [
      [-5, 12],
      [0, 18],
      [5, 10],
    ] as const) {
      const bx = -Math.cos(dir) * (w * 0.6);
      const by = -Math.sin(dir) * (w * 0.6);
      const nx = -Math.sin(dir) * o;
      const ny = Math.cos(dir) * o;
      ctx.beginPath();
      ctx.moveTo(bx + nx, by + ny);
      ctx.lineTo(bx + nx - Math.cos(dir) * l, by + ny - Math.sin(dir) * l);
      ctx.stroke();
    }
    // The envelope is a solid object: normal paint even on additive (dark) layers.
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(angle);
    ctx.fillStyle = rgba(this.paper, fade);
    roundRect(ctx, -w / 2, -h / 2, w, h, 3);
    ctx.fill();
    ctx.strokeStyle = rgba(this.color, fade);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 1.5, -h / 2 + 1.5);
    ctx.lineTo(0, h * 0.12);
    ctx.lineTo(w / 2 - 1.5, -h / 2 + 1.5);
    ctx.lineJoin = 'round';
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
            { at: 0, x: cx, y: top + 16 },
            { at: 160, x: cx - column.width * 0.27, y: top + 50 },
            { at: 300, x: cx + column.width * 0.25, y: top + 34 },
          ]
        : [{ at: 0, x: cx, y: top + 22 }];
  }

  update(dt: number, env: EffectEnv) {
    this.age += dt;
    const palette = [this.colors.stage, this.colors.gold, lighten(this.colors.stage, 0.35), this.colors.accent];
    while (this.fired < this.shells.length && this.age >= this.shells[this.fired]!.at) {
      const s = this.shells[this.fired++]!;
      const n = count(this.fired === 1 ? 44 : 32, env);
      const fast = env.intensity === 'full' ? 1 : 0.7;
      for (let i = 0; i < n; i++) {
        const ang = (Math.PI * 2 * i) / n + rand(-0.12, 0.12);
        const sp = rand(90, 240) * fast;
        env.pool.spawn({
          kind: SPARK,
          x: s.x,
          y: s.y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 30,
          ttl: rand(650, 1100),
          size: rand(1.5, 2.4),
          color: pick(palette),
          gravity: 160,
          drag: 1.7,
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
    const rise = easeOutCubic(t / 560);
    const scale = 0.7 + 0.3 * rise;
    const x = this.column.x + this.column.width / 2;
    const y = this.column.y + 70 - 44 * rise;
    const size = Math.round(40 * scale);
    ctx.save();
    ctx.font = `700 ${size}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (env.glow) {
      // Soft halo: a few widening, fading strokes (no shadowBlur, which is costly).
      ctx.lineJoin = 'round';
      for (const [w, k] of [
        [14, 0.35],
        [7, 0.6],
      ] as const) {
        ctx.strokeStyle = rgba(this.colors.glyph, a * env.style.glowAlpha * k);
        ctx.lineWidth = w;
        ctx.strokeText('₹', x, y);
      }
    }
    // The glyph itself is solid paint, so it reads as a shape, not a blown-out blob.
    ctx.globalCompositeOperation = 'source-over';
    if (!env.style.dark) {
      ctx.strokeStyle = rgba(this.colors.outline, a * 0.9);
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeText('₹', x, y);
    }
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
    const n = env.intensity === 'full' ? 9 : 5;
    const { x, y, width, height } = this.rect;
    const cx = x + width / 2;
    // A few glass slivers peel off the card: tinted with the stage colour, falling a short way.
    const tint = { r: Math.round(this.card.r * 0.7 + this.edge.r * 0.3), g: Math.round(this.card.g * 0.7 + this.edge.g * 0.3), b: Math.round(this.card.b * 0.7 + this.edge.b * 0.3) };
    for (let i = 0; i < n; i++) {
      const px = x + width * ((i + 0.5) / n) + rand(-8, 8);
      const py = y + rand(height * 0.2, height * 0.85);
      const size = rand(14, 26);
      env.pool.spawn({
        kind: SHARD,
        x: px,
        y: py,
        vx: ((px - cx) / width) * 40 + rand(-10, 10),
        vy: rand(-18, 10),
        ttl: rand(850, 1200),
        size,
        aspect: rand(0.8, 1.4),
        color: tint,
        edge: this.edge,
        gravity: 280,
        drag: 0.6,
        rot: rand(-0.6, 0.6),
        spin: rand(-1.4, 1.4),
        alpha: 0.9,
        delay: i * 22,
      });
    }
    const dust = count(8, env);
    for (let i = 0; i < dust; i++) {
      env.pool.spawn({ kind: DUST, x: rand(x, x + width), y: rand(y, y + height), vx: rand(-20, 20), vy: rand(10, 60), ttl: rand(600, 1000), size: rand(0.8, 1.4), color: this.edge, alpha: 0.6 });
    }
    return false;
  }

  draw() {
    /* particles only */
  }
}
