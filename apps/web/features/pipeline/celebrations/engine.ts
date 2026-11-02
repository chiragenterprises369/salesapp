import type { QualityMonitor, QualityTier } from '@/features/shared/physics';
import type { Effect, EffectEnv } from './effects';
import type { PaintStyle } from './palette';
import { PARTICLE_CAP, ParticlePool } from './particles';

/**
 * The one celebrations canvas: DPR-aware, sized to the board (clipped to the viewport), drawn
 * with requestAnimationFrame only while an effect or particle is alive, paused while the tab is
 * hidden. The particle budget follows the quality tier and intensity (particles and glow go first).
 * While it runs it feeds frames to the board's QualityMonitor, so heavy bursts step the tier down.
 */

export interface EngineStats {
  running: boolean;
  particles: number;
  peak: number;
  effects: number;
}

/** Particle budget per tier (Full); Subtle uses 45% of it. */
const TIER_BUDGET: Record<QualityTier, number> = { high: PARTICLE_CAP, medium: 180, low: 90 };
const MAX_EFFECTS = 24;
const STATS_EVERY = 4;

export class CelebrationEngine {
  readonly pool = new ParticlePool(PARTICLE_CAP);
  private effects: Effect[] = [];
  private raf = 0;
  private last = 0;
  private hidden = false;
  private frameNo = 0;
  private releaseQuality: (() => void) | null = null;
  private ctx: CanvasRenderingContext2D | null;
  private box = { x: 0, y: 0, w: 0, h: 0, dpr: 1 };
  private env: EffectEnv;
  private tier: QualityTier = 'high';
  private timeScale = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private hooks: {
      /** Area to paint (the board root), viewport coordinates. */
      bounds: () => DOMRect | null;
      onStats: (s: EngineStats) => void;
      quality: QualityMonitor | null;
    },
  ) {
    this.ctx = canvas.getContext('2d');
    const style: PaintStyle = { dark: true, skin: 'depth', additive: true, glow: true, glowAlpha: 0.35 };
    this.env = { pool: this.pool, style, intensity: 'full', density: 1, glow: true, add: (e) => this.add(e) };
  }

  configure(o: { intensity: 'full' | 'subtle'; tier: QualityTier; style: PaintStyle; timeScale: number }) {
    this.tier = o.tier;
    this.timeScale = o.timeScale;
    const budget = TIER_BUDGET[o.tier] * (o.intensity === 'subtle' ? 0.45 : 1);
    this.pool.setBudget(budget);
    this.env.style = o.style;
    this.env.intensity = o.intensity;
    this.env.density = budget / PARTICLE_CAP;
    this.env.glow = o.style.glow && o.tier !== 'low';
  }

  get style(): PaintStyle {
    return this.env.style;
  }

  get intensity(): 'full' | 'subtle' {
    return this.env.intensity;
  }

  get running(): boolean {
    return this.raf !== 0;
  }

  add(e: Effect) {
    if (this.effects.length >= MAX_EFFECTS) this.effects.shift();
    this.effects.push(e);
    this.start();
  }

  setHidden(hidden: boolean) {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (hidden) this.pause();
    else if (this.effects.length || this.pool.count) this.start();
  }

  /** Drop everything (intensity Off, unmount). */
  clear() {
    this.effects = [];
    this.pool.clear();
    this.pause();
    this.wipe();
    this.emit();
  }

  dispose() {
    this.clear();
    this.ctx = null;
  }

  private start() {
    if (this.raf || this.hidden || !this.ctx) return;
    this.last = 0;
    this.releaseQuality = this.hooks.quality?.acquire() ?? null;
    this.raf = requestAnimationFrame(this.frame);
    this.emit();
  }

  private pause() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.releaseQuality?.();
    this.releaseQuality = null;
    this.emit();
  }

  private emit() {
    this.hooks.onStats({ running: this.raf !== 0, particles: this.pool.count, peak: this.pool.peak, effects: this.effects.length });
  }

  private wipe() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Fit the canvas to the board area inside the viewport. Returns false when nothing is visible. */
  private place(): boolean {
    const r = this.hooks.bounds();
    if (!r) return false;
    const x = Math.max(0, Math.floor(r.left));
    const y = Math.max(0, Math.floor(r.top));
    const w = Math.min(window.innerWidth, Math.ceil(r.right)) - x;
    const h = Math.min(window.innerHeight, Math.ceil(r.bottom)) - y;
    if (w <= 0 || h <= 0) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier === 'low' ? 1 : 2);
    const b = this.box;
    if (b.w !== w || b.h !== h || b.dpr !== dpr) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    if (b.x !== x || b.y !== y) this.canvas.style.transform = `translate(${x}px, ${y}px)`;
    this.box = { x, y, w, h, dpr };
    return true;
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const raw = this.last ? Math.min(50, now - this.last) : 16.7;
    this.last = now;
    const dt = raw * this.timeScale;
    const env = this.env;

    this.effects = this.effects.filter((e) => e.update(dt, env));
    this.pool.step(dt);

    const ctx = this.ctx;
    if (ctx && this.place()) {
      const { x, y, dpr } = this.box;
      this.wipe();
      ctx.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
      ctx.globalCompositeOperation = env.style.additive ? 'lighter' : 'source-over';
      for (const e of this.effects) e.draw(ctx, env);
      this.pool.draw(ctx, { glow: env.glow, glowAlpha: env.style.glowAlpha * 0.6, additive: env.style.additive });
      ctx.globalCompositeOperation = 'source-over';
    }

    if (this.effects.length === 0 && this.pool.count === 0) {
      this.pause();
      this.wipe();
      return;
    }
    if (++this.frameNo % STATS_EVERY === 0) this.emit();
  };
}
