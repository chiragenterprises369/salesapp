/** Controls inside a card that handle their own presses (quick action pill, move menu, links, inputs). */
const INTERACTIVE = 'button, [role="button"], [role="menuitem"], a, input, select, textarea, [data-radix-collection-item]';

/**
 * True when a press or click started on an interactive control INSIDE the card (`currentTarget`), so the card
 * must not start a drag or open the lead. The card itself has role="button" (role="checkbox" in select mode)
 * and does not count: `closest()` also matches the element it starts from, and matching the card blocked
 * every drag and card click (fixed 2026-11-27).
 */
export function startedOnInnerControl(e: { target: EventTarget | null; currentTarget: EventTarget | null }): boolean {
  const target = e.target as Element | null;
  const card = e.currentTarget as Element | null;
  if (!target || typeof target.closest !== 'function') return false;
  const hit = target.closest(INTERACTIVE);
  return !!hit && hit !== card && !!card?.contains(hit);
}
