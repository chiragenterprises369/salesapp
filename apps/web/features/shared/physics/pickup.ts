/**
 * Pointer and touch pick-up, and the pointer session that follows it.
 *
 * Rules (shared by every draggable surface):
 * - Mouse / pen: a press becomes a drag after `mouseSlop` px of movement (4 px). A release before
 *   that is a click.
 * - Touch: a press becomes a drag after a `longPressMs` long-press (180 ms) with a haptic tick.
 *   Moving more than `touchSlop` px before that is a scroll (the gesture is dropped and the page
 *   scrolls natively). A quick tap is a click.
 *
 * After activation the owner calls `trackPointerSession()` to follow the pointer until release.
 */

export interface PickupConfig {
  /** Mouse/pen movement (px) that turns a press into a drag. */
  mouseSlop: number;
  /** Touch movement (px) that cancels a pending long-press (the user is scrolling). */
  touchSlop: number;
  /** Touch long-press (ms) that picks up. */
  longPressMs: number;
  /** Vibration length (ms) when a long-press picks up; 0 disables it. */
  hapticMs?: number;
}

export const PICKUP_DEFAULTS: PickupConfig = { mouseSlop: 4, touchSlop: 8, longPressMs: 180, hapticMs: 8 };

export interface PickupActivation {
  pointerId: number;
  pointerType: string;
  /** Press position. */
  x0: number;
  y0: number;
  /** Pointer position at activation. */
  x: number;
  y: number;
  /** True when a touch long-press activated it (the release rule then differs, see owners). */
  viaLongPress: boolean;
  target: HTMLElement;
}

export interface PickupHandlers {
  onActivate: (a: PickupActivation) => void;
  /** The press ended without a pick-up (click, tap or scroll). */
  onAbort?: (reason: 'release' | 'scroll' | 'cancel') => void;
}

/** Short haptic tick where supported (Android Chrome); silently ignored elsewhere. */
export function hapticTick(ms = 8) {
  if (ms <= 0 || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  // Chrome blocks (and logs) vibrate() before the first user activation; skip it then.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Some browsers throw when vibration is blocked by permissions policy.
  }
}

let blockableRefs = 0;
const noop = () => undefined;

/**
 * iOS Safari and Chrome only honour preventDefault() in touchmove listeners that existed when the
 * touch started. A permanent non-passive no-op listener makes the dynamic ones work.
 * Ref-counted; call the returned function on unmount.
 */
export function ensureTouchMoveBlockable(): () => void {
  if (typeof window === 'undefined') return noop;
  if (blockableRefs++ === 0) window.addEventListener('touchmove', noop, { passive: false });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--blockableRefs === 0) window.removeEventListener('touchmove', noop);
  };
}

interface Pending {
  pointerId: number;
  pointerType: string;
  x0: number;
  y0: number;
  x: number;
  y: number;
  target: HTMLElement;
  timer: number;
  cfg: PickupConfig;
}

/** Turns a press into a pick-up (threshold for mouse, long-press for touch). One press at a time. */
export class PointerPickup {
  private p: Pending | null = null;

  constructor(private handlers: PickupHandlers) {}

  get pending(): boolean {
    return this.p !== null;
  }

  /** Call from pointerdown. Ignores non-primary pointers and non-left buttons. */
  begin(e: { pointerId: number; pointerType: string; clientX: number; clientY: number; button: number; isPrimary: boolean; currentTarget: EventTarget | null }, cfg: PickupConfig) {
    if (e.button !== 0 || !e.isPrimary || !(e.currentTarget instanceof HTMLElement)) return;
    this.cancel();
    this.p = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      target: e.currentTarget,
      timer: 0,
      cfg,
    };
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    if (e.pointerType === 'touch') this.p.timer = window.setTimeout(this.onLongPress, cfg.longPressMs);
  }

  /** Drop a pending press (no callbacks). */
  cancel() {
    const p = this.p;
    if (!p) return;
    window.clearTimeout(p.timer);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    this.p = null;
  }

  private onMove = (e: PointerEvent) => {
    const p = this.p;
    if (!p || e.pointerId !== p.pointerId) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const d = Math.hypot(p.x - p.x0, p.y - p.y0);
    if (p.pointerType === 'touch') {
      if (d > p.cfg.touchSlop) {
        this.cancel();
        this.handlers.onAbort?.('scroll');
      }
      return;
    }
    if (d > p.cfg.mouseSlop) this.activate(false);
  };

  private onUp = (e: PointerEvent) => {
    if (!this.p || e.pointerId !== this.p.pointerId) return;
    this.cancel();
    this.handlers.onAbort?.('release');
  };

  private onCancel = (e: PointerEvent) => {
    if (!this.p || e.pointerId !== this.p.pointerId) return;
    this.cancel();
    this.handlers.onAbort?.('cancel');
  };

  private onLongPress = () => {
    const p = this.p;
    if (!p) return;
    hapticTick(p.cfg.hapticMs ?? 8);
    this.activate(true);
  };

  private activate(viaLongPress: boolean) {
    const p = this.p;
    if (!p) return;
    const a: PickupActivation = { pointerId: p.pointerId, pointerType: p.pointerType, x0: p.x0, y0: p.y0, x: p.x, y: p.y, viaLongPress, target: p.target };
    this.cancel();
    this.handlers.onActivate(a);
  }
}

export interface PointerSessionHandlers {
  onMove: (x: number, y: number, e: PointerEvent) => void;
  onEnd: (x: number, y: number, e: PointerEvent) => void;
  /** Pointer cancelled by the browser, Escape pressed or the window lost focus. */
  onCancel: (reason: 'pointercancel' | 'escape' | 'blur') => void;
}

/**
 * Follow one pointer until it is released: window listeners, touch scrolling blocked, context menu
 * suppressed (long-press), grabbing cursor and no text selection. Returns `stop()` (idempotent).
 */
export function trackPointerSession(pointerId: number, h: PointerSessionHandlers, opts: { cursor?: string } = {}): () => void {
  const body = document.body.style;
  const saved = { cursor: body.cursor, userSelect: body.userSelect, webkitUserSelect: body.webkitUserSelect };
  body.cursor = opts.cursor ?? 'grabbing';
  body.userSelect = 'none';
  body.webkitUserSelect = 'none';
  let stopped = false;

  const onMove = (e: PointerEvent) => {
    if (e.pointerId === pointerId) h.onMove(e.clientX, e.clientY, e);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    stop();
    h.onEnd(e.clientX, e.clientY, e);
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    stop();
    h.onCancel('pointercancel');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    stop();
    h.onCancel('escape');
  };
  const onBlur = () => {
    stop();
    h.onCancel('blur');
  };
  const onTouchMove = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
  };
  const onContextMenu = (e: Event) => e.preventDefault();

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('contextmenu', onContextMenu);

  function stop() {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('contextmenu', onContextMenu);
    body.cursor = saved.cursor;
    body.userSelect = saved.userSelect;
    body.webkitUserSelect = saved.webkitUserSelect;
  }
  return stop;
}
