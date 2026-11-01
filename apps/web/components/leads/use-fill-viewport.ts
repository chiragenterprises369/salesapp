'use client';

import { useLayoutEffect, type RefObject } from 'react';

/**
 * Sizes a scroll container to fill the viewport below its top edge (works inside any shell),
 * so the Table keeps a sticky header and its own scroll position. Re-measures when the page above
 * it changes height (filters panel, bulk bar) or the window resizes.
 */
export function useFillViewport(
  ref: RefObject<HTMLElement | null>,
  { min = 320, bottom = 16 } = {},
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const next = `${Math.max(min, Math.floor(window.innerHeight - top - bottom))}px`;
      if (el.style.height !== next) el.style.height = next;
    };
    update();
    window.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    ro.observe(el.closest('[data-leads-page]') ?? document.body);
    return () => {
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, [ref, min, bottom]);
}
