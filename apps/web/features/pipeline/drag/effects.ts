/**
 * One-shot feedback animations on board elements (Web Animations API, transform/opacity only).
 * `animated: false` (reduced motion, flat mode) shows the same feedback without movement.
 */

const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)';

export type RingTone = 'stage' | 'danger' | 'accent';

const RING_COLOR: Record<RingTone, string> = {
  stage: 'var(--vb-stage, var(--accent))',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
};

function canAnimate(el: Element | null): el is HTMLElement {
  return !!el && typeof (el as HTMLElement).animate === 'function' && el.isConnected;
}

/** Confirmation ring around a card: stage colour after a drop, danger after a rollback. */
export function pulseRing(ring: HTMLElement | null, tone: RingTone, ms: number, animated: boolean) {
  if (!canAnimate(ring)) return;
  ring.style.color = RING_COLOR[tone];
  ring.getAnimations().forEach((a) => a.cancel());
  if (!animated) {
    // Static highlight for the same time: feedback without motion.
    ring.animate([{ opacity: 1 }, { opacity: 1 }], { duration: Math.max(ms, 600) });
    return;
  }
  ring.animate(
    [
      { opacity: 0, scale: '0.985' },
      { opacity: 1, scale: '1', offset: 0.25 },
      { opacity: 0, scale: '1.035' },
    ],
    { duration: ms, easing: EASE_OUT },
  );
}

/** A new lead lands at the top of its column: drops in from above with a soft landing. */
export function dropIn(li: HTMLElement, ms: number, animated: boolean, fadeMs = 150) {
  if (!canAnimate(li)) return;
  if (!animated) {
    fadeIn(li, fadeMs);
    return;
  }
  li.animate(
    [
      { opacity: 0, translate: '0 -36px', scale: '1.02' },
      { opacity: 1, translate: '0 3px', scale: '1', offset: 0.62 },
      { translate: '0 -1px', offset: 0.82 },
      { opacity: 1, translate: '0 0', scale: '1' },
    ],
    { duration: ms, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
  );
}

/** Cards that appear because filters changed or a page loaded: a quick fade (and settle). */
export function fadeIn(li: HTMLElement, ms: number, settle = false) {
  if (!canAnimate(li)) return;
  li.animate(settle ? [{ opacity: 0, scale: '0.98' }, { opacity: 1, scale: '1' }] : [{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: EASE_OUT });
}

/** Count chip pulse (a card entered or left the column, or a drag hovers it). */
export function pulseChip(el: HTMLElement | null, ms: number) {
  if (!canAnimate(el)) return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ scale: '1' }, { scale: '1.18', offset: 0.35 }, { scale: '1' }], { duration: ms, easing: EASE_OUT });
}
