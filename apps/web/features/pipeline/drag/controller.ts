import type { LeadListItem } from '@vistar/shared';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  capVelocity,
  EdgeAutoScroller,
  PointerPickup,
  resolveMotionProfile,
  springConfig,
  tiltFromVelocity,
  trackPointerSession,
  VelocityTracker,
  type MotionProfile,
  type PickupActivation,
  type QualityMonitor,
  type ScrollTarget,
  type SpringParams,
} from '@/features/shared/physics';
import { DEFAULT_BOARD_PHYSICS, type BoardPhysicsConfig } from '../board-physics.config';
import { dropIn, fadeIn, pulseRing } from './effects';
import type { ActiveDrag, CardHandle, ColumnGeometry, ColumnHandle, CommitMove, DragState, DropTarget, OverlayHandle, Rect } from './types';

/**
 * Board drag engine (one instance per board). Imperative on purpose: pointer frames never go
 * through React. The store only changes when the drop slot changes, so a drag re-renders a handful
 * of components (the two placeholders and two column frames), never the cards.
 *
 * Physics come from features/shared/physics (pick-up, pointer session, velocity + tilt, auto-scroll,
 * quality tier, motion profile); every constant comes from board-physics.config.ts.
 *
 * Layout model while dragging: the origin card stays in place as a dashed placeholder; the hovered
 * column opens a gap (cards after the slot translate down by the card height, in a short wave).
 * Everything is transforms, so geometry is measured once at pick-up and hit testing reads cached
 * rest positions. After a drop the board renders the move at once (see BoardView) and each column
 * runs a FLIP pass from the old visual positions, so the gap at the origin closes with a spring.
 * Cards that change column without a local drag (realtime, menu, deck, rollback) fly along an arc.
 */

const DEPARTURE_TTL = 1500;
const ROLLBACK_TTL = 4000;
const REFLOW_MS = 1200;

/** Lower-case display words for announcements (configurable labels). */
export interface BoardWords {
  lead: string;
  leads: string;
}

export interface BoardConfig {
  canDrag: boolean;
  /** Select mode: dragging a selected card carries every selected card as a deck. */
  selectMode: boolean;
  selectedIds: () => ReadonlySet<string>;
  profile: MotionProfile;
  physics: BoardPhysicsConfig;
  timeScale: number;
  /** Gap between cards in a column (px). */
  gap: number;
  stageOrder: readonly string[];
  stageNames: ReadonlyMap<string, string>;
  /** Total leads per stage (BoardColumn.count), for "position 2 of 7". */
  counts: ReadonlyMap<string, number>;
  words: BoardWords;
  commit: (moves: CommitMove[]) => void;
  /** Touch press-and-release (long-press without moving): open the card's actions sheet. */
  openActions: (lead: LeadListItem, stageId: string) => void;
  quality: QualityMonitor | null;
}

interface Slot {
  id: string;
  top: number;
  height: number;
}

interface Departure {
  list: HTMLElement;
  top: number;
  height: number;
  y: number;
  t: number;
}

interface Landing {
  id: string;
  vx: number;
  vy: number;
  fallback: Rect;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function intersectsViewport(r: Rect): boolean {
  return r.x + r.width > 0 && r.y + r.height > 0 && r.x < window.innerWidth && r.y < window.innerHeight;
}

/** Write a card's vertical nudge. 2D translate on purpose: translate3d would promote every nudged card to its own layer. */
export function writeNudge(el: HTMLElement | null, v: number) {
  if (el) el.style.transform = Math.abs(v) < 0.01 ? '' : `translateY(${v}px)`;
}

/** Same stiffness, at least critically damped: lands without overshoot. */
function noOvershoot(p: SpringParams): SpringParams {
  const m = p.mass ?? 1;
  return { ...p, damping: Math.max(p.damping, 2 * Math.sqrt(p.stiffness * m)) };
}

export class BoardController {
  readonly store: StoreApi<DragState> = createStore<DragState>()(() => ({ phase: 'idle', active: null, over: null, flights: [] }));
  readonly cards = new Map<string, CardHandle>();
  /** Horizontal board scroller. */
  private board: HTMLElement | null = null;
  /** aria-live region. */
  private live: HTMLElement | null = null;
  private overlay: OverlayHandle | null = null;

  private cfg: BoardConfig = {
    canDrag: false,
    selectMode: false,
    selectedIds: () => new Set(),
    profile: resolveMotionProfile({ reducedMotion: false }),
    physics: DEFAULT_BOARD_PHYSICS,
    timeScale: 1,
    gap: 8,
    stageOrder: [],
    stageNames: new Map(),
    counts: new Map(),
    words: { lead: 'lead', leads: 'leads' },
    commit: () => undefined,
    openActions: () => undefined,
    quality: null,
  };
  private columns = new Map<string, ColumnHandle>();
  private geometries = new Map<string, ColumnGeometry>();
  private slotCache = new Map<string, Slot[]>();
  private indexCache = new Map<string, Map<string, number>>();

  private press: { lead: LeadListItem; stageId: string } | null = null;
  private readonly pickup = new PointerPickup({
    onActivate: (a) => this.activatePointer(a),
    onAbort: () => {
      this.press = null;
    },
  });
  private stopSession: (() => void) | null = null;
  private releaseQuality: (() => void) | null = null;
  private releaseFlightQuality: (() => void) | null = null;
  private readonly vel = new VelocityTracker(DEFAULT_BOARD_PHYSICS.velocityTauMs);
  private readonly scroller = new EdgeAutoScroller({ edge: 72, maxSpeed: 18, rampMs: 350, curve: 2 });
  private ptr = { x: 0, y: 0 };
  private pos = { x: 0, y: 0 };
  private pointerStart = { x: 0, y: 0 };
  private travel = 0;
  private lastTick = 0;
  private raf = 0;
  private suppressClickUntil = 0;

