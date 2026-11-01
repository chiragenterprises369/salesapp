'use client';

import type { ResolvedTheme } from '@vistar/shared';
import { useSyncExternalStore } from 'react';

/**
 * Resolved theme from <html data-theme>. Use in charts, canvas, Three.js and third-party widgets
 * that cannot read CSS variables. The theme system (frontend-app) owns WRITING the attribute.
 */
function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

function getSnapshot(): ResolvedTheme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function useDocumentTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'light');
}
