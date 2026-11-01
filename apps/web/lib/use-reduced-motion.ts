'use client';

import { useSyncExternalStore } from 'react';

/**
 * True when the OS asks for reduced motion OR the user setting sets <html data-reduced-motion="on">.
 * Gate springs, rope physics, count-up numbers and 3D animation on this.
 */
const query = '(prefers-reduced-motion: reduce)';

function subscribe(callback: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', callback);
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
  return () => {
    mql.removeEventListener('change', callback);
    observer.disconnect();
  };
}

function getSnapshot(): boolean {
  const attr = document.documentElement.getAttribute('data-reduced-motion');
  if (attr === 'on') return true;
  if (attr === 'off') return false;
  return window.matchMedia(query).matches;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