  private landing: Landing | null = null;
  private landToken = 0;
  private landTimer = 0;
  /** Id of the card that is landing on a new slot (confirmation ring when it settles). */
  private landedMove: string | null = null;
  private focusAfter: { id: string; scroll: boolean; t: number } | null = null;
  private departures = new Map<string, Departure>();
  private arrivals = new Set<string>();
  private rollbacks = new Map<string, number>();
  private reflowUntil = 0;
  private flightSeq = 0;
  private liveFlip = false;

  configure(patch: Partial<BoardConfig>) {
    Object.assign(this.cfg, patch);
    if (patch.physics) {
      const p = patch.physics;
      this.vel.tauMs = p.velocityTauMs;
      this.scroller.configure({ maxSpeed: p.autoScroll.maxSpeed, rampMs: p.autoScroll.rampMs, curve: p.autoScroll.curve, edge: p.autoScroll.boardEdge });
    }
  }

  get profile(): MotionProfile {
    return this.cfg.profile;
  }

  get physics(): BoardPhysicsConfig {
    return this.cfg.physics;
  }

  /** Current physics time scale (slow motion on the demo page). */
  timeScale(): number {
    return this.cfg.timeScale;
  }

  /** Board scroller + live region (BoardView). Returns a detach function. */
  attachBoard(board: HTMLElement, live: HTMLElement) {
    this.board = board;
    this.live = live;
    return () => {
      if (this.board === board) this.board = null;
      if (this.live === live) this.live = null;
    };
  }

  /** Ghost springs (DragLayer). Returns a detach function. */
  attachOverlay(handle: OverlayHandle) {
    this.overlay = handle;
    return () => {
      if (this.overlay === handle) this.overlay = null;
    };
  }

  private spring(p: SpringParams, velocity?: number) {
    return springConfig(p, { timeScale: this.cfg.timeScale, velocity, precision: 0.3 });
  }

  /** Real-time duration stretched by slow motion. */
  private ms(duration: number) {
    return duration / this.cfg.timeScale;
  }

  // ------------------------------------------------------------------ registry

  registerColumn(handle: ColumnHandle) {
    this.columns.set(handle.stageId, handle);
  }

  unregisterColumn(handle: ColumnHandle) {
    if (this.columns.get(handle.stageId) === handle) this.columns.delete(handle.stageId);
  }

  setGeometry(stageId: string, geo: ColumnGeometry) {
    this.geometries.set(stageId, geo);
    this.invalidate(stageId);
  }

  clearGeometry(stageId: string, geo: ColumnGeometry) {
    if (this.geometries.get(stageId) === geo) this.geometries.delete(stageId);
    this.invalidate(stageId);
  }

  registerCard(h: CardHandle) {
    this.cards.set(h.id, h);
    h.shift = this.shiftFor(h.stageId, h.id);
    this.snap(h, h.shift);
  }

  /**
   * Instant nudge: set the spring and write the transform now. The spring's own DOM writes are
   * scheduled for the next frame and a re-render of the card can cancel them, which would leave a
   * stale transform when React's last rendered value happens to match (reduced motion, flat mode).
   */
  private snap(h: CardHandle, v: number) {
    h.y.set(v);
    writeNudge(h.nudge, v);
  }

  unregisterCard(h: CardHandle) {
    window.clearTimeout(h.shiftTimer);
    if (this.cards.get(h.id) === h) this.cards.delete(h.id);
    // No layout reads here (mass unmounts must stay cheap): keep what is needed to rebuild the rect.
    this.departures.set(h.id, { list: h.list, top: h.restTop, height: h.height, y: h.y.get(), t: performance.now() });
  }

  /** Column data changed: drop cached geometry and indexes. */
  invalidate(stageId: string) {
    this.slotCache.delete(stageId);
    this.indexCache.delete(stageId);
  }

  noteArrival(id: string) {
    this.arrivals.add(id);
  }

  /** A save failed and the data layer is rolling this card back: its return trip is a rollback. */
  noteRollback(id: string) {
    this.rollbacks.set(id, performance.now());
  }

  /** Filters changed: cards that appear now fade in (no "new lead" drop). */
  beginReflow() {
    this.reflowUntil = performance.now() + REFLOW_MS;
  }

  private takeRollback(id: string, now: number): boolean {
    const t = this.rollbacks.get(id);
    if (t === undefined) return false;
    this.rollbacks.delete(id);
    return now - t < ROLLBACK_TTL;
  }

  /**
   * Column layout pass for one card: record its rest geometry and FLIP it when its rest position
   * moved (stay where it was on screen, then spring to the new place plus any drag nudge).
   */
  relayout(h: CardHandle, prevTop: number | undefined, top: number, height: number) {
    h.restTop = top;
    h.height = height;
    if (prevTop === undefined || prevTop === top) return;
    const target = this.shiftFor(h.stageId, h.id);
    h.shift = target;
    const s = this.store.getState();
    if (!this.cfg.profile.springs || s.active?.lead.id === h.id) {
      this.snap(h, target);
      return;
    }
    const delta = prevTop + h.y.get() - top;
    if (Math.abs(delta - target) < 0.5) {
      this.snap(h, target);
      return;
    }
    this.snap(h, delta);
    h.y.start(target, { config: this.spring(this.cfg.physics.gap) });
  }

  /** Virtual rows report their rest top as they render. */
  setRestTop(id: string, li: HTMLElement, top: number) {
    const h = this.cards.get(id);
    if (h && h.li === li) h.restTop = top;
  }

