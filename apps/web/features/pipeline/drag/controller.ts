import type { LeadListItem } from '@vistar/shared';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ActiveDrag, CardHandle, ColumnGeometry, ColumnHandle, CommitMove, DragState, DropTarget, OverlayHandle, Rect } from './types';

/**
 * Board drag engine (one instance per board). Imperative on purpose: pointer frames never go
 * through React. The store only changes when the drop slot changes, so a drag re-renders a handful
 * of components (the two placeholders and two column frames), never the cards.
 *
 * Layout model while dragging: the origin card stays in place as a dashed placeholder; the hovered
 * column opens a gap (cards after the slot translate down by the card height). Everything is
 * transforms, so geometry is measured once at pick-up and hit testing reads cached rest positions.
 * After a drop the board renders the move at once (see BoardView) and each column runs a FLIP pass
 * from the old visual positions, so the gap at the origin closes with a spring.
 */

export const LIFT_SCALE = 1.03;
const MAX_TILT_DEG = 8;
/** deg per (px/ms) of smoothed horizontal pointer velocity. */
const TILT_GAIN = 9;
/** Low-pass time constant for pointer velocity (ms). */
const VELOCITY_TAU = 70;
const LONG_PRESS_MS = 200;
const MOUSE_SLOP = 4;
const TOUCH_SLOP = 8;
const BOARD_EDGE = 72;
const COLUMN_EDGE = 56;
const MAX_SCROLL_PER_FRAME = 18;
const DEPARTURE_TTL = 1500;

export const SPRINGS = {
  lift: { tension: 420, friction: 26 },
  tilt: { tension: 320, friction: 22 },
  /** Damping ratio ~0.66: lands with a slight overshoot. */
  land: { tension: 520, friction: 30, precision: 0.3 },
  settle: { tension: 420, friction: 30 },
  /** Keyboard moves follow the slot. */
  slot: { tension: 560, friction: 36, precision: 0.3 },
  /** Neighbours making room / closing gaps. */
  nudge: { tension: 520, friction: 40, precision: 0.3 },
  /** Card springing to a new place (rollback, realtime, menu move). */
  flight: { tension: 300, friction: 24, precision: 0.3 },
} as const;

export interface BoardConfig {
  canDrag: boolean;
  reducedMotion: boolean;
  /** Gap between cards in a column (px). */
  gap: number;
  stageOrder: readonly string[];
  stageNames: ReadonlyMap<string, string>;
  /** Total leads per stage (BoardColumn.count), for "position 2 of 7". */
  counts: ReadonlyMap<string, number>;
  commit: (move: CommitMove) => void;
}

interface Pending {
  pointerId: number;
  type: string;
  x0: number;
  y0: number;
  lead: LeadListItem;
  stageId: string;
  card: HTMLElement;
  timer: number;
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

/** Auto-scroll speed (px/frame) for a pointer `dist` px inside an edge band. */
function edgeSpeed(dist: number, band: number): number {
  if (dist >= band) return 0;
  const t = clamp((band - dist) / band, 0, 1);
  return MAX_SCROLL_PER_FRAME * t * t;
}

function step(v: number): number {
  if (v === 0) return 0;
  return Math.sign(v) * Math.max(1, Math.round(Math.abs(v)));
}

function intersectsViewport(r: Rect): boolean {
  return r.x + r.width > 0 && r.y + r.height > 0 && r.x < window.innerWidth && r.y < window.innerHeight;
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
    reducedMotion: false,
    gap: 8,
    stageOrder: [],
    stageNames: new Map(),
    counts: new Map(),
    commit: () => undefined,
  };
  private columns = new Map<string, ColumnHandle>();
  private geometries = new Map<string, ColumnGeometry>();
  private slotCache = new Map<string, Slot[]>();
  private indexCache = new Map<string, Map<string, number>>();

  private pending: Pending | null = null;
  private pointerId = -1;
  private ptr = { x: 0, y: 0 };
  private pos = { x: 0, y: 0 };
  private vel = { x: 0, y: 0 };
  private lastTick = 0;
  private raf = 0;
  private suppressClickUntil = 0;
  private bodyStyle: { cursor: string; userSelect: string } | null = null;

