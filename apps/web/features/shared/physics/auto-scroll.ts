/**
 * Edge auto-scroll while dragging. Each scroll target has an edge band; inside it the speed grows
 * with proximity (curve) and ramps up over `rampMs` the longer the pointer stays there, so a pass
 * near an edge nudges and a deliberate hold scrolls fast. Leaving the band (or `reset()`) stops it
 * at once. Fractional pixels are carried over between frames, so slow speeds stay smooth.
 */

export interface EdgeScrollConfig {
  /** Edge band (px) where scrolling starts. */
  edge: number;
  /** Top speed in px per 60 Hz frame (scaled by real frame time). */
  maxSpeed: number;
  /** Time (ms) to reach full speed after entering the band. */
  rampMs: number;
  /** Proximity exponent: 1 = linear, 2 = gentle near the band, fast at the edge. */
  curve: number;
}

export interface ScrollTarget {
  /** Stable key (e.g. 'board', 'column:<id>') so ramps survive between frames. */
  key: string;
  el: HTMLElement;
  axis: 'x' | 'y';
  /** Override the configured edge band. */
  edge?: number;
  /** How far outside the element (cross axis) the pointer may be and still scroll it (px). */
  slack?: number;
  /** How far past the scrolling edges (main axis) the pointer may be and still scroll it (px). */
  mainSlack?: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Speed factor 0..1 for a pointer `dist` px inside an edge band of `band` px. */
export function edgeProximity(dist: number, band: number, curve = 2): number {
  if (band <= 0 || dist >= band) return 0;
  return Math.pow(clamp((band - dist) / band, 0, 1), curve);
}

export class EdgeAutoScroller {
  private since = new Map<string, number>();
  private carry = new Map<string, number>();

  constructor(private cfg: EdgeScrollConfig) {}

  configure(cfg: Partial<EdgeScrollConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
  }

  /** Stop all scrolling and forget the ramps (drop, cancel). */
  reset() {
    this.since.clear();
    this.carry.clear();
  }

  /**
   * One frame. `dtMs` is the real frame time, `timeScale` the physics clock (slow motion scrolls
   * slower too). Returns true when any target actually scrolled.
   */
  step(ptr: { x: number; y: number }, targets: readonly ScrollTarget[], dtMs: number, now = performance.now(), timeScale = 1): boolean {
    let scrolled = false;
    const seen = new Set<string>();
    for (const t of targets) {
      const r = t.el.getBoundingClientRect();
      const slack = t.slack ?? 48;
      const mainSlack = t.mainSlack ?? 80;
      const band = t.edge ?? this.cfg.edge;
      let toward = 0;
      if (t.axis === 'x') {
        if (ptr.y < r.top - slack || ptr.y > r.bottom + slack) continue;
        if (ptr.x < r.left - mainSlack || ptr.x > r.right + mainSlack) continue;
        toward = edgeProximity(r.right - ptr.x, band, this.cfg.curve) - edgeProximity(ptr.x - r.left, band, this.cfg.curve);
      } else {
        if (ptr.x < r.left - slack || ptr.x > r.right + slack) continue;
        if (ptr.y < r.top - mainSlack || ptr.y > r.bottom + mainSlack) continue;
        toward = edgeProximity(r.bottom - ptr.y, band, this.cfg.curve) - edgeProximity(ptr.y - r.top, band, this.cfg.curve);
      }
      if (toward === 0) continue;
      seen.add(t.key);
      const start = this.since.get(t.key) ?? now;
      this.since.set(t.key, start);
      const ramp = this.cfg.rampMs > 0 ? clamp((now - start) / this.cfg.rampMs, 0.15, 1) : 1;
      const delta = toward * this.cfg.maxSpeed * ramp * (clamp(dtMs, 1, 64) / 16.7) * timeScale + (this.carry.get(t.key) ?? 0);
      const whole = Math.trunc(delta);
      this.carry.set(t.key, delta - whole);
      if (!whole) continue;
      if (t.axis === 'x') {
        const before = t.el.scrollLeft;
        t.el.scrollLeft = before + whole;
        if (t.el.scrollLeft !== before) scrolled = true;
      } else {
        const before = t.el.scrollTop;
        t.el.scrollTop = before + whole;
        if (t.el.scrollTop !== before) scrolled = true;
      }
    }
    for (const key of [...this.since.keys()]) {
      if (!seen.has(key)) {
        this.since.delete(key);
        this.carry.delete(key);
      }
    }
    return scrolled;
  }
}