  /** Static lists: rest geometry straight from the DOM (one layout read pass). */
  measureList(list: HTMLElement) {
    for (const h of this.cards.values()) {
      if (h.list !== list) continue;
      h.restTop = h.li.offsetTop;
      h.height = h.li.offsetHeight;
    }
  }

  /** Static lists: a card's cached rest geometry. */
  cardSlot(id: string, list: HTMLElement): { top: number; height: number } | null {
    const h = this.cards.get(id);
    return h && h.list === list ? { top: h.restTop, height: h.height } : null;
  }

  /** Runs after every board commit (BoardView layout effect, after all columns). */
  afterCommit() {
    if (this.landing) this.startLanding();
    const now = performance.now();

    if (this.focusAfter) {
      const { id, scroll, t } = this.focusAfter;
      const h = this.cards.get(id);
      if (h) {
        this.focusAfter = null;
        if (document.activeElement !== h.card) h.card.focus({ preventScroll: !scroll });
      } else if (now - t > DEPARTURE_TTL) this.focusAfter = null;
    }

    if (this.arrivals.size) {
      const s = this.store.getState();
      const { profile, physics } = this.cfg;
      const reflow = now < this.reflowUntil;
      for (const id of this.arrivals) {
        if (s.active?.lead.id === id && s.phase !== 'idle') continue;
        const h = this.cards.get(id);
        if (!h) continue;
        const d = this.departures.get(id);
        const rolled = this.takeRollback(id, now);
        if (d && now - d.t <= DEPARTURE_TTL && d.list.isConnected) {
          // Known card that changed place without a local drag: fly it over (arc).
          if (!profile.springs) {
            fadeIn(h.li, physics.fadeMs);
            if (rolled) pulseRing(h.ring, 'danger', physics.ringPulseMs, false);
            continue;
          }
          const lr = d.list.getBoundingClientRect();
          const from: Rect = { x: lr.left, y: lr.top + d.top + d.y, width: lr.width, height: d.height };
          const lead = this.leadsOf(h.stageId).find((l) => l.id === id);
          if (lead) this.fly(lead, from, this.restRect(h), h, rolled ? 'rollback' : 'move');
          continue;
        }
        // Never seen here: a new lead at the top of its column drops in; reflows and pages fade in.
        if (!reflow && this.indexOf(h.stageId, id) === 0) {
          dropIn(h.li, this.ms(physics.newLeadDropMs), profile.springs, physics.fadeMs);
          pulseRing(h.ring, 'accent', this.ms(physics.newLeadPulseMs), profile.pulses);
        } else if (profile.springs) fadeIn(h.li, this.ms(physics.reflowFadeMs), true);
      }
      this.arrivals.clear();
    }

    if (this.departures.size > 400) {
      for (const [id, d] of this.departures) if (now - d.t > DEPARTURE_TTL) this.departures.delete(id);
    }
  }

  flightDone(key: string) {
    const { flights } = this.store.getState();
    const f = flights.find((x) => x.key === key);
    if (!f) return;
    const rest = flights.filter((x) => x.key !== key);
    this.store.setState({ flights: rest });
    const h = this.cards.get(f.lead.id);
    if (h) {
      h.li.style.opacity = '';
      pulseRing(h.ring, f.kind === 'rollback' ? 'danger' : 'stage', this.ms(this.cfg.physics.ringPulseMs), this.cfg.profile.pulses);
    }
    if (rest.length === 0) {
      this.releaseFlightQuality?.();
      this.releaseFlightQuality = null;
    }
  }

  // ------------------------------------------------------------------ geometry

  private leadsOf(stageId: string): readonly LeadListItem[] {
    return this.geometries.get(stageId)?.getLeads() ?? [];
  }

  private name(stageId: string): string {
    return this.cfg.stageNames.get(stageId) ?? 'this stage';
  }

  private indexOf(stageId: string, id: string): number {
    let map = this.indexCache.get(stageId);
    if (!map) {
      map = new Map();
      const leads = this.leadsOf(stageId);
      for (let i = 0; i < leads.length; i++) map.set(leads[i]!.id, i);
      this.indexCache.set(stageId, map);
    }
    return map.get(id) ?? -1;
  }

  /** Cards of a column in display order with rest geometry (list coordinates). */
  private slots(stageId: string): Slot[] {
    const cached = this.slotCache.get(stageId);
    if (cached) return cached;
    const geo = this.geometries.get(stageId);
    if (!geo) return [];
    const out: Slot[] = [];
    for (const lead of geo.getLeads()) {
      const s = geo.slot(lead.id);
      if (s) out.push({ id: lead.id, top: s.top, height: s.height });
    }
    this.slotCache.set(stageId, out);
    return out;
  }

  private refreshGeometry() {
    for (const [stageId, geo] of this.geometries) {
      geo.refresh();
      this.invalidate(stageId);
    }
  }

  private gapActive(over: DropTarget, active: ActiveDrag): boolean {
    return !(over.stageId === active.fromStageId && over.index === active.originIndex);
  }

  /** Number of drop positions - 1 in a column (cards without the dragged one). */
  private maxIndex(stageId: string, active: ActiveDrag): number {
    const n = this.leadsOf(stageId).length;
    return this.indexOf(stageId, active.lead.id) >= 0 ? n - 1 : n;
  }

  private total(stageId: string, active: ActiveDrag): number {
    const count = this.cfg.counts.get(stageId) ?? this.leadsOf(stageId).length;
    return stageId === active.fromStageId ? count : count + 1;
  }

