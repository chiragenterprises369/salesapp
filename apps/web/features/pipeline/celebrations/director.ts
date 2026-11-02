import type { QualityMonitor, QualityTier, SpringParams } from '@/features/shared/physics';
import type { BoardMotionEvent } from '../drag/controller';
import type { Rect } from '../drag/types';
import { EnvelopeFlight, FlightRibbon, LostShatter, RingPulse, StreamIn, WonBurst } from './effects';
import { CelebrationEngine, type EngineStats } from './engine';
import type { BoardDiff, BoardEvent } from './events';
import { cssVar, lighten, sourceColor, stageColor, surfaceColor, tokenColor, type BoardSkinName, type PaintStyle } from './palette';
import { CelebrationSchedule } from './schedule';

/**
 * Turns board events into effects. Semantics come from the board diff (what happened); geometry
 * and timing come from the board controller (where a card flies and lands), so a stage move's
 * ribbon follows the real arc and arrival effects start when the card settles.
 *
 * Test hooks on the layer element: data-celebrations (set by React), data-last-event,
 * data-last-effect, data-event-count, data-won-bursts, data-won-skipped, data-won-queued,
 * data-active-particles, data-peak-particles, data-effects, data-running.
 */

export type LayerMode = 'full' | 'subtle' | 'fade';

export interface WonTotalLabel {
  key: number;
  /** Viewport point: centre of the column's top edge. */
  x: number;
  y: number;
  from: number;
  to: number;
  /** CSS colour of the column's stage. */
  color: string;
  animate: boolean;
}

type FlightEvent = Extract<BoardMotionEvent, { type: 'flight' }>;
type DropInEvent = Extract<BoardMotionEvent, { type: 'drop-in' }>;

interface Pending {
  event: BoardEvent;
  flown: boolean;
  timer: number;
}

interface WonItem {
  event: BoardEvent;
  rect: Rect | null;
}

/** Flights and drop-ins are matched to diff events within this window (same commit). */
const MATCH_MS = 500;
/** At most this many animated arrivals per board render (bursts and resyncs coalesce to fades). */
const MAX_ANIMATED_NEW = 3;
const MAX_ANIMATED_MOVES = 4;
const FADE_MS = 700;

const FACE = '[aria-roledescription="draggable card"], [role="checkbox"]';

