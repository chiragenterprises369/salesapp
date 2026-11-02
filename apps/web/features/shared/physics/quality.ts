/**
 * Adaptive quality. A frame-time monitor that only samples while something is animating
 * (`acquire()` while dragging or flying), and steps the quality tier down when the average frame
 * rate stays under the floor (45 fps) and back up after a sustained recovery.
 *
 * Tiers: high = everything; medium = no sheen, half tilt, lighter shadows; low = no tilt, sheen,
 * stagger or overshoot (springs and feedback stay). What each tier switches off is decided by
 * resolveMotionProfile(); owners only read the tier.
 */

export const QUALITY_TIERS = ['high', 'medium', 'low'] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

export interface QualityConfig {
  /** Average fps under this for `badWindows` windows steps the tier down. */
  fpsFloor: number;
  /** Average fps at or above this for `recoverMs` steps the tier back up (default floor + 10). */
  recoverFps?: number;
  /** Averaging window (ms). */
  windowMs?: number;
  /** Consecutive bad windows needed to step down (debounces one-off hitches). */
  badWindows?: number;
  /** Sustained good time needed to step up (ms). */
  recoverMs?: number;
  /** Fewer frames than this in a window: not enough data, skip it. */
  minFrames?: number;
}

export interface QualitySnapshot {
  tier: QualityTier;
  /** Tier chosen by the monitor (before any forced tier). */
  autoTier: QualityTier;
  forced: QualityTier | null;
  /** Last window's average fps (null until measured). */
  fps: number | null;
  /** Last window's average and worst frame time (ms). */
  frameMs: number | null;
  worstMs: number | null;
  sampling: boolean;
}

type Listener = () => void;

/** Frames longer than this are stalls (tab hidden, GC, debugger) and are ignored. */
const STALL_MS = 250;

export class QualityMonitor {
  private cfg: Required<QualityConfig>;
  private snap: QualitySnapshot = { tier: 'high', autoTier: 'high', forced: null, fps: null, frameMs: null, worstMs: null, sampling: false };
  private listeners = new Set<Listener>();
  private refs = 0;
  private raf = 0;
  private last = 0;
  private winStart = 0;
  private winFrames = 0;
  private winSum = 0;
  private winWorst = 0;
  private bad = 0;
  private goodSince = 0;

  constructor(cfg: QualityConfig) {
    this.cfg = QualityMonitor.fill(cfg);
  }

  private static fill(cfg: QualityConfig): Required<QualityConfig> {
    return {
      fpsFloor: cfg.fpsFloor,
      recoverFps: cfg.recoverFps ?? cfg.fpsFloor + 10,
      windowMs: cfg.windowMs ?? 500,
      badWindows: cfg.badWindows ?? 2,
      recoverMs: cfg.recoverMs ?? 4000,
      minFrames: cfg.minFrames ?? 8,
    };
  }

  configure(cfg: Partial<QualityConfig>) {
    this.cfg = QualityMonitor.fill({ ...this.cfg, ...cfg });
  }

  getSnapshot = (): QualitySnapshot => this.snap;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  get tier(): QualityTier {
    return this.snap.tier;
  }

  /** Pin a tier (demo page, tests) or `null` to follow the measurements again. */
  force(tier: QualityTier | null) {
    this.set({ forced: tier, tier: tier ?? this.snap.autoTier });
  }

  /** Sample frames until the returned release function is called. Ref-counted. */
  acquire(): () => void {
    if (typeof window === 'undefined') return () => undefined;
    if (this.refs++ === 0) this.startLoop();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.refs === 0) this.stopLoop();
    };
  }

  /** Feed a frame time from an existing loop (instead of acquire()). */
  frame(dtMs: number, now = performance.now()) {
    if (dtMs <= 0 || dtMs > STALL_MS) return;
    if (this.winFrames === 0) this.winStart = now - dtMs;
    this.winFrames++;
    this.winSum += dtMs;
    if (dtMs > this.winWorst) this.winWorst = dtMs;
    if (now - this.winStart >= this.cfg.windowMs) this.closeWindow(now);
  }

  /** Back to high, forget measurements (keeps a forced tier). */
  reset() {
    this.bad = 0;
    this.goodSince = 0;
    this.winFrames = 0;
    this.winSum = 0;
    this.winWorst = 0;
    this.set({ autoTier: 'high', tier: this.snap.forced ?? 'high', fps: null, frameMs: null, worstMs: null });
  }

  dispose() {
    this.refs = 0;
    this.stopLoop();
    this.listeners.clear();
  }

  private startLoop() {
    this.last = 0;
    this.winFrames = 0;
    this.winSum = 0;
    this.winWorst = 0;
    this.set({ sampling: true });
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (document.hidden) {
        this.last = 0;
        return;
      }
      if (this.last) this.frame(now - this.last, now);
      this.last = now;
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    // A partial window still counts if it has enough frames (short drags on slow devices).
    if (this.winFrames >= this.cfg.minFrames) this.closeWindow(performance.now());
    this.winFrames = 0;
    this.winSum = 0;
    this.winWorst = 0;
    this.set({ sampling: false });
  }

  private closeWindow(now: number) {
    const frames = this.winFrames;
    const avg = frames ? this.winSum / frames : 0;
    const worst = this.winWorst;
    this.winFrames = 0;
    this.winSum = 0;
    this.winWorst = 0;
    if (frames < this.cfg.minFrames || avg <= 0) return;
    const fps = 1000 / avg;
    let auto = this.snap.autoTier;
    const i = QUALITY_TIERS.indexOf(auto);
    if (fps < this.cfg.fpsFloor) {
      this.goodSince = 0;
      if (++this.bad >= this.cfg.badWindows && i < QUALITY_TIERS.length - 1) {
        auto = QUALITY_TIERS[i + 1]!;
        this.bad = 0;
      }
    } else {
      this.bad = 0;
      if (fps >= this.cfg.recoverFps) {
        if (!this.goodSince) this.goodSince = now;
        if (now - this.goodSince >= this.cfg.recoverMs && i > 0) {
          auto = QUALITY_TIERS[i - 1]!;
          this.goodSince = now;
        }
      } else this.goodSince = 0;
    }
    this.set({ autoTier: auto, tier: this.snap.forced ?? auto, fps: Math.round(fps * 10) / 10, frameMs: Math.round(avg * 100) / 100, worstMs: Math.round(worst * 10) / 10 });
  }

  private set(patch: Partial<QualitySnapshot>) {
    const next = { ...this.snap, ...patch };
    const changed = (Object.keys(patch) as Array<keyof QualitySnapshot>).some((k) => next[k] !== this.snap[k]);
    if (!changed) return;
    this.snap = next;
    for (const l of this.listeners) l();
  }
}