  /** Top of a drop slot in list coordinates (rest layout). */
  private slotTop(stageId: string, index: number, active: ActiveDrag): number {
    const all = this.slots(stageId);
    if (stageId === active.fromStageId && index === active.originIndex) return all.find((s) => s.id === active.lead.id)?.top ?? 0;
    const others = all.filter((s) => s.id !== active.lead.id);
    const at = others[index];
    if (at) return at.top;
    const last = all.at(-1);
    return last ? last.top + last.height + this.cfg.gap : 0;
  }

  /** Vertical nudge a card needs for the current drop slot. */
  shiftFor(stageId: string, id: string): number {
    const { phase, active, over } = this.store.getState();
    if (phase !== 'dragging' || !active || !over || over.stageId !== stageId || !this.gapActive(over, active)) return 0;
    const H = active.height + this.cfg.gap;
    const idx = this.indexOf(stageId, id);
    if (idx < 0) return 0;
    if (stageId === active.fromStageId) {
      if (id === active.lead.id) return over.index < active.originIndex ? H : 0;
      const w = idx > active.originIndex ? idx - 1 : idx;
      return w >= over.index ? H : 0;
    }
    return idx >= over.index ? H : 0;
  }

  /** Move neighbours to their nudge targets. Opening a gap runs as a short wave from the slot. */
  private applyShifts() {
    const { profile, physics } = this.cfg;
    const s = this.store.getState();
    const over = s.over;
    const config = { config: this.spring(physics.gap) };
    for (const h of this.cards.values()) {
      const target = this.shiftFor(h.stageId, h.id);
      if (target === h.shift) continue;
      h.shift = target;
      window.clearTimeout(h.shiftTimer);
      h.shiftTimer = 0;
      if (!profile.springs) {
        this.snap(h, target);
        continue;
      }
      let delay = 0;
      if (profile.stagger && over && s.phase === 'dragging' && h.stageId === over.stageId) {
        delay = this.ms(Math.min(6, Math.abs(this.indexOf(h.stageId, h.id) - over.index)) * physics.gapStaggerMs);
      }
      if (delay < 1) h.y.start(target, config);
      else {
        h.shiftTimer = window.setTimeout(() => {
          h.shiftTimer = 0;
          if (h.shift === target) h.y.start(target, config);
        }, delay);
      }
    }
  }

  private setOver(over: DropTarget | null) {
    this.store.setState({ over });
    this.applyShifts();
  }

  private restRect(h: CardHandle): Rect {
    const r = h.card.getBoundingClientRect();
    return { x: r.left, y: r.top - h.y.get(), width: r.width, height: r.height };
  }

  /** Screen rect of a slot (for landings when the card element is not there). */
  private slotRect(stageId: string, top: number, active: ActiveDrag): Rect {
    const geo = this.geometries.get(stageId);
    const lr = geo?.list.getBoundingClientRect();
    return { x: lr?.left ?? this.pos.x, y: (lr?.top ?? 0) + top, width: active.width, height: active.height };
  }

  /** Insertion index for the dragged card's centre, against VISUAL midpoints (gap included). */
  private insertionIndex(stageId: string, centerY: number, s: DragState): number {
    const active = s.active as ActiveDrag;
    const geo = this.geometries.get(stageId);
    if (!geo) return 0;
    const y = centerY - geo.list.getBoundingClientRect().top;
    const others = this.slots(stageId).filter((sl) => sl.id !== active.lead.id);
    const cur = s.over && s.over.stageId === stageId && this.gapActive(s.over, active) ? s.over.index : -1;
    const H = active.height + this.cfg.gap;
    let i = 0;
    for (let j = 0; j < others.length; j++) {
      const sl = others[j]!;
      const mid = sl.top + sl.height / 2 + (cur >= 0 && j >= cur ? H : 0);
      if (y > mid) i = j + 1;
      else break;
    }
    return i;
  }

  private hitTest() {
    const s = this.store.getState();
    const active = s.active;
    const board = this.board;
    if (!active || s.phase !== 'dragging' || !board) return;
    const br = board.getBoundingClientRect();
    const { x: px, y: py } = this.ptr;
    let stageId: string | null = null;
    if (py >= br.top - 48 && py <= br.bottom + 48 && px >= br.left - 48 && px <= br.right + 48) {
      let best = Infinity;
      for (const id of this.cfg.stageOrder) {
        const col = this.columns.get(id);
        if (!col) continue;
        const r = col.frame.getBoundingClientRect();
        if (r.right < br.left || r.left > br.right) continue;
        const d = px < r.left ? r.left - px : px > r.right ? px - r.right : 0;
        if (d < best) {
          best = d;
          stageId = id;
        }
      }
      if (best > 24) stageId = null;
    }
    if (!stageId) {
      if (s.over) this.setOver(null);
      return;
    }
    const index = this.insertionIndex(stageId, this.pos.y + active.height / 2, s);
    if (s.over?.stageId === stageId && s.over.index === index) return;
    this.setOver({ stageId, index, top: this.slotTop(stageId, index, active) });
  }

  // ------------------------------------------------------------------ pointer

  pointerDown(e: ReactPointerEvent<HTMLElement>, lead: LeadListItem, stageId: string) {
    if (!this.cfg.canDrag) return;
    const phase = this.store.getState().phase;
    if (phase === 'dragging') return;
    if (phase === 'dropping') this.endDrop();
    const p = this.cfg.physics;
    this.press = { lead, stageId };
    this.pickup.begin(e, { mouseSlop: p.mouseSlop, touchSlop: p.touchSlop, longPressMs: p.longPressMs, hapticMs: p.hapticMs });
  }

