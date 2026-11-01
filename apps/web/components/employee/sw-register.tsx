'use client';

import { useEffect } from 'react';

/**
 * Registers the minimal Employee panel service worker (offline fallback page) in production only, scoped
 * to /me. Development never registers it, so hot reload and fresh assets are not cached.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/me' }).catch(() => {
      /* Not supported or blocked (private mode): the app works without it. */
    });
  }, []);
  return null;
}