function toRect(r: DOMRect): Rect {
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function inViewport(r: Rect): boolean {
  return r.width > 0 && r.height > 0 && r.x + r.width > 0 && r.y + r.height > 0 && r.x < window.innerWidth && r.y < window.innerHeight;
}

export class CelebrationDirector {
  private engine: CelebrationEngine | null = null;
  private readonly schedule = new CelebrationSchedule<WonItem>();
  private flights = new Map<string, { e: FlightEvent; t: number }>();
  private dropIns = new Map<string, { e: DropInEvent; t: number }>();
  private pending = new Map<string, Pending>();
  private wonTimer = 0;
  private hidden = false;
  private mode: LayerMode = 'full';
  private tier: QualityTier = 'high';
  private timeScale = 1;
  private arcHeight = 90;
  private flight: SpringParams = { stiffness: 300, damping: 24, mass: 1 };
  private events = 0;
  private labelKey = 0;
  private disposed = false;

  constructor(
    private layer: HTMLElement,
    private fades: HTMLElement,
    private getRoot: () => HTMLElement | null,
    private onWonTotal: (label: WonTotalLabel) => void,
  ) {
    const d = layer.dataset;
    d.lastEvent = '';
    d.lastEffect = '';
    d.eventCount = '0';
    d.wonBursts = '0';
    d.wonSkipped = '0';
    d.wonQueued = '0';
    this.writeStats({ running: false, particles: 0, peak: 0, effects: 0 });
  }

  // ------------------------------------------------------------------ setup

  attachCanvas(canvas: HTMLCanvasElement | null, quality: QualityMonitor | null) {
    this.engine?.dispose();
    this.engine = null;
    if (!canvas || this.disposed) return;
    this.engine = new CelebrationEngine(canvas, {
      bounds: () => this.getRoot()?.getBoundingClientRect() ?? null,
      onStats: (s) => this.writeStats(s),
      quality,
    });
    this.engine.setHidden(this.hidden);
    this.refresh();
  }

  configure(o: { mode: LayerMode; tier: QualityTier; timeScale: number; arcHeight: number; flight: SpringParams }) {
    this.mode = o.mode;
    this.tier = o.tier;
    this.timeScale = o.timeScale;
    this.arcHeight = o.arcHeight;
    this.flight = o.flight;
    this.refresh();
  }

  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.engine?.setHidden(hidden);
    if (hidden) {
      // Nobody sees a hidden tab: drop what is waiting instead of replaying it later.
      for (const p of this.pending.values()) window.clearTimeout(p.timer);
      this.pending.clear();
      this.schedule.clear();
      window.clearTimeout(this.wonTimer);
      this.wonTimer = 0;
      this.layer.dataset.wonQueued = '0';
    }
  }

  dispose() {
    this.disposed = true;
    this.setHidden(true);
    this.engine?.dispose();
    this.engine = null;
    this.fades.replaceChildren();
  }

  private style(): PaintStyle {
    const html = document.documentElement;
    const dark = html.dataset.theme === 'dark';
    const glowAlpha = Number.parseFloat(cssVar(html, '--glow-alpha-max')) || 0.35;
    // Aurora (neon in light) and every light theme: colour without glow.
    return { dark, skin: this.skin(), additive: dark, glow: dark, glowAlpha: Math.min(0.45, glowAlpha) };
  }

  private skin(): BoardSkinName {
    const s = this.getRoot()?.dataset.boardSkin;
    return s === 'flat' || s === 'neon' || s === 'depth' ? s : 'depth';
  }

  /** Re-read theme and skin (cheap) and push the paint settings to the engine. */
  private refresh(): PaintStyle {
    const style = this.style();
    this.engine?.configure({ intensity: this.mode === 'subtle' ? 'subtle' : 'full', tier: this.tier, style, timeScale: this.timeScale });
    return style;
  }

  private writeStats(s: EngineStats) {
    const d = this.layer.dataset;
    d.running = s.running ? 'true' : 'false';
    d.activeParticles = String(s.particles);
    d.peakParticles = String(s.peak);
    d.effects = String(s.effects);
  }

  private mark(effect: string) {
    this.layer.dataset.lastEffect = effect;
  }

  private ms(duration: number) {
    return duration / this.timeScale;
  }

  // ------------------------------------------------------------------ DOM lookups

  private column(stageId: string): HTMLElement | null {
    return this.getRoot()?.querySelector<HTMLElement>(`section[data-stage-id="${CSS.escape(stageId)}"]`) ?? null;
  }

  private card(leadId: string): HTMLElement | null {
    return this.getRoot()?.querySelector<HTMLElement>(`li[data-lead-id="${CSS.escape(leadId)}"]`) ?? null;
  }

  private cardRect(leadId: string): Rect | null {
    const li = this.card(leadId);
    if (!li) return null;
    const r = toRect((li.querySelector(FACE) ?? li).getBoundingClientRect());
    return inViewport(r) ? r : null;
  }

  private columnRect(stageId: string): Rect | null {
    const col = this.column(stageId);
    if (!col) return null;
    const r = toRect(col.getBoundingClientRect());
    return inViewport(r) ? r : null;
  }

  // ------------------------------------------------------------------ inputs

  /** Controller motion (flights, landings, drop-ins). */
  onMotion(e: BoardMotionEvent) {
    const now = performance.now();
    const id = e.lead.id;
    if (e.type === 'flight') {
      this.flights.set(id, { e, t: now });
      if (e.kind === 'rollback') {
        this.cancel(id);
        return;
      }
      const p = this.pending.get(id);
      if (p && !p.flown && this.mode !== 'fade' && !this.hidden) {
        p.flown = true;
        this.ribbon(p.event, e);
      }
    } else if (e.type === 'drop-in') {
      this.dropIns.set(id, { e, t: now });
    } else if (e.kind === 'move') {
      const p = this.pending.get(id);
      if (!p) return;
      window.clearTimeout(p.timer);
      this.pending.delete(id);
      this.arrive(p.event, inViewport(e.rect) ? e.rect : null);
    }
    if (this.flights.size > 64) this.prune(now);
  }

  /** Events from a board render. */
  onBoardDiff(diff: BoardDiff) {
    if (this.disposed) return;
    if (diff.bulk) {
      this.mark('bulk');
      return;
    }
    if (diff.events.length === 0) return;
    const now = performance.now();
    this.refresh();
    let animatedNew = 0;
    let animatedMoves = 0;
    for (const ev of diff.events) {
      const id = ev.lead.id;
      this.events++;
      this.layer.dataset.lastEvent = ev.kind;
      this.layer.dataset.eventCount = String(this.events);
      if (this.hidden) {
        this.mark(`${ev.kind}:hidden`);
        continue;
      }
      const flight = this.fresh(this.flights, id, now);
      // A failed save flying back, or the reverse of a move still waiting to land: no celebration.
      const waiting = this.pending.get(id);
      if (flight?.e.kind === 'rollback' || (waiting && waiting.event.fromStageId === ev.toStageId && ev.kind !== 'new-lead')) {
        this.cancel(id);
        this.mark(`${ev.kind}:rollback`);
        continue;
      }
      if (this.mode === 'fade') {
        this.fade(ev);
        continue;
      }
      if (ev.kind === 'new-lead') {
        if (animatedNew++ < MAX_ANIMATED_NEW) this.streamIn(ev);
        else this.fade(ev);
        continue;
      }
      // Wins always go through the Won schedule; other moves beyond the cap just fade.
      if (ev.kind !== 'won' && animatedMoves++ >= MAX_ANIMATED_MOVES) {
        this.fade(ev);
        continue;
      }
      if (flight) this.ribbon(ev, flight.e);
      this.await(ev, !!flight, now);
    }
  }

  // ------------------------------------------------------------------ flow

  private fresh<T>(map: Map<string, { e: T; t: number }>, id: string, now: number): { e: T; t: number } | null {
    const hit = map.get(id);
    return hit && now - hit.t < MATCH_MS ? hit : null;
  }

  private prune(now: number) {
    for (const [k, v] of this.flights) if (now - v.t > MATCH_MS * 4) this.flights.delete(k);
    for (const [k, v] of this.dropIns) if (now - v.t > MATCH_MS * 4) this.dropIns.delete(k);
  }

  private cancel(id: string) {
    const p = this.pending.get(id);
    if (p) window.clearTimeout(p.timer);
    this.pending.delete(id);
    this.schedule.dropQueued((w) => w.event.lead.id === id);
    this.layer.dataset.wonQueued = String(this.schedule.queued);
  }

  /** Wait for the card to land (flight end or drop settle); fall back to the DOM if no landing comes. */
  private await(ev: BoardEvent, flown: boolean, now: number) {
    const id = ev.lead.id;
    const prev = this.pending.get(id);
    if (prev) window.clearTimeout(prev.timer);
    // A moved card that was not mounted where it came from drops in from above: arrive as it settles.
    const droppedIn = !flown && this.fresh(this.dropIns, id, now);
    const wait = this.ms(droppedIn ? 420 : flown ? 1500 : 1200);
    const timer = window.setTimeout(() => {
      if (this.pending.get(id)?.timer !== timer) return;
      this.pending.delete(id);
      this.arrive(ev, this.cardRect(id));
    }, wait);
    this.pending.set(id, { event: ev, flown, timer });
  }

  private ribbon(ev: BoardEvent, f: FlightEvent) {
    if (!this.engine) return;
    const color = stageColor(this.column(ev.toStageId), this.engine.style);
    this.engine.add(new FlightRibbon(f.from, f.to, this.arcHeight, this.flight, color));
  }

  private streamIn(ev: BoardEvent) {
    const engine = this.engine;
    const id = ev.lead.id;
    const rect = this.fresh(this.dropIns, id, performance.now())?.e.rect ?? this.cardRect(id);
    if (!engine || !rect || !inViewport(rect)) {
      this.fade(ev);
      return;
    }
    if (this.schedule.offerPulse(performance.now()) === 'quiet') {
      this.fade(ev);
      return;
    }
    const color = sourceColor(ev.lead.source, engine.style);
    engine.add(new StreamIn(() => this.cardRect(id), rect, color, engine.intensity === 'full' ? 460 : 380));
    this.mark('new-lead:stream');
  }

  /** The card settled in its new column: the arrival effect for the event. */
  private arrive(ev: BoardEvent, rect: Rect | null) {
    if (this.hidden || this.disposed) return;
    const engine = this.engine;
    if (!engine || this.mode === 'fade') {
      this.fade(ev);
      return;
    }
    const now = performance.now();
    const style = this.refresh();
    const col = this.column(ev.toStageId);
    const color = stageColor(col, style);

    if (ev.kind === 'won') {
      const item: WonItem = { event: ev, rect };
      const d = this.schedule.offerWon(item, now);
      if (d === 'play') this.burst(item);
      else if (d === 'queued') {
        this.mark('won:queued');
        this.armWonTimer();
      } else {
        this.mark('won:skipped');
        this.layer.dataset.wonSkipped = String(this.schedule.stats.wonSkipped);
        if (rect) engine.add(new RingPulse(rect, color));
      }
      this.layer.dataset.wonQueued = String(this.schedule.queued);
      return;
    }

    const target = rect ?? this.columnHead(ev.toStageId);
    if (!target) {
      this.mark(`${ev.kind}:offscreen`);
      return;
    }
    if (this.schedule.offerPulse(now) === 'quiet') {
      this.fade(ev);
      return;
    }
    if (ev.kind === 'stage-move') {
      engine.add(new RingPulse(target, color));
      this.mark('stage-move:ring');
    } else if (ev.kind === 'quote-sent') {
      const head = this.columnHead(ev.toStageId);
      engine.add(new RingPulse(target, color));
      if (head) {
        const paper = style.dark ? lighten(color, 0.82) : tokenColor('--surface', style);
        engine.add(new EnvelopeFlight({ x: target.x + target.width - 16, y: target.y + 10 }, { x: head.x + head.width / 2, y: head.y + head.height / 2 }, color, paper));
      }
      this.mark('quote-sent:envelope');
    } else if (ev.kind === 'lost') {
      const li = rect ? this.card(ev.lead.id) : null;
      if (li && typeof li.animate === 'function') {
        // The card dissolves into its shards and comes back quietly in Lost (opacity only).
        li.animate([{ opacity: 1 }, { opacity: 0, offset: 0.12 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], { duration: this.ms(1400), easing: 'ease-out' });
      }
      const face = li?.querySelector(FACE) ?? null;
      if (rect) engine.add(new LostShatter(rect, surfaceColor(face, style), color));
      else engine.add(new RingPulse(target, color));
      this.mark('lost:shards');
    }
  }

  /** The column header band (stage name, count, total). */
  private columnHead(stageId: string): Rect | null {
    const col = this.column(stageId);
    if (!col) return null;
    const header = col.querySelector('header') ?? col;
    const r = toRect(header.getBoundingClientRect());
    return inViewport(r) ? r : null;
  }

  private armWonTimer() {
    if (this.wonTimer) return;
    const wait = this.schedule.msUntilNextWon(performance.now());
    if (wait === null) return;
    // Wall-clock on purpose: the 2 s limit is a safety rule, not part of the animation.
    this.wonTimer = window.setTimeout(() => {
      this.wonTimer = 0;
      const item = this.schedule.takeDueWon(performance.now());
      this.layer.dataset.wonQueued = String(this.schedule.queued);
      if (item) this.burst({ ...item, rect: this.cardRect(item.event.lead.id) ?? item.rect });
      if (this.schedule.queued) this.armWonTimer();
    }, wait + 4);
  }

  private burst(item: WonItem) {
    const engine = this.engine;
    const { event: ev, rect } = item;
    this.layer.dataset.wonBursts = String(this.schedule.stats.wonPlayed);
    this.mark('won:burst');
    const colRect = this.columnRect(ev.toStageId);
    if (!engine || !colRect || this.hidden) return;
    const style = this.refresh();
    const col = this.column(ev.toStageId);
    const stage = stageColor(col, style);
    if (rect) engine.add(new RingPulse(rect, stage));
    engine.add(
      new WonBurst(
        colRect,
        {
          stage,
          gold: tokenColor('--warning', style),
          accent: tokenColor('--accent', style),
          glyph: style.dark ? lighten(stage, 0.15) : stage,
          outline: style.dark ? stage : { r: 255, g: 255, b: 255 },
        },
        engine.intensity,
      ),
    );
    this.label(ev, colRect, true);
  }

  private label(ev: BoardEvent, colRect: Rect, animate: boolean) {
    const col = this.column(ev.toStageId);
    this.onWonTotal({
      key: ++this.labelKey,
      x: colRect.x + colRect.width / 2,
      y: colRect.y,
      from: ev.totalBefore,
      to: ev.totalAfter,
      color: (col && cssVar(col, '--vb-stage')) || 'var(--accent)',
      animate,
    });
  }

  /** Reduced motion, Off, Flat skin or a quiet slot: a simple highlight that fades in and out (opacity only). */
  private fade(ev: BoardEvent) {
    this.mark(`${ev.kind}:fade`);
    if (this.hidden) return;
    const target = this.cardRect(ev.lead.id) ?? this.columnHead(ev.toStageId);
    const col = this.column(ev.toStageId);
    if (ev.kind === 'won' && this.mode === 'fade') {
      const colRect = this.columnRect(ev.toStageId);
      if (colRect) this.label(ev, colRect, false);
    }
    if (!target || this.fades.childElementCount > 12) return;
    const el = document.createElement('div');
    const color = (col && cssVar(col, '--vb-stage')) || 'var(--accent)';
    el.dataset.celebrationFade = ev.kind;
    Object.assign(el.style, {
      position: 'fixed',
      left: `${target.x - 3}px`,
      top: `${target.y - 3}px`,
      width: `${target.width + 6}px`,
      height: `${target.height + 6}px`,
      borderRadius: '12px',
      background: `color-mix(in srgb, ${color} 16%, transparent)`,
      boxShadow: `inset 0 0 0 2px color-mix(in srgb, ${color} 55%, transparent)`,
      opacity: '0',
    });
    this.fades.appendChild(el);
    const done = () => el.remove();
    if (typeof el.animate !== 'function') {
      window.setTimeout(done, FADE_MS);
      return;
    }
    const a = el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-in-out' });
    a.onfinish = done;
    a.oncancel = done;
  }
}