  /** True once after a drag ended, so the trailing click does not open the lead. */
  consumeClick(): boolean {
    if (performance.now() < this.suppressClickUntil) {
      this.suppressClickUntil = 0;
      return true;
    }
    return false;
  }

  /** Select mode: the other selected cards that travel with `lead` (board order, loaded cards only). */
  private deckFor(lead: LeadListItem): LeadListItem[] {
    if (!this.cfg.selectMode) return [];
    const selected = this.cfg.selectedIds();
    if (!selected.has(lead.id) || selected.size < 2) return [];
    const out: LeadListItem[] = [];
    for (const stageId of this.cfg.stageOrder) for (const l of this.leadsOf(stageId)) if (l.id !== lead.id && selected.has(l.id)) out.push(l);
    return out;
  }

  private activatePointer(a: PickupActivation) {
    const press = this.press;
    this.press = null;
    if (!press) return;
    const { lead, stageId } = press;
    const card = a.target;
    this.refreshGeometry();
    const originIndex = this.indexOf(stageId, lead.id);
    if (originIndex < 0 || !card.isConnected) return;
    const r = card.getBoundingClientRect();
    const deck = this.deckFor(lead);
    const active: ActiveDrag = {
      lead,
      deck,
      deckIds: new Set(deck.map((l) => l.id)),
      fromStageId: stageId,
      originIndex,
      width: r.width,
      height: r.height,
      grabX: clamp(a.x0 - r.left, 0, r.width),
      grabY: clamp(a.y0 - r.top, 0, r.height),
      mode: 'pointer',
      viaLongPress: a.viaLongPress,
    };
    this.ptr = { x: a.x, y: a.y };
    this.pointerStart = { x: a.x, y: a.y };
    this.travel = 0;
    this.pos = { x: r.left, y: r.top };
    this.vel.reset(r.left, r.top);
    this.lastTick = performance.now();
    this.liftOverlay(r);
    this.store.setState({ phase: 'dragging', active, over: { stageId, index: originIndex, top: this.slotTop(stageId, originIndex, active) } });
    this.applyShifts();
    this.stopSession = trackPointerSession(a.pointerId, {
      onMove: (x, y) => {
        this.ptr = { x, y };
        this.travel = Math.max(this.travel, Math.hypot(x - this.pointerStart.x, y - this.pointerStart.y));
      },
      onEnd: (x, y) => {
        this.ptr = { x, y };
        this.tick(performance.now(), false);
        this.finishSession();
        const s = this.store.getState();
        if (s.active?.viaLongPress && this.travel <= this.cfg.physics.touchSlop) {
          // Touch press-and-release without moving: the actions sheet, not a move.
          const { lead: l, fromStageId } = s.active;
          this.returnHome('silent');
          this.cfg.openActions(l, fromStageId);
          return;
        }
        this.drop();
      },
      onCancel: () => {
        this.finishSession();
        this.returnHome('cancel');
      },
    });
    this.board?.setAttribute('data-dragging', 'true');
    this.acquireQuality();
    this.raf = requestAnimationFrame(this.tick);
    const more = deck.length ? ` and ${deck.length} more ${deck.length === 1 ? this.cfg.words.lead : this.cfg.words.leads}` : '';
    this.announce(`Picked up ${lead.name}${more} from ${this.name(stageId)}, position ${originIndex + 1} of ${this.total(stageId, active)}.`);
  }

  private acquireQuality() {
    this.releaseQuality?.();
    this.releaseQuality = this.cfg.quality?.acquire() ?? null;
  }

  private finishSession() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stopSession?.();
    this.stopSession = null;
    this.board?.removeAttribute('data-dragging');
    this.scroller.reset();
    this.suppressClickUntil = performance.now() + 400;
  }

  /** One frame: auto-scroll, follow the pointer with a light spring lag, tilt from velocity, hit test. */
  private tick = (now: number, schedule = true) => {
    if (schedule) this.raf = requestAnimationFrame(this.tick);
    const s = this.store.getState();
    const active = s.active;
    if (!active || s.phase !== 'dragging') return;
    const dt = clamp(now - this.lastTick, 1, 64);
    this.lastTick = now;
    const scrolled = schedule ? this.autoScroll(dt, now) : false;
    const x = this.ptr.x - active.grabX;
    const y = this.ptr.y - active.grabY;
    this.vel.sample(x, y, now);
    const moved = x !== this.pos.x || y !== this.pos.y;
    this.pos = { x, y };
    const o = this.overlay;
    if (o) {
      const { profile, physics } = this.cfg;
      if (moved) {
        if (profile.springs) {
          const follow = { config: this.spring(physics.follow) };
          o.x.start(x, follow);
          o.y.start(y, follow);
        } else {
          o.x.set(x);
          o.y.set(y);
        }
      }
      if (profile.tilt > 0) {
        const t = tiltFromVelocity(this.vel.vx, this.vel.vy, { max: physics.tiltMax, gain: physics.tiltGain, zGain: physics.tiltGain / 2, amount: profile.tilt });
        const tilt = { config: this.spring(physics.tilt) };
        if (Math.abs(o.rx.goal - t.rx) > 0.01) o.rx.start(t.rx, tilt);
        if (Math.abs(o.ry.goal - t.ry) > 0.01) o.ry.start(t.ry, tilt);
        if (Math.abs(o.rz.goal - t.rz) > 0.01) o.rz.start(t.rz, tilt);
      }
      if (profile.depth === 'full') {
        const cap = physics.shadowShift * 3;
        const sx = clamp(-this.vel.vx * physics.shadowShift, -cap, cap);
        const sy = clamp(-this.vel.vy * physics.shadowShift, -cap, cap);
        const tilt = { config: this.spring(physics.tilt) };
        if (Math.abs(o.sx.goal - sx) > 0.05) o.sx.start(sx, tilt);
        if (Math.abs(o.sy.goal - sy) > 0.05) o.sy.start(sy, tilt);
      }
    }
    if (moved || scrolled) this.hitTest();
  };