  private landing: Landing | null = null;
  private landToken = 0;
  private landTimer = 0;
  private focusAfter: { id: string; scroll: boolean; t: number } | null = null;
  private departures = new Map<string, Departure>();
  private arrivals = new Set<string>();
  private flightSeq = 0;
  private liveFlip = false;

  configure(patch: Partial<BoardConfig>) {
    Object.assign(this.cfg, patch);
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
    h.y.set(h.shift);
  }

  unregisterCard(h: CardHandle) {
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
    if (this.cfg.reducedMotion || s.active?.lead.id === h.id) {
      h.y.set(target);
      return;
    }
    const delta = prevTop + h.y.get() - top;
    if (Math.abs(delta - target) < 0.5) {
      h.y.set(target);
      return;
    }
    h.y.set(delta);
    h.y.start(target, { config: SPRINGS.nudge });
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
      for (const id of this.arrivals) {
        if (s.active?.lead.id === id && s.phase !== 'idle') continue;
        const d = this.departures.get(id);
        const h = this.cards.get(id);
        if (!d || !h || now - d.t > DEPARTURE_TTL || !d.list.isConnected || this.cfg.reducedMotion) continue;
        const lr = d.list.getBoundingClientRect();
        const from: Rect = { x: lr.left, y: lr.top + d.top + d.y, width: lr.width, height: d.height };
        const lead = this.leadsOf(h.stageId).find((l) => l.id === id);
        if (lead) this.fly(lead, from, this.restRect(h), h);
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
    this.store.setState({ flights: flights.filter((x) => x.key !== key) });
    const h = this.cards.get(f.lead.id);
    if (h) h.li.style.opacity = '';
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

  private applyShifts() {
    const reduced = this.cfg.reducedMotion;
    for (const h of this.cards.values()) {
      const target = this.shiftFor(h.stageId, h.id);
      if (target === h.shift) continue;
      h.shift = target;
      if (reduced) h.y.set(target);
      else h.y.start(target, { config: SPRINGS.nudge });
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
    if (!this.cfg.canDrag || e.button !== 0 || !e.isPrimary) return;
    const phase = this.store.getState().phase;
    if (phase === 'dragging') return;
    if (phase === 'dropping') this.endDrop();
    this.clearPending();
    this.pending = { pointerId: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, lead, stageId, card: e.currentTarget, timer: 0 };
    this.ptr = { x: e.clientX, y: e.clientY };
    window.addEventListener('pointermove', this.onPendingMove, { passive: true });
    window.addEventListener('pointerup', this.onPendingEnd);
    window.addEventListener('pointercancel', this.onPendingEnd);
    if (e.pointerType === 'touch') {
      // Long-press picks up; a quick swipe still scrolls (we only block touchmove once dragging).
      window.addEventListener('touchmove', this.onTouchMove, { passive: false });
      this.pending.timer = window.setTimeout(this.activatePointer, LONG_PRESS_MS);
    }
  }

  /** True once after a drag ended, so the trailing click does not open the lead. */
  consumeClick(): boolean {
    if (performance.now() < this.suppressClickUntil) {
      this.suppressClickUntil = 0;
      return true;
    }
    return false;
  }

  private onPendingMove = (e: PointerEvent) => {
    const p = this.pending;
    if (!p || e.pointerId !== p.pointerId) return;
    this.ptr = { x: e.clientX, y: e.clientY };
    const d = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
    if (p.type === 'touch') {
      if (d > TOUCH_SLOP) this.clearPending();
      return;
    }
    if (d > MOUSE_SLOP) this.activatePointer();
  };

  private onPendingEnd = (e: PointerEvent) => {
    if (this.pending && e.pointerId === this.pending.pointerId) this.clearPending();
  };

  private onTouchMove = (e: TouchEvent) => {
    const s = this.store.getState();
    if (s.phase === 'dragging' && s.active?.mode === 'pointer' && e.cancelable) e.preventDefault();
  };

  private preventContextMenu = (e: Event) => e.preventDefault();

  private clearPending() {
    const p = this.pending;
    if (!p) return;
    window.clearTimeout(p.timer);
    window.removeEventListener('pointermove', this.onPendingMove);
    window.removeEventListener('pointerup', this.onPendingEnd);
    window.removeEventListener('pointercancel', this.onPendingEnd);
    this.pending = null;
    if (this.store.getState().phase !== 'dragging') window.removeEventListener('touchmove', this.onTouchMove);
  }

  private activatePointer = () => {
    const p = this.pending;
    if (!p) return;
    const { lead, stageId, card, pointerId } = p;
    this.pending = null;
    window.clearTimeout(p.timer);
    window.removeEventListener('pointermove', this.onPendingMove);
    window.removeEventListener('pointerup', this.onPendingEnd);
    window.removeEventListener('pointercancel', this.onPendingEnd);
    this.refreshGeometry();
    const originIndex = this.indexOf(stageId, lead.id);
    if (originIndex < 0 || !card.isConnected) {
      window.removeEventListener('touchmove', this.onTouchMove);
      return;
    }
    const r = card.getBoundingClientRect();
    const active: ActiveDrag = {
      lead,
      fromStageId: stageId,
      originIndex,
      width: r.width,
      height: r.height,
      grabX: clamp(this.ptr.x - r.left, 0, r.width),
      grabY: clamp(this.ptr.y - r.top, 0, r.height),
      mode: 'pointer',
    };
    this.pointerId = pointerId;
    this.pos = { x: r.left, y: r.top };
    this.ptr = { x: r.left + active.grabX, y: r.top + active.grabY };
    this.vel = { x: 0, y: 0 };
    this.lastTick = performance.now();
    this.liftOverlay(r);
    this.store.setState({ phase: 'dragging', active, over: { stageId, index: originIndex, top: this.slotTop(stageId, originIndex, active) } });
    this.applyShifts();

    window.addEventListener('pointermove', this.onDragMove, { passive: true });
    window.addEventListener('pointerup', this.onDragEnd);
    window.addEventListener('pointercancel', this.onDragCancel);
    window.addEventListener('keydown', this.onDragKey, true);
    window.addEventListener('contextmenu', this.preventContextMenu);
    window.addEventListener('blur', this.onWindowBlur);
    const body = document.body.style;
    this.bodyStyle = { cursor: body.cursor, userSelect: body.userSelect };
    body.cursor = 'grabbing';
    body.userSelect = 'none';
    this.board?.setAttribute('data-dragging', 'true');
    this.raf = requestAnimationFrame(this.tick);
    this.announce(`Picked up ${lead.name} from ${this.name(stageId)}, position ${originIndex + 1} of ${this.total(stageId, active)}.`);
  };

  private onDragMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.ptr = { x: e.clientX, y: e.clientY };
  };

  private onDragEnd = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.ptr = { x: e.clientX, y: e.clientY };
    this.tick(performance.now(), false);
    this.stopTracking();
    this.drop();
  };

  private onDragCancel = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.stopTracking();
    this.returnHome('cancel');
  };

