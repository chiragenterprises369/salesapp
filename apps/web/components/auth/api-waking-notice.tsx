'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { isApiData } from '@/lib/api/data-source';
import { isApiWaking, subscribeApiWaking, wakeApi } from '@/lib/api/wake';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Sign-in page helper: starts a sleeping API as soon as the page opens, so it has booted by the time the
 * form is sent, and says why a sign-in is slow while it waits for the API (lib/api/wake.ts).
 */
export function ApiWakingNotice() {
  const waking = useSyncExternalStore(subscribeApiWaking, isApiWaking, () => false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (isApiData()) void wakeApi();
  }, []);

  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      {waking && (
        <div className="pointer-events-auto flex max-w-sm items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-fg-secondary shadow-overlay">
          <Loader2 aria-hidden className={reducedMotion ? 'size-4 shrink-0' : 'size-4 shrink-0 animate-spin'} />
          Waking up the server. The first sign-in after a while can take up to a minute.
        </div>
      )}
    </div>
  );
}