  private autoScroll(dt: number, now: number): boolean {
    const { autoScroll } = this.cfg.physics;
    const targets: ScrollTarget[] = [];
    if (this.board) targets.push({ key: 'board', el: this.board, axis: 'x', edge: autoScroll.boardEdge, slack: 48, mainSlack: 48 });
    const over = this.store.getState().over;
    const col = over ? this.columns.get(over.stageId) : undefined;
    if (col) targets.push({ key: `col:${col.stageId}`, el: col.scroll, axis: 'y', edge: autoScroll.columnEdge, slack: 0, mainSlack: 80 });
    return this.scroller.step(this.ptr, targets, dt, now, this.cfg.timeScale);
  }

  // ------------------------------------------------------------------ keyboard

  /** Card keydown. Returns true when the key was handled. */
  keyDown(e: ReactKeyboardEvent<HTMLElement>, lead: LeadListItem, stageId: string): boolean {
    const s = this.store.getState();
    if (s.phase === 'dragging' && s.active?.mode === 'keyboard') {
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          this.keyboardMove(e.key);
          return true;
        case 'Enter':
        case ' ':
          e.preventDefault();
          this.drop();
          return true;
        case 'Escape':
          e.preventDefault();
          this.returnHome('cancel');
          return true;
        case 'Tab':
          this.returnHome('cancel');
          return false;
        default:
          return true;
      }
    }
    if (s.phase === 'dragging') return true;
    if (e.key === ' ' && this.cfg.canDrag) {
      e.preventDefault();
      this.startKeyboard(lead, stageId, e.currentTarget);
      return true;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      this.focusNeighbour(lead.id, stageId, e.key);
      return true;
    }
    return false;
  }

  /** Card blur: leaving a card mid keyboard move cancels it. */
  blur(id: string) {
    const s = this.store.getState();
    if (s.phase === 'dragging' && s.active?.mode === 'keyboard' && s.active.lead.id === id) this.returnHome('cancel');
  }

  private startKeyboard(lead: LeadListItem, stageId: string, card: HTMLElement) {
    if (this.store.getState().phase === 'dropping') this.endDrop();
    this.refreshGeometry();
    const originIndex = this.indexOf(stageId, lead.id);
    if (originIndex < 0) return;
    const r = card.getBoundingClientRect();
    const active: ActiveDrag = {
      lead,
      deck: [],
      deckIds: new Set(),
      fromStageId: stageId,
      originIndex,
      width: r.width,
      height: r.height,
      grabX: r.width / 2,
      grabY: r.height / 2,
      mode: 'keyboard',
      viaLongPress: false,
    };
    this.pos = { x: r.left, y: r.top };
    this.vel.reset(r.left, r.top);
    this.liftOverlay(r);
    this.store.setState({ phase: 'dragging', active, over: { stageId, index: originIndex, top: this.slotTop(stageId, originIndex, active) } });
    this.applyShifts();
    this.acquireQuality();
    this.announce(
      `Picked up ${lead.name}. ${this.name(stageId)}, position ${originIndex + 1} of ${this.total(stageId, active)}. Use the arrow keys to move, Space to drop, Escape to cancel.`,
    );
  }

  private keyboardMove(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') {
    const s = this.store.getState();
    const active = s.active;
    if (!active) return;
    const cur = s.over ?? { stageId: active.fromStageId, index: active.originIndex, top: 0 };
    let { stageId, index } = cur;
    if (key === 'ArrowUp') index = Math.max(0, index - 1);
    else if (key === 'ArrowDown') index = Math.min(this.maxIndex(stageId, active), index + 1);
    else {
      const order = this.cfg.stageOrder;
      const next = order[order.indexOf(stageId) + (key === 'ArrowRight' ? 1 : -1)];
      if (!next) {
        this.announce(`${this.name(stageId)} is the ${key === 'ArrowRight' ? 'last' : 'first'} stage.`);
        return;
      }
      stageId = next;
      index = Math.min(index, this.maxIndex(stageId, active));
    }
    if (stageId === cur.stageId && index === cur.index) return;
    const top = this.slotTop(stageId, index, active);
    this.setOver({ stageId, index, top });
    this.revealSlot(stageId, top, active.height);
    const to = this.slotRect(stageId, top, active);
    this.pos = { x: to.x, y: to.y };
    this.moveOverlay(to.x, to.y);
    this.announce(`${this.name(stageId)}, position ${index + 1} of ${this.total(stageId, active)}.`);
  }

  /** Scroll the column (and the board) so a slot is visible. Instant, so the math stays exact. */
  private revealSlot(stageId: string, top: number, height: number) {
    const col = this.columns.get(stageId);
    const geo = this.geometries.get(stageId);
    if (!col || !geo) return;
    const sr = col.scroll.getBoundingClientRect();
    const inView = geo.list.getBoundingClientRect().top + top - sr.top;
    if (inView < 8) col.scroll.scrollTop += inView - 8;
    else if (inView + height > sr.height - 8) col.scroll.scrollTop += inView + height - sr.height + 8;
    const board = this.board;
    if (board) {
      const br = board.getBoundingClientRect();
      const fr = col.frame.getBoundingClientRect();
      if (fr.left < br.left) board.scrollLeft -= br.left - fr.left + 8;
      else if (fr.right > br.right) board.scrollLeft += fr.right - br.right + 8;
    }
  }

  private focusNeighbour(id: string, stageId: string, key: string) {
    const order = this.cfg.stageOrder;
    const leads = this.leadsOf(stageId);
    const i = leads.findIndex((l) => l.id === id);
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const j = i + (key === 'ArrowDown' ? 1 : -1);
      if (j >= 0 && j < leads.length) this.focusLead(stageId, j);
      return;
    }
    const dir = key === 'ArrowRight' ? 1 : -1;
    for (let c = order.indexOf(stageId) + dir; c >= 0 && c < order.length; c += dir) {
      const next = order[c]!;
      const n = this.leadsOf(next).length;
      if (n > 0) {
        this.focusLead(next, Math.min(Math.max(i, 0), n - 1));
        return;
      }
    }
  }

  private focusLead(stageId: string, index: number) {
    const id = this.leadsOf(stageId)[index]?.id;
    if (!id) return;
    const h = this.cards.get(id);
    if (h) {
      h.card.focus();
      return;
    }
    this.geometries.get(stageId)?.reveal(index);
    requestAnimationFrame(() => requestAnimationFrame(() => this.cards.get(id)?.card.focus()));
  }

  // ------------------------------------------------------------------ drop

  private drop() {
    const s = this.store.getState();
    const active = s.active;
    if (!active || s.phase !== 'dragging') return;
    const over = s.over;
    if (!over || !this.gapActive(over, active)) {
      this.returnHome(over ? 'same' : 'cancel');
      return;
    }
    // Neighbours of the slot, skipping cards that travel in the deck.
    const others = this.leadsOf(over.stageId).filter((l) => l.id !== active.lead.id);
    let b = over.index - 1;
    while (b >= 0 && active.deckIds.has(others[b]!.id)) b--;
    let a = over.index;
    while (a < others.length && active.deckIds.has(others[a]!.id)) a++;
    const beforeLeadId = b >= 0 ? others[b]!.id : null;
    const afterLeadId = others[a]?.id ?? null;
    const moves: CommitMove[] = [];
    let prev = beforeLeadId;
    for (const lead of [active.lead, ...active.deck]) {
      moves.push({ lead, fromStageId: lead.id === active.lead.id ? active.fromStageId : lead.stageId, toStageId: over.stageId, beforeLeadId: prev, afterLeadId });
      prev = lead.id;
    }
    const { vx, vy } = capVelocity(this.vel.vx, this.vel.vy, this.cfg.physics.maxThrowSpeed);
    this.landing = { id: active.lead.id, vx, vy, fallback: this.slotRect(over.stageId, over.top, active) };
    this.landedMove = active.lead.id;
    if (active.mode === 'keyboard') this.focusAfter = { id: active.lead.id, scroll: false, t: performance.now() };
    this.store.setState({ phase: 'dropping', over: null });
    this.applyShifts();
    this.cfg.commit(moves);
    const where = `${this.name(over.stageId)}, position ${over.index + 1} of ${this.total(over.stageId, active)}`;
    if (active.deck.length) this.announce(`Moved ${moves.length} ${this.cfg.words.leads} to ${where}.`);
    else this.announce(`Moved ${active.lead.name} to ${where}.`);
    // Safety net: if no board commit follows (nothing re-rendered), land on the slot anyway.
    requestAnimationFrame(() => {
      if (this.landing) this.startLanding();
    });
  }

  /** Back to the origin: 'cancel' bounces (dropped outside / Escape), 'same' settles, 'silent' says nothing. */
  private returnHome(reason: 'cancel' | 'same' | 'silent') {
    const s = this.store.getState();
    const active = s.active;
    if (!active || s.phase !== 'dragging') return;
    if (active.mode === 'keyboard' && reason === 'cancel') {
      this.revealSlot(active.fromStageId, this.slotTop(active.fromStageId, active.originIndex, active), active.height);
    }
    this.store.setState({ phase: 'dropping', over: null });
    this.applyShifts();
    const h = this.cards.get(active.lead.id);
    const to = h ? this.restRect(h) : { x: this.pos.x, y: this.pos.y, width: active.width, height: active.height };
    const { vx, vy } = capVelocity(this.vel.vx, this.vel.vy, this.cfg.physics.maxThrowSpeed);
    this.land(to, vx, vy, reason === 'cancel' ? this.cfg.physics.springBack : this.cfg.physics.land, () => this.endDrop());
    if (reason === 'silent') return;
    const where = `${this.name(active.fromStageId)}, position ${active.originIndex + 1}`;
    this.announce(reason === 'cancel' ? `Move cancelled. ${active.lead.name} is back in ${where}.` : `${active.lead.name} stays in ${where}.`);
  }

  private startLanding() {
    const L = this.landing;
    this.landing = null;
    if (!L || !this.store.getState().active) return;
    const h = this.cards.get(L.id);
    this.land(h ? this.restRect(h) : L.fallback, L.vx, L.vy, this.cfg.physics.land, () => this.endDrop());
  }

  private liftOverlay(r: DOMRect) {
    const o = this.overlay;
    if (!o) return;
    const { profile, physics } = this.cfg;
    this.landToken++;
    o.x.set(r.left);
    o.y.set(r.top);
    for (const v of [o.rx, o.ry, o.rz, o.sx, o.sy]) v.set(0);
    o.scale.set(1);
    o.lift.set(0);
    const scale = profile.depth === 'none' ? 1 + (physics.liftScale - 1) / 2 : physics.liftScale;
    if (!profile.springs) {
      o.scale.set(scale);
      o.lift.set(1);
      return;
    }
    const lift = { config: this.spring(physics.spring) };
    o.scale.start(scale, lift);
    o.lift.start(1, lift);
  }

  private moveOverlay(x: number, y: number) {
    const o = this.overlay;
    if (!o) return;
    if (!this.cfg.profile.springs) {
      o.x.set(x);
      o.y.set(y);
      return;
    }
    const follow = { config: this.spring(this.cfg.physics.follow) };
    o.x.start(x, follow);
    o.y.start(y, follow);
  }

  /** Release: keep the pointer's momentum, then snap into place (overshoot unless the tier forbids it). */
  private land(to: Rect, vx: number, vy: number, params: SpringParams, done: () => void) {
    const o = this.overlay;
    const token = ++this.landToken;
    const finish = () => {
      if (token !== this.landToken) return;
      this.landToken++;
      window.clearTimeout(this.landTimer);
      done();
    };
    if (!o) return finish();
    const { profile, physics } = this.cfg;
    if (!profile.springs) {
      o.x.set(to.x);
      o.y.set(to.y);
      for (const v of [o.rx, o.ry, o.rz, o.sx, o.sy]) v.set(0);
      o.scale.set(1);
      o.lift.set(0);
      return finish();
    }
    const p = profile.overshoot ? params : noOvershoot(params);
    const level = { config: this.spring(physics.tilt) };
    for (const v of [o.rx, o.ry, o.rz, o.sx, o.sy]) v.start(0, level);
    const settle = { config: this.spring(physics.spring) };
    o.scale.start(1, settle);
    o.lift.start(0, settle);
    void Promise.all([o.x.start(to.x, { config: this.spring(p, vx) }), o.y.start(to.y, { config: this.spring(p, vy) })]).then(finish);
    window.clearTimeout(this.landTimer);
    this.landTimer = window.setTimeout(finish, this.ms(1100));
  }

  private endDrop() {
    this.landToken++;
    this.landing = null;
    window.clearTimeout(this.landTimer);
    const s = this.store.getState();
    const active = s.active;
    const landed = this.landedMove;
    this.landedMove = null;
    this.releaseQuality?.();
    this.releaseQuality = null;
    if (!active) return;
    const o = this.overlay;
    const ghost: Rect | null = o ? { x: o.x.get(), y: o.y.get(), width: active.width, height: active.height } : null;
    this.store.setState({ phase: 'idle', active: null, over: null });
    this.applyShifts();
    const h = this.cards.get(active.lead.id);
    if (!h) return;
    const { profile, physics } = this.cfg;
    const rolled = this.takeRollback(active.lead.id, performance.now());
    // Rolled back (or interrupted) while landing: spring the card from where the ghost let go.
    if (ghost && profile.springs) {
      const r = this.restRect(h);
      if (Math.abs(r.x - ghost.x) + Math.abs(r.y - ghost.y) > 6) {
        const lead = this.leadsOf(h.stageId).find((l) => l.id === active.lead.id) ?? active.lead;
        this.fly(lead, ghost, r, h, rolled ? 'rollback' : 'move');
        return;
      }
    }
    if (rolled) pulseRing(h.ring, 'danger', this.ms(physics.ringPulseMs), profile.pulses);
    else if (landed === active.lead.id) {
      pulseRing(h.ring, 'stage', this.ms(physics.ringPulseMs), profile.pulses);
      if (!profile.springs) fadeIn(h.li, physics.fadeMs);
    }
  }

  private fly(lead: LeadListItem, from: Rect, to: Rect, h: CardHandle, kind: 'move' | 'rollback') {
    if (!intersectsViewport(from) && !intersectsViewport(to)) {
      if (kind === 'rollback') pulseRing(h.ring, 'danger', this.ms(this.cfg.physics.ringPulseMs), this.cfg.profile.pulses);
      return;
    }
    // Opacity, not visibility: the card may hold focus while its ghost flies in.
    h.li.style.opacity = '0';
    const key = `${lead.id}:${++this.flightSeq}`;
    this.store.setState((s) => ({ flights: [...s.flights.filter((f) => f.lead.id !== lead.id), { key, lead, from, to, kind }] }));
    if (!this.releaseFlightQuality) this.releaseFlightQuality = this.cfg.quality?.acquire() ?? null;
  }

  // ------------------------------------------------------------------ menu move

  /** "Move to stage..." menu and actions sheet: puts the card at the top of the target column. */
  moveToStage(lead: LeadListItem, fromStageId: string, toStageId: string) {
    if (fromStageId === toStageId) return;
    const first = this.leadsOf(toStageId).find((l) => l.id !== lead.id);
    this.focusAfter = { id: lead.id, scroll: true, t: performance.now() };
    this.cfg.commit([{ lead, fromStageId, toStageId, beforeLeadId: null, afterLeadId: first?.id ?? null }]);
    const count = (this.cfg.counts.get(toStageId) ?? 0) + 1;
    this.announce(`Moved ${lead.name} to ${this.name(toStageId)}, position 1 of ${count}.`);
  }

  // ------------------------------------------------------------------ misc

  announce(message: string) {
    const el = this.live;
    if (!el) return;
    // Alternate a trailing no-break space so repeating the same message is announced again.
    this.liveFlip = !this.liveFlip;
    el.textContent = this.liveFlip ? message : `${message}\u00a0`;
  }

  dispose() {
    this.pickup.cancel();
    this.press = null;
    if (this.store.getState().phase === 'dragging') this.finishSession();
    this.landToken++;
    window.clearTimeout(this.landTimer);
    this.releaseQuality?.();
    this.releaseQuality = null;
    this.releaseFlightQuality?.();
    this.releaseFlightQuality = null;
    for (const h of this.cards.values()) window.clearTimeout(h.shiftTimer);
    this.store.setState({ phase: 'idle', active: null, over: null, flights: [] });
  }
}