  private onDragKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    this.stopTracking();
    this.returnHome('cancel');
  };

  private onWindowBlur = () => {
    this.stopTracking();
    this.returnHome('cancel');
  };

  private stopTracking() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
    window.removeEventListener('pointercancel', this.onDragCancel);
    window.removeEventListener('keydown', this.onDragKey, true);
    window.removeEventListener('contextmenu', this.preventContextMenu);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('touchmove', this.onTouchMove);
    if (this.bodyStyle) {
      document.body.style.cursor = this.bodyStyle.cursor;
      document.body.style.userSelect = this.bodyStyle.userSelect;
      this.bodyStyle = null;
    }
    this.board?.removeAttribute('data-dragging');
    this.pointerId = -1;
    this.suppressClickUntil = performance.now() + 400;
  }

  /** One frame: auto-scroll, follow the pointer, filter velocity into tilt, hit test. */
  private tick = (now: number, schedule = true) => {
    if (schedule) this.raf = requestAnimationFrame(this.tick);
    const s = this.store.getState();
    const active = s.active;
    if (!active || s.phase !== 'dragging') return;
    const dt = clamp(now - this.lastTick, 1, 64);
    this.lastTick = now;
    const scrolled = schedule ? this.autoScroll(dt) : false;
    const x = this.ptr.x - active.grabX;
    const y = this.ptr.y - active.grabY;
    const a = 1 - Math.exp(-dt / VELOCITY_TAU);
    this.vel.x += ((x - this.pos.x) / dt - this.vel.x) * a;
    this.vel.y += ((y - this.pos.y) / dt - this.vel.y) * a;
    const moved = x !== this.pos.x || y !== this.pos.y;
    this.pos = { x, y };
    const o = this.overlay;
    if (o) {
      if (moved) {
        o.x.set(x);
        o.y.set(y);
      }
      if (!this.cfg.reducedMotion) o.rot.start(clamp(this.vel.x * TILT_GAIN, -MAX_TILT_DEG, MAX_TILT_DEG), { config: SPRINGS.tilt });
    }
    if (moved || scrolled) this.hitTest();
  };

  private autoScroll(dt: number): boolean {
    const board = this.board;
    if (!board) return false;
    const f = dt / 16.7;
    const { x, y } = this.ptr;
    let scrolled = false;
    const br = board.getBoundingClientRect();
    if (y >= br.top - 48 && y <= br.bottom + 48) {
      const dx = step((edgeSpeed(br.right - x, BOARD_EDGE) - edgeSpeed(x - br.left, BOARD_EDGE)) * f);
      if (dx) {
        const before = board.scrollLeft;
        board.scrollLeft += dx;
        scrolled = board.scrollLeft !== before;
      }
    }
    const over = this.store.getState().over;
    const col = over ? this.columns.get(over.stageId) : undefined;
    if (col) {
      const r = col.scroll.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 80 && y <= r.bottom + 80) {
        const dy = step((edgeSpeed(r.bottom - y, COLUMN_EDGE) - edgeSpeed(y - r.top, COLUMN_EDGE)) * f);
        if (dy) {
          const before = col.scroll.scrollTop;
          col.scroll.scrollTop += dy;
          scrolled = scrolled || col.scroll.scrollTop !== before;
        }
      }
    }
    return scrolled;
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
    const active: ActiveDrag = { lead, fromStageId: stageId, originIndex, width: r.width, height: r.height, grabX: r.width / 2, grabY: r.height / 2, mode: 'keyboard' };
    this.pos = { x: r.left, y: r.top };
    this.vel = { x: 0, y: 0 };
    this.liftOverlay(r);
    this.store.setState({ phase: 'dragging', active, over: { stageId, index: originIndex, top: this.slotTop(stageId, originIndex, active) } });
    this.applyShifts();
    this.announce(
      `Picked up ${lead.name}. ${this.name(stageId)}, position ${originIndex + 1} of ${this.total(stageId, active)}. Use the arrow keys to move, Enter to drop, Escape to cancel.`,
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
    const others = this.leadsOf(over.stageId).filter((l) => l.id !== active.lead.id);
    const beforeLeadId = others[over.index - 1]?.id ?? null;
    const afterLeadId = others[over.index]?.id ?? null;
    this.landing = { id: active.lead.id, vx: this.vel.x, vy: this.vel.y, fallback: this.slotRect(over.stageId, over.top, active) };
    if (active.mode === 'keyboard') this.focusAfter = { id: active.lead.id, scroll: false, t: performance.now() };
    this.store.setState({ phase: 'dropping', over: null });
    this.applyShifts();
    this.cfg.commit({ lead: active.lead, fromStageId: active.fromStageId, toStageId: over.stageId, beforeLeadId, afterLeadId });
    this.announce(`${active.lead.name} moved to ${this.name(over.stageId)}, position ${over.index + 1} of ${this.total(over.stageId, active)}.`);
    // Safety net: if no board commit follows (nothing re-rendered), land on the slot anyway.
    requestAnimationFrame(() => {
      if (this.landing) this.startLanding();
    });
  }

  private returnHome(reason: 'cancel' | 'same') {
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
    this.land(to, this.vel.x, this.vel.y, () => this.endDrop());
    const where = `${this.name(active.fromStageId)}, position ${active.originIndex + 1}`;
    this.announce(reason === 'cancel' ? `Move cancelled. ${active.lead.name} is back in ${where}.` : `${active.lead.name} stays in ${where}.`);
  }

  private startLanding() {
    const L = this.landing;
    this.landing = null;
    if (!L || !this.store.getState().active) return;
    const h = this.cards.get(L.id);
    this.land(h ? this.restRect(h) : L.fallback, L.vx, L.vy, () => this.endDrop());
  }

  private liftOverlay(r: DOMRect) {
    const o = this.overlay;
    if (!o) return;
    this.landToken++;
    o.x.set(r.left);
    o.y.set(r.top);
    o.rot.set(0);
    o.scale.set(1);
    if (this.cfg.reducedMotion) o.scale.set(LIFT_SCALE);
    else o.scale.start(LIFT_SCALE, { config: SPRINGS.lift });
  }

  private moveOverlay(x: number, y: number) {
    const o = this.overlay;
    if (!o) return;
    if (this.cfg.reducedMotion) {
      o.x.set(x);
      o.y.set(y);
      return;
    }
    o.x.start(x, { config: SPRINGS.slot });
    o.y.start(y, { config: SPRINGS.slot });
  }

  /** Release: keep the pointer's momentum, then snap into the slot with a slight overshoot. */
  private land(to: Rect, vx: number, vy: number, done: () => void) {
    const o = this.overlay;
    const token = ++this.landToken;
    const finish = () => {
      if (token !== this.landToken) return;
      this.landToken++;
      window.clearTimeout(this.landTimer);
      done();
    };
    if (!o) return finish();
    if (this.cfg.reducedMotion) {
      o.x.set(to.x);
      o.y.set(to.y);
      o.rot.set(0);
      o.scale.set(1);
      return finish();
    }
    o.rot.start(0, { config: SPRINGS.tilt });
    o.scale.start(1, { config: SPRINGS.settle });
    void Promise.all([
      o.x.start(to.x, { config: { ...SPRINGS.land, velocity: vx } }),
      o.y.start(to.y, { config: { ...SPRINGS.land, velocity: vy } }),
    ]).then(finish);
    window.clearTimeout(this.landTimer);
    this.landTimer = window.setTimeout(finish, 900);
  }

  private endDrop() {
    this.landToken++;
    this.landing = null;
    window.clearTimeout(this.landTimer);
    const s = this.store.getState();
    const active = s.active;
    if (!active) return;
    const o = this.overlay;
    const ghost: Rect | null = o ? { x: o.x.get(), y: o.y.get(), width: active.width, height: active.height } : null;
    this.store.setState({ phase: 'idle', active: null, over: null });
    this.applyShifts();
    // Rolled back (or interrupted) while landing: spring the card from where the ghost let go.
    const h = this.cards.get(active.lead.id);
    if (ghost && h && !this.cfg.reducedMotion) {
      const r = this.restRect(h);
      if (Math.abs(r.x - ghost.x) + Math.abs(r.y - ghost.y) > 6) {
        const lead = this.leadsOf(h.stageId).find((l) => l.id === active.lead.id) ?? active.lead;
        this.fly(lead, ghost, r, h);
      }
    }
  }

  private fly(lead: LeadListItem, from: Rect, to: Rect, h: CardHandle) {
    if (!intersectsViewport(from) && !intersectsViewport(to)) return;
    // Opacity, not visibility: the card may hold focus while its ghost flies in.
    h.li.style.opacity = '0';
    const key = `${lead.id}:${++this.flightSeq}`;
    this.store.setState((s) => ({ flights: [...s.flights.filter((f) => f.lead.id !== lead.id), { key, lead, from, to }] }));
  }

  // ------------------------------------------------------------------ menu move

  /** "Move to stage..." menu: puts the card at the top of the target column. */
  moveToStage(lead: LeadListItem, fromStageId: string, toStageId: string) {
    if (fromStageId === toStageId) return;
    const first = this.leadsOf(toStageId).find((l) => l.id !== lead.id);
    this.focusAfter = { id: lead.id, scroll: true, t: performance.now() };
    this.cfg.commit({ lead, fromStageId, toStageId, beforeLeadId: null, afterLeadId: first?.id ?? null });
    const count = (this.cfg.counts.get(toStageId) ?? 0) + 1;
    this.announce(`${lead.name} moved to ${this.name(toStageId)}, position 1 of ${count}.`);
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
    this.clearPending();
    if (this.store.getState().phase === 'dragging') this.stopTracking();
    this.landToken++;
    window.clearTimeout(this.landTimer);
    this.store.setState({ phase: 'idle', active: null, over: null, flights: [] });
  }
}
