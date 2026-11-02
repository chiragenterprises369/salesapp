'use client';

import type { Call } from '@vistar/shared';
import { DAY_MS, istDayStart } from '@vistar/shared/fixtures';
import { useMemo } from 'react';
import { viewerFromMe } from '@/lib/world';
import { useWorldCalls } from '@/lib/world/hooks';
import { useMe } from '@/lib/session/session';
import { scopeCalls } from './logic';

/**
 * Calls page data adapter over `@/lib/world` (GET /calls with from/to; data scope on Call.userId).
 * Employee, outcome and direction filters run on the client over the range (a few thousand rows).
 */
const iso = (t: number) => new Date(t).toISOString();

export function useCallLog(range: { from: number; to: number }) {
  const me = useMe();
  const v = useMemo(() => viewerFromMe(me), [me]);
  const q = useWorldCalls({ from: iso(range.from), to: iso(range.to - 1), limit: 20_000 });
  const data = useMemo<Call[] | undefined>(() => (q.data ? scopeCalls(q.data.items, v) : undefined), [q.data, v]);
  return { ...q, data };
}

/** Today's calls in scope (totals strip), whatever range the table shows. */
export function useCallsToday(now: number) {
  const start = istDayStart(now || 0);
  return useCallLog({ from: start, to: start + DAY_MS });
}
